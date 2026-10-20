"""Interviews: calendar events matched to applications, interviews named by invite emails, and the
read-side views (upcoming, just happened, counts).

One interview is one row, whatever told us about it. An invite email creates it; the calendar event
for the same slot later takes that row over (same application, start within SAME_SLOT), so notes
written in between stay attached and nothing is counted twice.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta

from jobtracker.core.filtering import FREEMAIL_DOMAINS, JOB_BOARD_DOMAINS, domain_matches
from jobtracker.core.matching import MatchConfig, normalize_company, pick_by_role
from jobtracker.core.models import (
    AliasKind,
    Application,
    CalendarItem,
    Event,
    EventType,
    Interview,
    InterviewNote,
    InterviewSource,
    InterviewStatus,
    MatchMethod,
)
from jobtracker.core.ports import Clock, Repository
from jobtracker.core.stages import INTERVIEW_EVENTS, is_active

# An email time and a calendar time this close are the same interview.
SAME_SLOT = timedelta(minutes=90)
# A calendar event within this of an assigned invite email's time belongs to that application.
INVITE_SLOT = timedelta(minutes=10)
RECENT = timedelta(days=14)

EMAIL_INTERVIEW_EVENTS = INTERVIEW_EVENTS | {EventType.SCREENING_INVITE}

# Rooms, shared calendars and Google itself are attendees, not people.
CALENDAR_DOMAINS = {
    "resource.calendar.google.com",
    "group.calendar.google.com",
    "group.v.calendar.google.com",
    "calendar.google.com",
}

# Only for events no known company is on: English and Spanish titles that mean "interview".
_INTERVIEW_WORDS = re.compile(
    r"\b(interview|entrevista|screening|phone screen|recruiter|reclutador[a]?|hiring|"
    r"technical|t[eé]cnic[ao]|system design|live coding|coding|pair programming|onsite|"
    r"on-site|panel|take[- ]home|final round|culture fit|hiring manager)\b",
    re.IGNORECASE,
)
_TYPE_RULES = [
    (re.compile(r"system design|dise[nñ]o de sistemas", re.I), "system_design"),
    (re.compile(r"take[- ]home|assignment|challenge|desaf[ií]o", re.I), "take_home"),
    (re.compile(r"technical|t[eé]cnic|coding|pair|code review|algorithm", re.I), "technical"),
    (re.compile(r"behaviou?ral|culture|values|fit\b", re.I), "behavioral"),
    (re.compile(r"onsite|on-site|panel|final round|superday", re.I), "onsite"),
    (re.compile(r"recruit|reclut|screen|intro|talent|\bhr\b|people", re.I), "recruiter"),
]


def guess_type(title: str | None) -> str | None:
    for pattern, kind in _TYPE_RULES:
        if title and pattern.search(title):
            return kind
    return None


def looks_like_interview(item: CalendarItem, ats_domains: set[str]) -> bool:
    if _INTERVIEW_WORDS.search(item.title):
        return True
    # Booked through a scheduler or ATS (GoodTime, Calendly, Ashby…).
    hosts = [a.rsplit("@", 1)[-1] for a in (item.organizer, *item.attendees) if a and "@" in a]
    return any(domain_matches(h, ats_domains) for h in hosts) or any(
        d in item.description.lower() for d in ats_domains
    )


def external_addresses(
    organizer: str | None, attendees: Iterable[str], my_addresses: set[str]
) -> list[str]:
    out: list[str] = []
    for addr in (organizer, *attendees):
        addr = (addr or "").strip().lower()
        if (
            "@" in addr
            and addr not in my_addresses
            and not domain_matches(addr.rsplit("@", 1)[-1], CALENDAR_DOMAINS)
            and addr not in out
        ):
            out.append(addr)
    return out


def learnable_domains(addresses: Iterable[str], shared: set[str]) -> set[str]:
    """Attendee domains worth remembering as the company's: not freemail, ATS or agencies."""
    out = set()
    for addr in addresses:
        domain = addr.rsplit("@", 1)[-1].lower()
        if domain and domain not in FREEMAIL_DOMAINS and not domain_matches(domain, shared):
            out.add(domain)
    return out


@dataclass(slots=True)
class CalendarMatch:
    application_id: uuid.UUID | None
    company_id: uuid.UUID | None
    method: MatchMethod
    keep: bool  # worth storing: a known company is on it, or it reads like an interview


def match_calendar_item(
    item: CalendarItem,
    repo: Repository,
    apps: list[Application],
    invite_events: list[Event],
    my_addresses: set[str],
    cfg: MatchConfig | None = None,
) -> CalendarMatch:
    """Invite email for this event (same UID, else same time) -> attendee domain/address ->
    company named in the title."""
    cfg = cfg or MatchConfig()
    assert item.start is not None

    # 1. An assigned invite email is about this event: the same .ics UID (it survives moves), or
    # failing that, this exact slot.
    same_slot = {
        e.application_id
        for e in invite_events
        if e.application_id and item.ical_uid and e.ical_uid == item.ical_uid
    } or {
        e.application_id
        for e in invite_events
        if e.application_id and e.interview_at and abs(e.interview_at - item.start) <= INVITE_SLOT
    }
    if len(same_slot) == 1:
        app_id = next(iter(same_slot))
        app = next((a for a in apps if a.id == app_id), None)
        return CalendarMatch(app_id, app.company_id if app else None, MatchMethod.INVITE, True)

    # 2. Someone from a known company is invited.
    ats = repo.ats_domains()
    shared = set(ats) | set(repo.agency_domains()) | JOB_BOARD_DOMAINS
    company_domains = repo.company_domains()
    companies: set[uuid.UUID] = set()
    for addr in external_addresses(item.organizer, item.attendees, my_addresses):
        if company := repo.find_company_by_alias(AliasKind.ADDRESS, addr):
            companies.add(company.id)
            continue
        domain = addr.rsplit("@", 1)[-1]
        if domain in FREEMAIL_DOMAINS or domain_matches(domain, shared):
            continue
        if (hit := domain_matches(domain, company_domains)) and (
            company := repo.find_company_by_alias(AliasKind.DOMAIN, hit)
        ):
            companies.add(company.id)
    method = MatchMethod.ALIAS

    # 3. The title names a company we applied to ("Interview with Sluicebox").
    if not companies:
        title = f" {normalize_company(item.title)} "
        names = {a.company_id: normalize_company(a.company_name) for a in apps}
        companies = {cid for cid, name in names.items() if len(name) >= 4 and f" {name} " in title}
        method = MatchMethod.FUZZY

    if len(companies) == 1:
        company_id = next(iter(companies))
        mine = [a for a in apps if a.company_id == company_id]
        active = [a for a in mine if is_active(a)]
        chosen = pick_by_role(active, item.title, cfg) or (mine[0] if len(mine) == 1 else None)
        return CalendarMatch(chosen.id if chosen else None, company_id, method, True)
    if companies:
        return CalendarMatch(None, None, MatchMethod.NONE, True)
    return CalendarMatch(None, None, MatchMethod.NONE, looks_like_interview(item, set(ats)))


def find_twin(
    interviews: Iterable[Interview], app_id: uuid.UUID, at: datetime, *, unlinked_calendar: bool
) -> Interview | None:
    """The application's interview in the same slot. `unlinked_calendar`: only rows no calendar
    event owns yet (a calendar event must never take over another calendar event's row)."""
    candidates = [
        iv
        for iv in interviews
        if iv.application_id == app_id
        and iv.status == InterviewStatus.SCHEDULED
        and not iv.dismissed
        and abs(iv.starts_at - at) <= SAME_SLOT
        and not (unlinked_calendar and iv.calendar_event_id)
    ]
    return min(candidates, key=lambda iv: abs(iv.starts_at - at)) if candidates else None


def _superseded(events: list[Event]) -> set[uuid.UUID]:
    """Invite emails whose time a later "rescheduled" email in the same thread replaced."""
    out: set[uuid.UUID] = set()
    for r in events:
        if r.event_type != EventType.INTERVIEW_RESCHEDULED or not r.gm_thread_id:
            continue
        for p in events:
            if (
                p.id != r.id
                and p.gm_thread_id == r.gm_thread_id
                and p.occurred_at < r.occurred_at
                and p.interview_at
                and r.interview_at
                and p.interview_at > r.occurred_at  # still upcoming when it moved
                and abs(p.interview_at - r.interview_at) > SAME_SLOT
            ):
                out.add(p.id)
    return out


def _is_ics_cancel(e: Event) -> bool:
    """The pipeline records an .ics METHOD:CANCEL as a reschedule with the UID and no time."""
    return (
        bool(e.ical_uid)
        and e.interview_at is None
        and e.event_type == EventType.INTERVIEW_RESCHEDULED
    )


def sync_email_interviews(repo: Repository, clock: Clock, app_id: uuid.UUID) -> bool:
    """Make sure every interview time this application's emails name is one interview row.
    Emails carrying the same invite UID are one interview: the newest email's time wins, an .ics
    cancellation cancels it, and a calendar event with that UID owns it. Returns whether anything
    changed."""
    now = clock.now()
    events = sorted(
        (
            e
            for e in repo.list_events(app_id)
            if not e.dismissed
            and ((e.interview_at and e.event_type in EMAIL_INTERVIEW_EVENTS) or _is_ics_cancel(e))
        ),
        key=lambda e: e.occurred_at,
    )
    interviews = repo.list_interviews(app_id)
    by_event = {iv.event_id: iv for iv in interviews if iv.event_id}
    by_uid = {iv.ical_uid: iv for iv in interviews if iv.ical_uid}
    superseded = _superseded(events)
    changed = False

    def save(iv: Interview) -> None:
        nonlocal changed
        iv.updated_at = now
        repo.save_interview(iv)
        changed = True

    def new_row(e: Event) -> Interview:
        assert e.interview_at is not None
        iv = Interview(
            starts_at=e.interview_at,
            source=InterviewSource.EMAIL,
            application_id=app_id,
            title=e.subject,
            round=e.round,
            interview_type="recruiter"
            if e.event_type == EventType.SCREENING_INVITE
            else guess_type(e.subject),
            ical_uid=e.ical_uid,
            event_id=e.id,
            match_method=e.match_method,
            assigned_by=e.assigned_by,
            created_at=now,
        )
        save(iv)
        interviews.append(iv)
        return iv

    for e in events:
        iv = by_event.get(e.id)
        if e.ical_uid:
            row = by_uid.get(e.ical_uid) or iv
            if e.interview_at is None:  # the organizer cancelled it
                if (
                    row
                    and row.source == InterviewSource.EMAIL
                    and row.status != InterviewStatus.CANCELLED
                ):
                    row.status = InterviewStatus.CANCELLED
                    save(row)
                continue
            if row is None:
                row = find_twin(interviews, app_id, e.interview_at, unlinked_calendar=False)
                if row is None:
                    by_uid[e.ical_uid] = new_row(e)
                    continue
                if row.ical_uid is None:
                    row.ical_uid = e.ical_uid
                    by_uid[e.ical_uid] = row
                    save(row)
            if row.source == InterviewSource.EMAIL:
                # A later email about the same invite (an update, or a re-invite after a cancel).
                if (row.starts_at, row.status, row.event_id) != (
                    e.interview_at,
                    InterviewStatus.SCHEDULED,
                    e.id,
                ):
                    row.starts_at, row.status, row.event_id = (
                        e.interview_at,
                        InterviewStatus.SCHEDULED,
                        e.id,
                    )
                    save(row)
            elif row.event_id is None:  # the calendar owns the time; just remember the email
                row.event_id = e.id
                save(row)
            continue

        assert e.interview_at is not None
        if e.id in superseded:
            if iv and iv.source == InterviewSource.EMAIL and iv.status != InterviewStatus.CANCELLED:
                iv.status = InterviewStatus.CANCELLED  # kept, with any notes, but not counted
                save(iv)
            continue
        if iv:
            if iv.source == InterviewSource.EMAIL and iv.starts_at != e.interview_at:
                iv.starts_at = e.interview_at
                save(iv)
            continue
        if twin := find_twin(interviews, app_id, e.interview_at, unlinked_calendar=False):
            if twin.event_id is None:
                twin.event_id = e.id
                save(twin)
            continue
        new_row(e)

    # Rows from emails that moved to another application or were dismissed. Notes keep a row.
    live = {e.id for e in events}
    noted = {n.interview_id for n in repo.list_notes(app_id) if n.interview_id}
    for iv in interviews:
        if (
            iv.source == InterviewSource.EMAIL
            and iv.event_id not in live
            and iv.calendar_event_id is None
            and iv.id not in noted
        ):
            repo.delete_interview(iv.id)
            changed = True
    return changed


def _copy_calendar_fields(iv: Interview, item: CalendarItem, calendar_id: str) -> None:
    assert item.start is not None
    iv.source = InterviewSource.CALENDAR
    iv.calendar_id = calendar_id
    iv.calendar_event_id = item.calendar_event_id
    iv.ical_uid = item.ical_uid
    iv.starts_at = item.start
    iv.ends_at = item.end
    iv.title = item.title or iv.title
    iv.location = item.location
    iv.meeting_url = item.meeting_url
    iv.organizer = item.organizer
    iv.attendees = list(item.attendees)
    iv.html_link = item.html_link
    iv.status = InterviewStatus.SCHEDULED


@dataclass(slots=True)
class CalendarReport:
    seen: int = 0
    created: int = 0
    updated: int = 0
    cancelled: int = 0
    unassigned: int = 0
    skipped: int = 0  # not interview-like: never stored
    full_sync: bool = False


def apply_calendar_items(
    repo: Repository,
    clock: Clock,
    calendar_id: str,
    items: list[CalendarItem],
    my_addresses: set[str],
) -> tuple[CalendarReport, set[uuid.UUID]]:
    """Store the interview-like events, matched. Returns the applications that changed."""
    now = clock.now()
    report = CalendarReport()
    touched: set[uuid.UUID] = set()
    apps = repo.list_applications()
    invites = [
        e
        for e in repo.list_all_events()
        if not e.dismissed
        and (e.ical_uid or (e.interview_at and e.event_type in EMAIL_INTERVIEW_EVENTS))
    ]
    interviews = repo.list_interviews()

    for item in items:
        report.seen += 1
        existing = repo.get_interview_by_calendar_event(calendar_id, item.calendar_event_id)
        if item.status == "cancelled" or item.declined:
            if existing and existing.status != InterviewStatus.CANCELLED:
                existing.status = InterviewStatus.CANCELLED
                existing.updated_at = now
                repo.save_interview(existing)
                report.cancelled += 1
                if existing.application_id:
                    touched.add(existing.application_id)
            continue
        if item.start is None:  # all-day: holidays, OOO, "interview week" reminders
            report.skipped += 1
            continue

        if existing:
            previous = existing.application_id
            _copy_calendar_fields(existing, item, calendar_id)
            if existing.application_id is None and existing.assigned_by != "manual":
                m = match_calendar_item(item, repo, apps, invites, my_addresses)
                existing.application_id, existing.company_hint_id = m.application_id, m.company_id
                if m.application_id:
                    existing.match_method, existing.assigned_by = m.method, "auto"
            existing.updated_at = now
            repo.save_interview(existing)
            report.updated += 1
            touched |= {a for a in (previous, existing.application_id) if a}
            continue

        m = match_calendar_item(item, repo, apps, invites, my_addresses)
        if not m.keep:
            report.skipped += 1
            continue
        twin = (
            next(
                (
                    iv
                    for iv in interviews
                    if item.ical_uid
                    and iv.ical_uid == item.ical_uid
                    and iv.application_id == m.application_id
                    and not iv.calendar_event_id
                ),
                None,
            )
            or find_twin(interviews, m.application_id, item.start, unlinked_calendar=True)
            if m.application_id
            else None
        )
        iv = twin or Interview(
            starts_at=item.start,
            source=InterviewSource.CALENDAR,
            interview_type=guess_type(item.title),
            created_at=now,
        )
        _copy_calendar_fields(iv, item, calendar_id)
        iv.application_id, iv.company_hint_id = m.application_id, m.company_id
        iv.match_method = m.method
        iv.assigned_by = "auto" if m.application_id else None
        iv.updated_at = now
        repo.save_interview(iv)
        if twin is None:
            interviews.append(iv)
            report.created += 1
        else:
            report.updated += 1
        if m.application_id:
            touched.add(m.application_id)
        else:
            report.unassigned += 1
    return report, touched


# Read side


def counted(iv: Interview) -> bool:
    return iv.status == InterviewStatus.SCHEDULED and not iv.dismissed


def listed(iv: Interview) -> bool:
    """Shown in upcoming / just happened: an application's interviews and general talks.
    General talks are never counted as an application's interviews."""
    return counted(iv) and (iv.application_id is not None or iv.general)


def upcoming(interviews: Iterable[Interview], now: datetime) -> list[Interview]:
    rows = [iv for iv in interviews if listed(iv) and iv.starts_at >= now]
    return sorted(rows, key=lambda iv: iv.starts_at)


def recent(interviews: Iterable[Interview], now: datetime) -> list[Interview]:
    """Just happened, newest first: the ones to write notes about."""
    rows = [iv for iv in interviews if listed(iv) and now - RECENT <= iv.starts_at < now]
    return sorted(rows, key=lambda iv: iv.starts_at, reverse=True)


def counts(
    interviews: Iterable[Interview], app_ids: set[uuid.UUID], now: datetime
) -> dict[str, int]:
    mine = [iv for iv in interviews if counted(iv) and iv.application_id in app_ids]
    return {
        "done": sum(1 for iv in mine if iv.starts_at < now),
        "upcoming": sum(1 for iv in mine if iv.starts_at >= now),
    }


def notes_by_interview(
    notes: Iterable[InterviewNote], interviews: Iterable[Interview] = ()
) -> dict[uuid.UUID, int]:
    """Notes per interview. A general talk's inline notes count as one."""
    out: dict[uuid.UUID, int] = {iv.id: 1 for iv in interviews if iv.general and iv.notes}
    for n in notes:
        if n.interview_id:
            out[n.interview_id] = out.get(n.interview_id, 0) + 1
    return out
