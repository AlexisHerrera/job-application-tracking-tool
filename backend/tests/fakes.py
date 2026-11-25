"""In-memory test doubles for the core ports."""

from __future__ import annotations

import copy
import uuid
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime

from jobtracker.core.models import (
    AliasKind,
    Application,
    Company,
    CompanyAlias,
    DiscoveryRun,
    DiscoverySearch,
    Event,
    Interview,
    InterviewNote,
    JobPosting,
    PostingStatus,
    ProcessStep,
)
from jobtracker.core.ports import LLMError, LLMUsage, SyncState, ThreadMatch
from tests.fake_apply import MemoryApplyMixin

FETCH_FIELDS = ("last_fetched_at", "last_found_at", "last_status", "last_count", "fail_streak")

ATS = {
    "ashbyhq.com": "ashby",
    "lever.co": "lever",
    "hire.lever.co": "lever",
    "greenhouse.io": "greenhouse",
    "us.greenhouse-mail.io": "greenhouse",
    "workablemail.com": "workable",
    "calendly.com": "calendly",
}

AGENCIES = {"talentbridge.test": "talentbridge"}


class MemoryRepo(MemoryApplyMixin):
    def __init__(self, ats: dict[str, str] | None = None, agencies: dict[str, str] | None = None):
        self.ats = dict(ATS if ats is None else ats)
        self.agencies = dict(AGENCIES if agencies is None else agencies)
        self.processed: dict[str, tuple] = {}
        self.sync: dict[str, SyncState] = {}
        self.companies: dict[uuid.UUID, Company] = {}
        self.aliases: list[CompanyAlias] = []
        self.apps: dict[uuid.UUID, Application] = {}
        self.events: dict[uuid.UUID, Event] = {}
        self.notes: dict[uuid.UUID, InterviewNote] = {}
        self.campaigns: dict[uuid.UUID, object] = {}
        self.interviews: dict[uuid.UUID, Interview] = {}
        self.steps: dict[uuid.UUID, ProcessStep] = {}
        self.calendar_sync: dict[str, tuple[str | None, datetime]] = {}
        self.oauth: dict[str, dict] = {}
        self.postings: dict[uuid.UUID, JobPosting] = {}
        self.searches: dict[uuid.UUID, DiscoverySearch] = {}
        self.discovery_settings: dict[str, object] = {}
        self._apply_init()
        self.watched: dict = {}
        self.runs: dict[uuid.UUID, DiscoveryRun] = {}

    @contextmanager
    def transaction(self):
        snapshot = copy.deepcopy(self.__dict__)
        try:
            yield
        except Exception:
            self.__dict__.update(snapshot)
            raise

    def is_processed(self, message_id):
        return message_id in self.processed

    def processed_verdict(self, message_id):
        return self.processed[message_id][1] if message_id in self.processed else None

    def record_processed(self, message_id, uid, verdict, stage, reason):
        self.processed[message_id] = (uid, verdict, stage, reason)

    def get_sync_state(self, mailbox):
        s = self.sync.get(mailbox)
        return copy.copy(s) if s else None

    def set_sync_state(self, state):
        self.sync[state.mailbox] = copy.copy(state)
        self.synced_at = datetime.now(UTC)

    def max_processed_uid(self):
        uids = [p[0] for p in self.processed.values() if p[0] is not None]
        return max(uids) if uids else None

    def last_sync_at(self):
        return getattr(self, "synced_at", None)

    def try_ingest_lock(self):
        return True

    def ats_domains(self):
        return self.ats

    def agency_domains(self):
        return self.agencies

    def company_domains(self):
        return {a.value for a in self.aliases if a.kind == AliasKind.DOMAIN}

    def get_company(self, company_id):
        return self.companies.get(company_id)

    def find_company_by_alias(self, kind, value):
        for a in self.aliases:
            if a.kind == kind and a.value == value.lower():
                return self.companies[a.company_id]
        return None

    def find_company_by_name(self, normalized_name):
        return next(
            (c for c in self.companies.values() if c.normalized_name == normalized_name), None
        )

    def list_companies(self):
        return sorted(self.companies.values(), key=lambda c: c.name)

    def list_aliases(self, company_id):
        return [a for a in self.aliases if a.company_id == company_id]

    def add_company(self, company):
        assert company.normalized_name not in {c.normalized_name for c in self.companies.values()}
        self.companies[company.id] = company

    def add_alias(self, alias):
        if any(a.kind == alias.kind and a.value == alias.value.lower() for a in self.aliases):
            return False
        alias.value = alias.value.lower()
        self.aliases.append(alias)
        return True

    def _with_name(self, app):
        app = copy.copy(app)
        app.stack = list(app.stack)
        app.company_name = self.companies[app.company_id].name
        return app

    def list_applications(self):
        return [self._with_name(a) for a in self.apps.values()]

    def get_application(self, app_id):
        a = self.apps.get(app_id)
        return self._with_name(a) if a else None

    def add_application(self, app):
        self.apps[app.id] = copy.copy(app)

    def update_application(self, app):
        assert app.id in self.apps
        self.apps[app.id] = copy.copy(app)

    def delete_application(self, app_id):
        self.events = {
            k: e
            for k, e in self.events.items()
            if not (e.application_id == app_id and e.kind == "manual")
        }
        del self.apps[app_id]

    def add_event(self, event):
        if event.message_id:
            assert all(e.message_id != event.message_id for e in self.events.values())
        self.events[event.id] = copy.copy(event)

    def get_event(self, event_id):
        e = self.events.get(event_id)
        return copy.copy(e) if e else None

    def get_event_by_message_id(self, message_id):
        return next(
            (copy.copy(e) for e in self.events.values() if e.message_id == message_id), None
        )

    def list_events(self, application_id):
        evs = [copy.copy(e) for e in self.events.values() if e.application_id == application_id]
        return sorted(evs, key=lambda e: e.occurred_at)

    def list_all_events(self):
        return sorted((copy.copy(e) for e in self.events.values()), key=lambda e: e.occurred_at)

    def list_unassigned(self):
        return [
            copy.copy(e)
            for e in self.events.values()
            if e.application_id is None and not e.dismissed
        ]

    def update_event(self, event):
        self.events[event.id] = copy.copy(event)

    def thread_lookup(self, gm_thread_id, message_ids):
        ids = {m for m in message_ids if m}
        hits = [
            e
            for e in sorted(self.events.values(), key=lambda e: e.occurred_at, reverse=True)
            if (gm_thread_id and e.gm_thread_id == gm_thread_id) or (e.message_id in ids)
        ]
        if not hits:
            return ThreadMatch(False)
        return ThreadMatch(True, next((e.application_id for e in hits if e.application_id), None))

    def mark_thread_replied(self, gm_thread_id, at: datetime):
        n = 0
        for e in self.events.values():
            if (
                e.gm_thread_id == gm_thread_id
                and e.needs_reply
                and e.replied_at is None
                and e.occurred_at <= at
            ):
                e.replied_at = at
                n += 1
        return n

    def list_campaigns(self):
        return sorted((copy.copy(c) for c in self.campaigns.values()), key=lambda c: c.started_on)

    def get_campaign(self, campaign_id):
        c = self.campaigns.get(campaign_id)
        return copy.copy(c) if c else None

    def save_campaign(self, c):
        self.campaigns[c.id] = copy.copy(c)

    def delete_campaign(self, campaign_id):
        self.campaigns.pop(campaign_id, None)

    def list_notes(self, application_id=None):
        return [
            n
            for n in self.notes.values()
            if application_id is None or n.application_id == application_id
        ]

    def get_note(self, note_id):
        return self.notes.get(note_id)

    def save_note(self, note):
        self.notes[note.id] = note

    def delete_note(self, note_id):
        self.notes.pop(note_id, None)

    def _iv(self, iv):
        iv = copy.copy(iv)
        iv.attendees = list(iv.attendees)
        return iv

    def list_interviews(self, application_id=None):
        rows = [
            self._iv(iv)
            for iv in self.interviews.values()
            if application_id is None or iv.application_id == application_id
        ]
        return sorted(rows, key=lambda iv: iv.starts_at)

    def list_unassigned_interviews(self):
        return [
            iv
            for iv in self.list_interviews()
            if iv.application_id is None
            and not iv.dismissed
            and not iv.general
            and iv.status == "scheduled"
        ]

    def get_interview(self, interview_id):
        iv = self.interviews.get(interview_id)
        return self._iv(iv) if iv else None

    def get_interview_by_calendar_event(self, calendar_id, calendar_event_id):
        return next(
            (
                self._iv(iv)
                for iv in self.interviews.values()
                if iv.calendar_id == calendar_id and iv.calendar_event_id == calendar_event_id
            ),
            None,
        )

    def save_interview(self, interview):
        if interview.calendar_event_id:
            assert all(
                (iv.calendar_id, iv.calendar_event_id)
                != (interview.calendar_id, interview.calendar_event_id)
                for iv in self.interviews.values()
                if iv.id != interview.id
            )
        self.interviews[interview.id] = self._iv(interview)

    def delete_interview(self, interview_id):
        self.interviews.pop(interview_id, None)

    def list_steps(self, application_id):
        rows = [copy.copy(st) for st in self.steps.values() if st.application_id == application_id]
        return sorted(rows, key=lambda st: st.position)

    def get_step(self, step_id):
        st = self.steps.get(step_id)
        return copy.copy(st) if st else None

    def save_step(self, step):
        self.steps[step.id] = copy.copy(step)

    def delete_step(self, step_id):
        self.steps.pop(step_id, None)

    def get_calendar_sync(self, calendar_id):
        return self.calendar_sync.get(calendar_id, (None, None))[0]

    def set_calendar_sync(self, calendar_id, sync_token):
        self.calendar_sync[calendar_id] = (sync_token, datetime.now(UTC))

    def rename_calendar(self, old_id, new_id):
        moved = [iv for iv in self.interviews.values() if iv.calendar_id == old_id]
        for iv in moved:
            iv.calendar_id = new_id
        self.calendar_sync.pop(old_id, None)
        return len(moved)

    def last_calendar_sync_at(self):
        return max((at for _, at in self.calendar_sync.values()), default=None)

    def get_oauth(self, provider):
        return self.oauth.get(provider)

    # job discovery
    def try_discovery_lock(self):
        return True

    def posting_exists(self, source, source_id):
        return any(p.source == source and p.source_id == source_id for p in self.postings.values())

    def add_posting(self, posting):
        assert not self.posting_exists(posting.source, posting.source_id), "unique (source, id)"
        self.postings[posting.id] = copy.deepcopy(posting)

    def update_posting(self, posting):
        self.postings[posting.id] = copy.deepcopy(posting)

    def get_posting(self, posting_id):
        p = self.postings.get(posting_id)
        return copy.deepcopy(p) if p else None

    def list_postings(self, since=None):
        rows = [p for p in self.postings.values() if since is None or p.fetched_at >= since]
        return [copy.deepcopy(p) for p in sorted(rows, key=lambda p: p.fetched_at, reverse=True)]

    def recent_posting_keys(self, since):
        return [
            (p.company_normalized, p.title) for p in self.postings.values() if p.fetched_at >= since
        ]

    def unscored_postings(self, *, include_hidden=False, any_status=False):
        rows = [
            p for p in self.postings.values()
            if p.ai_verdict is None
            and (p.drop_reason is None or (include_hidden and p.drop_reason != "duplicate"))
            and (any_status or p.status == PostingStatus.NEW)
        ]  # fmt: skip
        rows.sort(key=lambda p: (p.fetched_at, str(p.id)))
        return [copy.deepcopy(p) for p in rows]

    def count_unscored(self):
        return len(self.unscored_postings())

    def drop_reason_counts(self):
        counts: dict[tuple[str, str], int] = {}
        for p in self.postings.values():
            if p.drop_reason:
                key = (p.drop_reason, p.company_normalized or "")
                counts[key] = counts.get(key, 0) + 1
        return [(reason, company, n) for (reason, company), n in counts.items()]

    def insight_postings(self, since):
        kept = (PostingStatus.INTERESTED, PostingStatus.APPLIED)
        rows = [
            p for p in self.postings.values()
            if (p.fetched_at and p.fetched_at >= since)
            or (p.reviewed_at and p.reviewed_at >= since)
            or p.status in kept
        ]  # fmt: skip
        # Like the SQL, which reads only the columns the page uses.
        return [
            replace(copy.deepcopy(p), description="", url="", source_id="", ai_result=None)
            for p in rows
        ]

    def postings_to_recheck(self, reasons):
        rows = [
            p for p in self.postings.values()
            if (p.drop_reason is None and p.status == PostingStatus.NEW) or p.drop_reason in reasons
        ]  # fmt: skip
        rows.sort(key=lambda p: (p.fetched_at, str(p.id)))
        return [copy.deepcopy(p) for p in rows]

    def search_postings(self, query):
        from jobtracker.core import discovery

        rows = [p for p in self.postings.values() if discovery.matches(p, query)]
        rows = discovery.sort_postings(rows, query.sort)
        page = rows[query.offset : query.offset + query.limit]
        return [copy.deepcopy(p) for p in page], len(rows)

    def count_postings(self, query):
        from jobtracker.core import discovery

        return sum(discovery.matches(p, query) for p in self.postings.values())

    def facet_postings(self):
        return [copy.deepcopy(p) for p in self.postings.values()]

    def reset_scores(self, statuses, since):
        n = 0
        for p in self.postings.values():
            if p.status in statuses and p.fetched_at >= since and p.ai_verdict is not None:
                p.ai_verdict = p.ai_score = p.ai_result = p.ai_model = p.prompt_version = None
                if p.drop_reason == "consultancy":
                    p.drop_reason = None
                n += 1
        return n

    def list_searches(self):
        return [copy.deepcopy(x) for x in self.searches.values()]

    def get_search(self, search_id):
        x = self.searches.get(search_id)
        return copy.deepcopy(x) if x else None

    def save_search(self, search):
        search.created_at = search.created_at or datetime.now(UTC)
        kept = self.searches.get(search.id)
        row = copy.deepcopy(search)
        for c in FETCH_FIELDS:  # like the SQL: saving from the page leaves the fetch status
            setattr(row, c, getattr(kept, c) if kept else getattr(DiscoverySearch("", "", {}), c))
        self.searches[search.id] = row

    def record_search_fetch(self, search):
        if (row := self.searches.get(search.id)) is not None:
            for c in FETCH_FIELDS:
                setattr(row, c, getattr(search, c))

    def delete_search(self, search_id):
        self.searches.pop(search_id, None)

    def get_discovery_setting(self, key):
        return copy.deepcopy(self.discovery_settings.get(key))

    def set_discovery_setting(self, key, value):
        self.discovery_settings[key] = copy.deepcopy(value)

    def save_run(self, run):
        self.runs[run.id] = copy.deepcopy(run)

    def last_run(self, *, except_trigger=None):
        runs = [r for r in self.runs.values() if r.trigger != except_trigger]
        return max(runs, key=lambda r: r.started_at, default=None)

    def list_runs(self, limit):
        return sorted(self.runs.values(), key=lambda r: r.started_at, reverse=True)[:limit]

    def list_watched(self):
        rows = sorted(self.watched.values(), key=lambda c: (c.name, c.ats, c.slug))
        return [copy.deepcopy(c) for c in rows]

    def save_watched(self, company):
        clash = [
            c for c in self.watched.values()
            if (c.ats, c.slug) == (company.ats, company.slug) and c.id != company.id
        ]  # fmt: skip
        assert not clash, "unique (ats, slug)"
        company.created_at = company.created_at or datetime.now(UTC)
        self.watched[company.id] = copy.deepcopy(company)

    def hide_company_postings(self, company_normalized, reason):
        n = 0
        for p in self.postings.values():
            if p.company_normalized == company_normalized and p.drop_reason is None:
                p.drop_reason = reason
                n += 1
        return n


class FakeBoards:
    """Scripted company boards: `jobs` maps (ats, slug) to the postings on that board; a board
    that isn't there is gone (404), and one in `broken` fails."""

    def __init__(self, jobs=None, broken=()):
        self.jobs = dict(jobs or {})
        self.broken = set(broken)
        self.calls: list[tuple[str, str]] = []

    def fetch_board(self, ats, slug, company):
        from jobtracker.core.ports import SourceError

        self.calls.append((ats, slug))
        if (ats, slug) in self.broken:
            raise SourceError(f"{ats} HTTP 500")
        if (ats, slug) not in self.jobs:
            raise SourceError(f"{ats} board {slug} not found", gone=True)
        return [copy.deepcopy(p) for p in self.jobs[(ats, slug)]]


class FakeSource:
    """A job source returning scripted postings per search `query`/`feed`."""

    def __init__(self, postings=(), fail=False):
        self.postings = list(postings)
        self.fail = fail
        self.calls: list[dict] = []

    def fetch(self, params):
        from jobtracker.core.ports import FetchResult, SourceError

        self.calls.append(params)
        if self.fail:
            raise SourceError("HTTP 500")
        return FetchResult([copy.deepcopy(p) for p in self.postings])


class FakeCalendar:
    """Scripted calendar: a full sync returns `items`; an incremental one returns `changes`."""

    calendar_id = "primary"

    def __init__(self, items=(), changes=(), expired=False):
        self.items, self.changes, self.expired = list(items), list(changes), expired
        self.calls: list[str | None] = []

    def fetch_changes(self, sync_token, since):
        from jobtracker.core.ports import CalendarChanges, CalendarSyncExpired

        self.calls.append(sync_token)
        if sync_token is not None and self.expired:
            self.expired = False
            raise CalendarSyncExpired()
        items = self.items if sync_token is None else self.changes
        return CalendarChanges(list(items), f"token-{len(self.calls)}")


class FakeLLM:
    """Scripted responses keyed by a substring of the user prompt (the rendered email)."""

    model = "fake-model"

    def __init__(
        self,
        gate: dict[str, bool] | None = None,
        extract: dict[str, dict] | None = None,
        discover: dict[str, dict] | None = None,
    ):
        self.gate = gate or {}
        self.extract = extract or {}
        self.discover = discover or {}
        self.calls: list[str] = []
        self.usage = LLMUsage()
        self.fail_with: Exception | None = None
        self.paste_response: dict = {"applications": []}

    def complete_json(self, *, system, user, schema, max_tokens):
        if self.fail_with:
            raise self.fail_with
        if "verdict" in schema["properties"]:
            self.calls.append("discover")
            self.usage.add(LLMUsage(1, len(user) // 4, 100))
            for key, value in self.discover.items():
                if key in user:
                    return value
            return verdict()
        if "applications" in schema["properties"]:
            self.calls.append("paste")
            self.usage.add(LLMUsage(1, len(user) // 4, 200))
            return self.paste_response
        kind = "gate" if "is_job_process" in schema["properties"] else "extract"
        self.calls.append(kind)
        self.usage.add(LLMUsage(1, len(user) // 4, 50))
        table = self.gate if kind == "gate" else self.extract
        for key, value in table.items():
            if key in user:
                return {"is_job_process": value, "reason": "scripted"} if kind == "gate" else value
        if kind == "gate":
            return {"is_job_process": False, "reason": "default"}
        raise LLMError("no scripted extraction for this email")


def extraction(**overrides) -> dict:
    base = {
        "is_job_related": True,
        "company": None,
        "role": None,
        "event_type": "other",
        "stage_implied": None,
        "round": None,
        "interview_at": None,
        "needs_reply": False,
        "summary": "scripted",
        "confidence": 0.9,
    }
    return {**base, **overrides}


def paste_record(**overrides) -> dict:
    from jobtracker.core.paste import RECORD_PROPERTIES

    # Mirrors the real schema: "" / 0 mean unknown (no nullable fields).
    base = {k: 0 if k.startswith("salary_m") else "" for k in RECORD_PROPERTIES}
    base.update({"stack": [], "process_steps": [], "evidence": "scripted"})
    return {**base, **overrides}


def verdict(**overrides) -> dict:
    base = {
        "verdict": "maybe",
        "score": 55,
        "reasons": ["scripted"],
        "location_fit": "unclear",
        "seniority": "senior",
        "years_required": None,
        "employer_kind": "direct",
        "ai_related": False,
        "stack_overlap": [],
        "technologies": [],
        "work_mode": "unclear",
        "company_size": "unclear",
        "sector": "unclear",
        "salary_min": None,
        "salary_max": None,
        "salary_currency": None,
        "salary_period": "unclear",
    }
    return {**base, **overrides}


def posting(**overrides) -> JobPosting:
    base = {
        "source": "getonbrd",
        "source_id": overrides.pop("source_id", str(uuid.uuid4())),
        "url": "https://jobs.example.test/1",
        "title": "Senior Full Stack Engineer",
        "company": "Northwind Pay",
        "description": "TypeScript, React, Node.js. Remote from LATAM.",
        "location": "Argentina",
    }
    return JobPosting(**{**base, **overrides})
