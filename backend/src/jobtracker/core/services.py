"""Use cases shared by the API, the CLI and the pipeline. Callers own the transaction."""

from __future__ import annotations

import csv
import io
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from jobtracker.core.extraction import parse_extraction
from jobtracker.core.filtering import FREEMAIL_DOMAINS, JOB_BOARD_DOMAINS, domain_matches
from jobtracker.core.interviews import (
    CalendarReport,
    apply_calendar_items,
    external_addresses,
    learnable_domains,
    sync_email_interviews,
)
from jobtracker.core.matching import aliases_to_learn, match, normalize_company
from jobtracker.core.models import (
    AliasKind,
    Application,
    Company,
    CompanyAlias,
    EmailMessage,
    Event,
    EventKind,
    EventType,
    Extraction,
    Interview,
    InterviewSource,
    MatchMethod,
    Origin,
    ProcessStep,
    Stage,
    StepKind,
    StepLink,
)
from jobtracker.core.ports import (
    CalendarSource,
    CalendarSyncExpired,
    Clock,
    Repository,
)
from jobtracker.core.process import guess_kind
from jobtracker.core.stages import apply_projection, project


class NotFound(Exception):
    pass


class InvalidInput(ValueError):
    pass


def get_or_create_company(
    repo: Repository, clock: Clock, name: str, domain: str | None = None
) -> Company:
    name = name.strip()
    if not name:
        raise InvalidInput("company name is required")
    normalized = normalize_company(name)
    company = repo.find_company_by_name(normalized)
    if company is None:
        company = Company(name=name, normalized_name=normalized, created_at=clock.now())
        repo.add_company(company)
    if domain:
        add_company_domain(repo, company, domain, "application")
    return company


def add_company_domain(repo: Repository, company: Company, domain: str, learned_from: str) -> bool:
    domain = domain.strip().lower().removeprefix("www.")
    shared = set(repo.ats_domains()) | set(repo.agency_domains()) | JOB_BOARD_DOMAINS
    if not domain or domain in FREEMAIL_DOMAINS or domain_matches(domain, shared):
        return False
    return repo.add_alias(CompanyAlias(company.id, AliasKind.DOMAIN, domain, learned_from))


def _domain_from_url(url: str | None) -> str | None:
    if not url:
        return None
    host = (urlparse(url if "//" in url else f"https://{url}").hostname or "").lower()
    return host.removeprefix("www.") or None


@dataclass(slots=True)
class ApplicationInput:
    company: str
    role_title: str
    job_url: str | None = None
    company_domain: str | None = None
    job_description: str | None = None
    source_ats: str | None = None
    source_channel: str | None = None
    seniority: str | None = None
    stack: list[str] = field(default_factory=list)
    location: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_currency: str | None = None
    benefits: str | None = None
    applied_at: datetime | None = None
    stage: Stage | None = None  # historical imports: where the process ended up
    stage_at: datetime | None = None
    notes: str | None = None
    process_steps: list[dict[str, Any]] = field(default_factory=list)  # {name, kind?, optional?}


def guess_ats(url: str | None, ats_domains: dict[str, str]) -> str | None:
    host = _domain_from_url(url)
    if not host:
        return None
    hit = domain_matches(host, set(ats_domains))
    return ats_domains[hit] if hit else None


def create_application(
    repo: Repository, clock: Clock, data: ApplicationInput, origin: Origin = Origin.MANUAL
) -> Application:
    if not data.role_title.strip():
        raise InvalidInput("role title is required")
    company = get_or_create_company(repo, clock, data.company, data.company_domain)
    ats = repo.ats_domains()
    if data.job_url and not data.company_domain:
        # A careers page on the company's own domain teaches the allowlist too.
        add_company_domain(repo, company, _domain_from_url(data.job_url) or "", "application")
    now = clock.now()
    app = Application(
        company_id=company.id,
        company_name=company.name,
        role_title=data.role_title.strip(),
        job_url=data.job_url,
        job_description=data.job_description,
        source_ats=data.source_ats or guess_ats(data.job_url, ats),
        source_channel=data.source_channel,
        seniority=data.seniority,
        stack=[s.strip() for s in data.stack if s.strip()],
        location=data.location,
        salary_min=data.salary_min,
        salary_max=data.salary_max,
        salary_currency=(data.salary_currency or "").upper() or None,
        benefits=data.benefits,
        applied_at=data.applied_at or now,
        origin=origin,
        notes=data.notes,
        created_at=now,
        updated_at=now,
    )
    repo.add_application(app)
    if data.salary_min and data.salary_max and data.salary_min > data.salary_max:
        raise InvalidInput("salary min is greater than salary max")
    if data.stage and data.stage != Stage.APPLIED:
        change_stage(
            repo, clock, app.id, data.stage, at=data.stage_at or app.applied_at, note="imported"
        )
    if data.process_steps:
        add_steps(repo, clock, app.id, data.process_steps)
    return app


def create_application_from_email(
    repo: Repository,
    clock: Clock,
    extraction: Extraction,
    email: EmailMessage,
    company_id: uuid.UUID | None,
) -> Application:
    ats = repo.ats_domains()
    if company_id:
        company = repo.get_company(company_id)
        if company is None:
            raise NotFound(str(company_id))
    else:
        company = get_or_create_company(repo, clock, extraction.company or "Unknown")
    agencies = repo.agency_domains()
    for kind, value in aliases_to_learn(
        email.from_address, email.from_name, set(ats), set(agencies)
    ):
        repo.add_alias(CompanyAlias(company.id, kind, value, "auto_create"))
    hit = domain_matches(email.from_domain, set(ats))
    agency = domain_matches(email.from_domain, set(agencies))
    linkedin = "linkedin" in email.from_domain
    now = clock.now()
    app = Application(
        company_id=company.id,
        company_name=company.name,
        role_title=extraction.role or UNKNOWN_ROLE,
        source_ats=ats[hit]
        if hit
        else agencies[agency]
        if agency
        else ("linkedin" if linkedin else None),
        source_channel="recruiter" if agency else ("linkedin" if linkedin else None),
        applied_at=email.received_at,
        origin=Origin.EMAIL,
        needs_review=True,
        created_at=now,
        updated_at=now,
    )
    repo.add_application(app)
    return app


UNKNOWN_ROLE = "(unknown role)"


def fill_unknown_role(repo: Repository, app_id: uuid.UUID, role: str | None) -> None:
    """Fill-only: a later email may name the role the first one didn't. Never overwrites."""
    app = repo.get_application(app_id)
    if app and role and app.role_title == UNKNOWN_ROLE:
        app.role_title = role
        repo.update_application(app)


def update_fields(
    repo: Repository,
    clock: Clock,
    app_id: uuid.UUID,
    changes: dict[str, Any],
    learned_from: str = "manual",
) -> Application:
    """Set application fields (company_domain adds an alias, never removes one; process_steps
    only fills an empty plan, so links and done marks are never lost)."""
    a = repo.get_application(app_id)
    if a is None:
        raise NotFound(str(app_id))
    changes = dict(changes)
    domain = changes.pop("company_domain", None)
    steps = changes.pop("process_steps", None)
    if steps and not repo.list_steps(app_id):
        add_steps(repo, clock, app_id, steps)
    for name, value in changes.items():
        setattr(a, name, value)
    if a.salary_min and a.salary_max and a.salary_min > a.salary_max:
        raise InvalidInput("salary min is greater than salary max")
    if a.salary_currency:
        a.salary_currency = a.salary_currency.upper()
    if domain:
        company = repo.get_company(a.company_id)
        if company is not None:
            add_company_domain(repo, company, domain, learned_from)
    a.updated_at = clock.now()
    repo.update_application(a)
    return recompute(repo, clock, a.id)


def recompute(repo: Repository, clock: Clock, app_id: uuid.UUID) -> Application:
    app = repo.get_application(app_id)
    if app is None:
        raise NotFound(str(app_id))
    sync_email_interviews(repo, clock, app_id)
    apply_projection(
        app, project(app, repo.list_events(app_id), clock.now(), repo.list_interviews(app_id))
    )
    app.updated_at = clock.now()
    repo.update_application(app)
    return app


def change_stage(
    repo: Repository,
    clock: Clock,
    app_id: uuid.UUID,
    stage: Stage,
    at: datetime | None = None,
    round_: int | None = None,
    note: str | None = None,
) -> Event:
    if repo.get_application(app_id) is None:
        raise NotFound(str(app_id))
    event = Event(
        kind=EventKind.MANUAL,
        event_type=EventType.MANUAL_STAGE_CHANGE,
        occurred_at=at or clock.now(),
        application_id=app_id,
        stage_implied=stage,
        round=round_,
        summary=note,
        match_method=MatchMethod.MANUAL,
        assigned_by="manual",
        created_at=clock.now(),
    )
    repo.add_event(event)
    recompute(repo, clock, app_id)
    return event


def assign_event(
    repo: Repository, clock: Clock, tz: ZoneInfo, event_id: uuid.UUID, app_id: uuid.UUID
) -> Event:
    event = repo.get_event(event_id)
    app = repo.get_application(app_id)
    if event is None or app is None:
        raise NotFound(str(event_id if event is None else app_id))
    previous = event.application_id
    event.application_id = app_id
    event.company_hint_id = app.company_id
    event.match_method = MatchMethod.MANUAL
    event.assigned_by = "manual"
    event.dismissed = False
    repo.update_event(event)
    if event.from_address:
        for kind, value in aliases_to_learn(
            event.from_address,
            event.from_name or "",
            set(repo.ats_domains()),
            set(repo.agency_domains()),
        ):
            repo.add_alias(CompanyAlias(app.company_id, kind, value, "manual_assignment"))
    recompute(repo, clock, app_id)
    if previous and previous != app_id:
        recompute(repo, clock, previous)
    rematch_unassigned(repo, clock, tz)
    return event


def dismiss_event(repo: Repository, event_id: uuid.UUID) -> Event:
    event = repo.get_event(event_id)
    if event is None:
        raise NotFound(str(event_id))
    event.dismissed = True
    repo.update_event(event)
    return event


def mark_replied(repo: Repository, clock: Clock, event_id: uuid.UUID) -> Event:
    """Clears a reply request by hand (answered outside the thread, or nothing to answer)."""
    event = repo.get_event(event_id)
    if event is None:
        raise NotFound(str(event_id))
    if event.replied_at is None:
        event.replied_at = clock.now()
        repo.update_event(event)
    return event


def _email_stub(event: Event) -> EmailMessage:
    return EmailMessage(
        message_id=event.message_id or "",
        from_address=event.from_address or "",
        from_name=event.from_name or "",
        subject=event.subject or "",
        received_at=event.occurred_at,
        text="",
        gm_thread_id=event.gm_thread_id,
        in_reply_to=event.in_reply_to,
        references=event.references,
    )


def rematch_unassigned(repo: Repository, clock: Clock, tz: ZoneInfo) -> int:
    """Re-run matching on the inbox, e.g. after an assignment taught a new alias. Never creates."""
    assigned = 0
    touched: set[uuid.UUID] = set()
    for event in repo.list_unassigned():
        if event.dismissed or event.kind != EventKind.EMAIL:
            continue
        stub = _email_stub(event)
        thread = repo.thread_lookup(
            event.gm_thread_id, [event.in_reply_to or "", *event.references]
        )
        extraction = parse_extraction(event.extraction or {}, tz)
        result = match(stub, extraction, repo, thread.application_id)
        if result.application_id:
            event.application_id = result.application_id
            event.company_hint_id = result.company_id
            event.match_method = result.method
            event.assigned_by = "auto"
            repo.update_event(event)
            touched.add(result.application_id)
            assigned += 1
    for app_id in touched:
        recompute(repo, clock, app_id)
    return assigned


def create_application_from_event(
    repo: Repository, clock: Clock, tz: ZoneInfo, event_id: uuid.UUID, data: ApplicationInput
) -> Application:
    event = repo.get_event(event_id)
    if event is None:
        raise NotFound(str(event_id))
    data.applied_at = data.applied_at or event.occurred_at
    app = create_application(repo, clock, data)
    assign_event(repo, clock, tz, event_id, app.id)
    return app


def delete_application(repo: Repository, clock: Clock, app_id: uuid.UUID) -> None:
    """Email events go back to the inbox; manual events and notes are removed with the app."""
    if repo.get_application(app_id) is None:
        raise NotFound(str(app_id))
    for event in repo.list_events(app_id):
        if event.kind == EventKind.EMAIL:
            event.application_id = None
            event.match_method = MatchMethod.NONE
            event.assigned_by = None
            repo.update_event(event)
    for note in repo.list_notes(app_id):
        repo.delete_note(note.id)
    for step in repo.list_steps(app_id):
        repo.delete_step(step.id)
    for iv in repo.list_interviews(app_id):
        if iv.source == InterviewSource.CALENDAR:  # back to the review queue, like its emails
            iv.application_id = None
            iv.match_method = MatchMethod.NONE
            iv.assigned_by = None
            repo.save_interview(iv)
        else:
            repo.delete_interview(iv.id)
    repo.delete_application(app_id)


INTERVIEW_FIELDS = {"starts_at", "ends_at", "title", "round", "interview_type", "location", "notes"}


def add_interview(
    repo: Repository, clock: Clock, app_id: uuid.UUID, fields: dict[str, Any]
) -> Interview:
    """An interview the calendar and the emails don't know about (a phone call, say)."""
    if repo.get_application(app_id) is None:
        raise NotFound(str(app_id))
    if not fields.get("starts_at"):
        raise InvalidInput("starts_at is required")
    now = clock.now()
    iv = Interview(
        starts_at=fields["starts_at"],
        source=InterviewSource.MANUAL,
        application_id=app_id,
        match_method=MatchMethod.MANUAL,
        assigned_by="manual",
        created_at=now,
    )
    return update_interview(repo, clock, iv, fields)


def update_interview(
    repo: Repository, clock: Clock, iv: Interview, fields: dict[str, Any]
) -> Interview:
    unknown = set(fields) - INTERVIEW_FIELDS
    if unknown:
        raise InvalidInput(f"cannot edit: {', '.join(sorted(unknown))}")
    if "notes" in fields and not iv.general:
        raise InvalidInput("an application's interview takes notes, not inline text")
    for name, value in fields.items():
        setattr(iv, name, value.strip() or None if isinstance(value, str) else value)
    if iv.starts_at is None:
        raise InvalidInput("starts_at is required")
    iv.updated_at = clock.now()
    repo.save_interview(iv)
    if iv.application_id:
        recompute(repo, clock, iv.application_id)
    return iv


def assign_interview(
    repo: Repository, clock: Clock, interview_id: uuid.UUID, app_id: uuid.UUID, my: set[str]
) -> Interview:
    """Like assigning an email: the attendees' company domain is remembered for next time."""
    iv = repo.get_interview(interview_id)
    app = repo.get_application(app_id)
    if iv is None or app is None:
        raise NotFound(str(interview_id if iv is None else app_id))
    previous = iv.application_id
    iv.application_id = app_id
    iv.company_hint_id = app.company_id
    iv.match_method = MatchMethod.MANUAL
    iv.assigned_by = "manual"
    iv.dismissed = False
    iv.general = False
    iv.updated_at = clock.now()
    repo.save_interview(iv)
    for note in repo.list_notes(previous) if previous and previous != app_id else []:
        if note.interview_id == iv.id:
            note.application_id = app_id
            repo.save_note(note)
    company = repo.get_company(app.company_id)
    shared = set(repo.ats_domains()) | set(repo.agency_domains()) | JOB_BOARD_DOMAINS
    attendees = external_addresses(iv.organizer, iv.attendees, my)
    for domain in learnable_domains(attendees, shared) if company else ():
        add_company_domain(repo, company, domain, "manual_assignment")
    recompute(repo, clock, app_id)
    if previous and previous != app_id:
        recompute(repo, clock, previous)
    return iv


def mark_general(repo: Repository, clock: Clock, interview_id: uuid.UUID) -> Interview:
    """A recruiter or agency talk about roles in general: out of the review queue, tied to no
    application, never counted as an application's interview. Its notes live on the interview."""
    iv = repo.get_interview(interview_id)
    if iv is None:
        raise NotFound(str(interview_id))
    previous = iv.application_id
    iv.general = True
    iv.application_id = None
    iv.company_hint_id = None
    iv.match_method = MatchMethod.MANUAL
    iv.assigned_by = "manual"
    iv.dismissed = False
    iv.updated_at = clock.now()
    repo.save_interview(iv)
    if previous:
        # Notes already written stay on that application, as general notes there.
        for note in repo.list_notes(previous):
            if note.interview_id == iv.id:
                note.interview_id = None
                repo.save_note(note)
        recompute(repo, clock, previous)
    return iv


def remove_interview(repo: Repository, clock: Clock, interview_id: uuid.UUID) -> None:
    """Delete one added by hand; dismiss the rest, or the next sync would bring them back.
    Notes stay on the application, no longer tied to an interview."""
    iv = repo.get_interview(interview_id)
    if iv is None:
        raise NotFound(str(interview_id))
    if iv.source == InterviewSource.MANUAL:
        for note in repo.list_notes(iv.application_id) if iv.application_id else []:
            if note.interview_id == iv.id:
                note.interview_id = None
                repo.save_note(note)
        repo.delete_interview(iv.id)
    else:
        iv.dismissed = True
        iv.updated_at = clock.now()
        repo.save_interview(iv)
    if iv.application_id:
        recompute(repo, clock, iv.application_id)


def add_steps(
    repo: Repository, clock: Clock, app_id: uuid.UUID, items: list[dict[str, Any]]
) -> list[ProcessStep]:
    """Append steps to the plan. A step's kind is guessed from its name unless given."""
    if repo.get_application(app_id) is None:
        raise NotFound(str(app_id))
    existing = repo.list_steps(app_id)
    now = clock.now()
    out = []
    for i, item in enumerate(items, start=len(existing)):
        name = (item.get("name") or "").strip()
        if not name:
            continue
        step = ProcessStep(
            application_id=app_id,
            name=name,
            position=i,
            kind=StepKind(item["kind"]) if item.get("kind") else guess_kind(name),
            optional=bool(item.get("optional")),
            created_at=now,
            updated_at=now,
        )
        repo.save_step(step)
        out.append(step)
    return out


STEP_FIELDS = {"name", "kind", "optional", "link", "interview_id", "done_at", "position"}


def update_step(
    repo: Repository, clock: Clock, step_id: uuid.UUID, fields: dict[str, Any]
) -> ProcessStep:
    """Rename, retype, mark done, link to an interview (or back to automatic), or move.

    `link: auto` clears the interview; `interview_id` alone means a hand link (None: not yet).
    `position` is the new index; the rest of the plan shifts around it.
    """
    unknown = set(fields) - STEP_FIELDS
    if unknown:
        raise InvalidInput(f"cannot edit: {', '.join(sorted(unknown))}")
    step = repo.get_step(step_id)
    if step is None:
        raise NotFound(str(step_id))
    now = clock.now()
    if "name" in fields:
        if not (fields["name"] or "").strip():
            raise InvalidInput("a step needs a name")
        step.name = fields["name"].strip()
    if fields.get("kind"):
        step.kind = StepKind(fields["kind"])
    if "optional" in fields:
        step.optional = bool(fields["optional"])
    if "done_at" in fields:
        step.done_at = fields["done_at"]
    if "interview_id" in fields:
        iv_id = fields["interview_id"]
        if iv_id is not None:
            iv = repo.get_interview(iv_id)
            if iv is None or iv.application_id != step.application_id:
                raise InvalidInput("that interview isn't part of this application")
        step.link, step.interview_id = StepLink.MANUAL, iv_id
    if fields.get("link") == StepLink.AUTO:
        step.link, step.interview_id = StepLink.AUTO, None
    step.updated_at = now
    repo.save_step(step)
    if "position" in fields and fields["position"] is not None:
        steps = [s for s in repo.list_steps(step.application_id) if s.id != step.id]
        steps.insert(max(0, min(int(fields["position"]), len(steps))), step)
        for i, s in enumerate(steps):
            if s.position != i or s.id == step.id:
                s.position = i
                s.updated_at = now
                repo.save_step(s)
    return step


def delete_step(repo: Repository, step_id: uuid.UUID) -> None:
    step = repo.get_step(step_id)
    if step is None:
        raise NotFound(str(step_id))
    repo.delete_step(step_id)
    for i, s in enumerate(repo.list_steps(step.application_id)):
        if s.position != i:
            s.position = i
            repo.save_step(s)


def calendar_since(repo: Repository, clock: Clock, tz: ZoneInfo) -> datetime:
    """How far back the first calendar sync reaches: the first campaign, else six months."""
    starts = [c.started_on for c in repo.list_campaigns()]
    if starts:
        return day_start(min(starts), tz)
    return clock.now() - timedelta(days=180)


def sync_calendar(
    repo: Repository,
    clock: Clock,
    source: CalendarSource,
    since: datetime,
    my_addresses: set[str],
) -> CalendarReport:
    """Pull calendar changes since the last sync (everything from `since` the first time), match
    them, and refresh every application. Also turns invite-email times into interviews."""
    token = repo.get_calendar_sync(source.calendar_id)
    full = token is None
    try:
        changes = source.fetch_changes(token, since)
    except CalendarSyncExpired:
        changes, full = source.fetch_changes(None, since), True
    with repo.transaction():
        report, touched = apply_calendar_items(
            repo, clock, source.calendar_id, changes.items, my_addresses
        )
        report.full_sync = full
        for app in repo.list_applications():
            if sync_email_interviews(repo, clock, app.id):
                touched.add(app.id)
        for app_id in touched:
            recompute(repo, clock, app_id)
        repo.set_calendar_sync(source.calendar_id, changes.next_sync_token)
    return report


def mark_reviewed(repo: Repository, clock: Clock, app_id: uuid.UUID) -> Application:
    app = repo.get_application(app_id)
    if app is None:
        raise NotFound(str(app_id))
    app.needs_review = False
    app.updated_at = clock.now()
    repo.update_application(app)
    return app


CSV_COLUMNS = [
    "company", "role", "job_url", "company_domain", "source_ats", "source_channel",
    "applied_at", "stage", "seniority", "stack", "location", "notes",
]  # fmt: skip


def _parse_date(value: str, tz: ZoneInfo) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    for parser in (datetime.fromisoformat, lambda v: datetime.strptime(v, "%d/%m/%Y")):
        try:
            parsed = parser(value)
        except ValueError:
            continue
        if isinstance(parsed, datetime) and parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=tz)
        return parsed.astimezone(UTC)
    raise InvalidInput(f"unrecognized date {value!r} (use YYYY-MM-DD or DD/MM/YYYY)")


def parse_csv(text: str, tz: ZoneInfo) -> list[ApplicationInput]:
    reader = csv.DictReader(io.StringIO(text.strip()))
    if not reader.fieldnames or not {"company", "role"} <= {
        f.strip().lower() for f in reader.fieldnames
    }:
        raise InvalidInput(
            f"CSV needs at least 'company' and 'role' columns; supported: {', '.join(CSV_COLUMNS)}"
        )
    rows: list[ApplicationInput] = []
    for i, row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        try:
            stage = Stage(row["stage"].lower()) if row.get("stage") else None
        except ValueError as err:
            raise InvalidInput(f"line {i}: unknown stage {row['stage']!r}") from err
        if not row.get("company") or not row.get("role"):
            raise InvalidInput(f"line {i}: company and role are required")
        rows.append(
            ApplicationInput(
                company=row["company"],
                role_title=row["role"],
                job_url=row.get("job_url") or None,
                company_domain=row.get("company_domain") or None,
                source_ats=row.get("source_ats") or None,
                source_channel=row.get("source_channel") or None,
                applied_at=_parse_date(row.get("applied_at", ""), tz),
                stage=stage,
                seniority=row.get("seniority") or None,
                stack=[s for s in row.get("stack", "").replace(",", ";").split(";") if s.strip()],
                location=row.get("location") or None,
                notes=row.get("notes") or None,
            )
        )
    return rows


def day_start(d: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, time.min, tzinfo=tz).astimezone(UTC)
