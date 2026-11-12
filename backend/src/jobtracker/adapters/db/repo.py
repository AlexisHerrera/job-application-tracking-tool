"""Repository on Postgres (local docker compose) and Aurora DSQL (prod). Plain SQL, psycopg 3."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from enum import Enum

import psycopg
from psycopg.types.json import Jsonb

from jobtracker.adapters.db.connect import DsqlTarget, connect_dsql, connect_url
from jobtracker.core.models import (
    AliasKind,
    Application,
    Campaign,
    Company,
    CompanyAlias,
    DiscoveryRun,
    DiscoverySearch,
    Event,
    EventKind,
    EventType,
    Interview,
    InterviewNote,
    InterviewSource,
    InterviewStatus,
    JobPosting,
    MatchMethod,
    Origin,
    PostingStatus,
    ProcessStep,
    Stage,
    StepKind,
    StepLink,
)
from jobtracker.core.ports import SyncState, ThreadMatch
from jobtracker.settings import Settings


def _v(value):
    return value.value if isinstance(value, Enum) else value


def _now() -> datetime:
    return datetime.now(UTC)


APP_COLUMNS = [
    "id", "company_id", "role_title", "job_url", "job_description", "source_ats", "source_channel",
    "seniority", "stack", "location", "applied_at", "current_stage", "current_round",
    "max_stage_reached", "outcome", "last_event_at", "next_interview_at", "origin", "needs_review",
    "notes", "created_at", "updated_at", "salary_min", "salary_max", "salary_currency", "benefits",
]  # fmt: skip
EVENT_COLUMNS = [
    "id", "application_id", "company_hint_id", "kind", "event_type", "occurred_at", "message_id",
    "gm_thread_id", "in_reply_to", "refs", "from_address", "from_name", "subject", "snippet",
    "stage_implied", "round", "interview_at", "needs_reply", "replied_at", "summary", "confidence",
    "extraction", "model", "filter_path", "match_method", "assigned_by", "dismissed", "created_at",
    "ical_uid",
]  # fmt: skip
NOTE_COLUMNS = [
    "id", "application_id", "round", "interview_at", "interview_type", "interviewers", "questions",
    "self_rating", "went_well", "went_wrong", "topics_to_study", "created_at", "updated_at",
    "interview_id", "body",
]  # fmt: skip
INTERVIEW_COLUMNS = [
    "id", "application_id", "company_hint_id", "source", "status", "starts_at", "ends_at", "title",
    "round", "interview_type", "location", "meeting_url", "organizer", "attendees", "calendar_id",
    "calendar_event_id", "ical_uid", "html_link", "event_id", "match_method", "assigned_by",
    "dismissed", "created_at", "updated_at", "general", "notes",
]  # fmt: skip
POSTING_COLUMNS = [
    "id", "source", "source_id", "search_id", "url", "title", "company", "company_normalized",
    "location", "employment_type", "salary_text", "salary_min", "salary_max", "salary_period",
    "publisher", "posted_at", "description", "fetched_at", "drop_reason", "ai_verdict", "ai_score",
    "ai_result", "ai_model", "prompt_version", "status", "application_id", "updated_at",
]  # fmt: skip
RUN_COLUMNS = [
    "id", "started_at", "finished_at", "trigger", "jsearch_requests", "fetched", "new", "dropped",
    "llm_calls", "errors", "notes",
]  # fmt: skip
STEP_COLUMNS = [
    "id", "application_id", "position", "name", "kind", "optional", "link", "interview_id",
    "done_at", "created_at", "updated_at",
]  # fmt: skip


def _app_row(a: Application) -> dict:
    return {
        **{c: _v(getattr(a, c)) for c in APP_COLUMNS if c != "stack"},
        "stack": Jsonb(a.stack),
    }


def _app_from(r: dict) -> Application:
    return Application(
        id=r["id"],
        company_id=r["company_id"],
        company_name=r.get("company_name") or "",
        role_title=r["role_title"],
        job_url=r["job_url"],
        job_description=r["job_description"],
        source_ats=r["source_ats"],
        source_channel=r["source_channel"],
        seniority=r["seniority"],
        stack=list(r["stack"] or []),
        location=r["location"],
        salary_min=r["salary_min"],
        salary_max=r["salary_max"],
        salary_currency=r["salary_currency"],
        benefits=r["benefits"],
        applied_at=r["applied_at"],
        current_stage=Stage(r["current_stage"]),
        current_round=r["current_round"],
        max_stage_reached=Stage(r["max_stage_reached"]),
        outcome=Stage(r["outcome"]) if r["outcome"] else None,
        last_event_at=r["last_event_at"],
        next_interview_at=r["next_interview_at"],
        origin=Origin(r["origin"]),
        needs_review=r["needs_review"],
        notes=r["notes"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


def _event_row(e: Event) -> dict:
    row = {c: _v(getattr(e, c)) for c in EVENT_COLUMNS if c not in {"refs", "extraction"}}
    row["refs"] = " ".join(e.references) or None
    row["extraction"] = Jsonb(e.extraction) if e.extraction is not None else None
    return row


def _event_from(r: dict) -> Event:
    return Event(
        id=r["id"],
        application_id=r["application_id"],
        company_hint_id=r["company_hint_id"],
        kind=EventKind(r["kind"]),
        event_type=EventType(r["event_type"]),
        occurred_at=r["occurred_at"],
        message_id=r["message_id"],
        gm_thread_id=r["gm_thread_id"],
        in_reply_to=r["in_reply_to"],
        references=(r["refs"] or "").split(),
        from_address=r["from_address"],
        from_name=r["from_name"],
        subject=r["subject"],
        snippet=r["snippet"],
        stage_implied=Stage(r["stage_implied"]) if r["stage_implied"] else None,
        round=r["round"],
        interview_at=r["interview_at"],
        needs_reply=r["needs_reply"],
        replied_at=r["replied_at"],
        summary=r["summary"],
        confidence=r["confidence"],
        extraction=r["extraction"],
        model=r["model"],
        filter_path=r["filter_path"],
        match_method=MatchMethod(r["match_method"]),
        assigned_by=r["assigned_by"],
        dismissed=r["dismissed"],
        ical_uid=r["ical_uid"],
        created_at=r["created_at"],
    )


def _note_row(n: InterviewNote) -> dict:
    row = {c: _v(getattr(n, c)) for c in NOTE_COLUMNS if c not in {"questions", "topics_to_study"}}
    row["questions"] = Jsonb(n.questions)
    row["topics_to_study"] = Jsonb(n.topics_to_study)
    return row


def _note_from(r: dict) -> InterviewNote:
    return InterviewNote(
        **{c: r[c] for c in NOTE_COLUMNS if c not in {"questions", "topics_to_study"}},
        questions=list(r["questions"] or []),
        topics_to_study=list(r["topics_to_study"] or []),
    )


def _interview_row(iv: Interview) -> dict:
    row = {c: _v(getattr(iv, c)) for c in INTERVIEW_COLUMNS if c != "attendees"}
    row["attendees"] = Jsonb(iv.attendees)
    return row


def _interview_from(r: dict) -> Interview:
    return Interview(
        **{
            c: r[c]
            for c in INTERVIEW_COLUMNS
            if c not in {"attendees", "source", "status", "match_method", "general"}
        },
        general=bool(r["general"]),
        attendees=list(r["attendees"] or []),
        source=InterviewSource(r["source"]),
        status=InterviewStatus(r["status"]),
        match_method=MatchMethod(r["match_method"]),
    )


def _step_from(r: dict) -> ProcessStep:
    return ProcessStep(
        **{c: r[c] for c in STEP_COLUMNS if c not in {"kind", "link"}},
        kind=StepKind(r["kind"]),
        link=StepLink(r["link"]),
    )


def _posting_row(p: JobPosting) -> dict:
    row = {c: _v(getattr(p, c)) for c in POSTING_COLUMNS}
    row["ai_result"] = Jsonb(p.ai_result) if p.ai_result is not None else None
    return row


def _posting_from(r: dict) -> JobPosting:
    data = {c: r[c] for c in POSTING_COLUMNS}
    data["status"] = PostingStatus(r["status"])
    return JobPosting(**data)


def _run_from(r: dict) -> DiscoveryRun:
    data = {c: r[c] for c in RUN_COLUMNS}
    data["notes"] = [n for n in (r["notes"] or "").split("\n") if n]
    return DiscoveryRun(**data)


def _insert(table: str, row: dict) -> str:
    cols = ", ".join(row)
    vals = ", ".join(f"%({c})s" for c in row)
    return f"INSERT INTO {table} ({cols}) VALUES ({vals})"


def _update(table: str, row: dict) -> str:
    sets = ", ".join(f"{c} = %({c})s" for c in row if c != "id")
    return f"UPDATE {table} SET {sets} WHERE id = %(id)s"


_APP_SELECT = (
    "SELECT a.*, c.name AS company_name FROM applications a JOIN companies c ON c.id = a.company_id"
)


INGEST_LOCK_KEY = 0x6A6F6273  # arbitrary, constant across processes
DISCOVERY_LOCK_KEY = 0x6A6F6274


class PostgresRepo:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self._providers: dict[str, tuple[str, str]] | None = None

    @classmethod
    def connect(cls, conninfo: str) -> PostgresRepo:
        return cls(connect_url(conninfo))

    @classmethod
    def open(cls, settings: Settings) -> PostgresRepo:
        """Aurora DSQL with IAM auth when DSQL_ENDPOINT is set (prod), else DATABASE_URL."""
        if settings.dsql_endpoint:
            return cls(connect_dsql(DsqlTarget(settings.dsql_endpoint, settings.dsql_user)))
        return cls.connect(settings.database_url)

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self.conn.transaction():
            yield

    def _all(self, sql: str, params: tuple | dict = ()) -> list[dict]:
        return self.conn.execute(sql, params).fetchall()

    def _one(self, sql: str, params: tuple | dict = ()) -> dict | None:
        return self.conn.execute(sql, params).fetchone()

    # ingestion bookkeeping
    def is_processed(self, message_id: str) -> bool:
        return (
            self._one("SELECT 1 FROM processed_messages WHERE message_id = %s", (message_id,))
            is not None
        )

    def processed_verdict(self, message_id: str) -> str | None:
        r = self._one("SELECT verdict FROM processed_messages WHERE message_id = %s", (message_id,))
        return r["verdict"] if r else None

    def record_processed(self, message_id, uid, verdict, stage, reason) -> None:
        self.conn.execute(
            "INSERT INTO processed_messages (message_id, uid, verdict, stage, reason, processed_at)"
            " VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (message_id) DO UPDATE SET"
            " verdict = EXCLUDED.verdict, stage = EXCLUDED.stage, reason = EXCLUDED.reason,"
            " processed_at = EXCLUDED.processed_at",
            (message_id, uid, verdict, stage, reason, _now()),
        )

    def get_sync_state(self, mailbox: str) -> SyncState | None:
        r = self._one("SELECT * FROM mail_sync_state WHERE mailbox = %s", (mailbox,))
        return SyncState(r["mailbox"], r["uidvalidity"], r["last_uid"]) if r else None

    def set_sync_state(self, state: SyncState) -> None:
        self.conn.execute(
            "INSERT INTO mail_sync_state (mailbox, uidvalidity, last_uid, updated_at)"
            " VALUES (%s, %s, %s, %s) ON CONFLICT (mailbox) DO UPDATE SET"
            " uidvalidity = EXCLUDED.uidvalidity, last_uid = EXCLUDED.last_uid,"
            " updated_at = EXCLUDED.updated_at",
            (state.mailbox, state.uidvalidity, state.last_uid, _now()),
        )

    def max_processed_uid(self) -> int | None:
        r = self._one("SELECT max(uid) AS uid FROM processed_messages")
        return r["uid"] if r else None

    def last_sync_at(self) -> datetime | None:
        r = self._one("SELECT max(updated_at) AS at FROM mail_sync_state")
        return r["at"] if r else None

    def try_ingest_lock(self) -> bool:
        """Session advisory lock so two local scans can't process the same mail at once; released
        when the connection closes. Local Postgres only: Aurora DSQL has no advisory locks, so in
        AWS the ingest Lambda takes a lease instead (`acquire_lease`)."""
        r = self._one("SELECT pg_try_advisory_lock(%s) AS ok", (INGEST_LOCK_KEY,))
        return bool(r and r["ok"])

    def try_discovery_lock(self) -> bool:
        """Same idea for discovery runs started from the page (local only)."""
        r = self._one("SELECT pg_try_advisory_lock(%s) AS ok", (DISCOVERY_LOCK_KEY,))
        return bool(r and r["ok"])

    def acquire_lease(self, name: str, holder: str, seconds: float) -> bool:
        """Take the named lease unless someone else holds an unexpired one. One statement (its own
        transaction): on Postgres a second taker waits for the first and then sees its row; on
        DSQL two takers write the same key and the loser's commit fails (OCC), which is a no."""
        now = _now()
        try:
            r = self._one(
                "INSERT INTO ingest_lease (name, holder, acquired_at, expires_at)"
                " VALUES (%s, %s, %s, %s) ON CONFLICT (name) DO UPDATE SET"
                " holder = EXCLUDED.holder, acquired_at = EXCLUDED.acquired_at,"
                " expires_at = EXCLUDED.expires_at"
                " WHERE ingest_lease.expires_at <= EXCLUDED.acquired_at"
                " OR ingest_lease.holder = EXCLUDED.holder"
                " RETURNING holder",
                (name, holder, now, now + timedelta(seconds=seconds)),
            )
        except (psycopg.errors.SerializationFailure, psycopg.errors.UniqueViolation):
            return False
        return r is not None

    def release_lease(self, name: str, holder: str) -> None:
        """Only the holder's own lease: one that expired and was taken over stays put."""
        self.conn.execute(
            "DELETE FROM ingest_lease WHERE name = %s AND holder = %s", (name, holder)
        )

    # companies
    def _provider_rows(self) -> dict[str, tuple[str, str]]:
        if self._providers is None:
            rows = self._all("SELECT domain, provider, kind FROM ats_providers")
            self._providers = {r["domain"]: (r["provider"], r["kind"]) for r in rows}
        return self._providers

    def ats_domains(self) -> dict[str, str]:
        return {d: p for d, (p, k) in self._provider_rows().items() if k != "agency"}

    def agency_domains(self) -> dict[str, str]:
        return {d: p for d, (p, k) in self._provider_rows().items() if k == "agency"}

    def company_domains(self) -> set[str]:
        rows = self._all(
            "SELECT value FROM company_aliases WHERE kind = %s", (AliasKind.DOMAIN.value,)
        )
        return {r["value"] for r in rows}

    @staticmethod
    def _company_from(r: dict) -> Company:
        return Company(
            id=r["id"], name=r["name"], normalized_name=r["normalized_name"],
            website=r["website"], created_at=r["created_at"],
        )  # fmt: skip

    def get_company(self, company_id: uuid.UUID) -> Company | None:
        r = self._one("SELECT * FROM companies WHERE id = %s", (company_id,))
        return self._company_from(r) if r else None

    def find_company_by_alias(self, kind: AliasKind, value: str) -> Company | None:
        r = self._one(
            "SELECT c.* FROM companies c JOIN company_aliases a ON a.company_id = c.id"
            " WHERE a.kind = %s AND a.value = %s",
            (kind.value, value.lower()),
        )
        return self._company_from(r) if r else None

    def find_company_by_name(self, normalized_name: str) -> Company | None:
        r = self._one("SELECT * FROM companies WHERE normalized_name = %s", (normalized_name,))
        return self._company_from(r) if r else None

    def list_companies(self) -> list[Company]:
        return [self._company_from(r) for r in self._all("SELECT * FROM companies ORDER BY name")]

    def list_aliases(self, company_id: uuid.UUID) -> list[CompanyAlias]:
        rows = self._all(
            "SELECT * FROM company_aliases WHERE company_id = %s ORDER BY kind, value",
            (company_id,),
        )
        return [
            CompanyAlias(
                r["company_id"], AliasKind(r["kind"]), r["value"], r["learned_from"], r["id"]
            )
            for r in rows
        ]

    def add_company(self, company: Company) -> None:
        self.conn.execute(
            "INSERT INTO companies (id, name, normalized_name, website, created_at)"
            " VALUES (%s, %s, %s, %s, %s)",
            (
                company.id,
                company.name,
                company.normalized_name,
                company.website,
                company.created_at or _now(),
            ),
        )

    def add_alias(self, alias: CompanyAlias) -> bool:
        cur = self.conn.execute(
            "INSERT INTO company_aliases (id, company_id, kind, value, learned_from, created_at)"
            " VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (kind, value) DO NOTHING",
            (
                alias.id,
                alias.company_id,
                alias.kind.value,
                alias.value.lower(),
                alias.learned_from,
                _now(),
            ),
        )
        return cur.rowcount == 1

    # applications
    def list_applications(self) -> list[Application]:
        return [
            _app_from(r) for r in self._all(f"{_APP_SELECT} ORDER BY a.applied_at DESC NULLS LAST")
        ]

    def get_application(self, app_id: uuid.UUID) -> Application | None:
        r = self._one(f"{_APP_SELECT} WHERE a.id = %s", (app_id,))
        return _app_from(r) if r else None

    def add_application(self, app: Application) -> None:
        row = _app_row(app)
        self.conn.execute(_insert("applications", row), row)

    def update_application(self, app: Application) -> None:
        row = _app_row(app)
        self.conn.execute(_update("applications", row), row)

    def delete_application(self, app_id: uuid.UUID) -> None:
        self.conn.execute(
            "DELETE FROM events WHERE application_id = %s AND kind = %s",
            (app_id, EventKind.MANUAL.value),
        )
        self.conn.execute("DELETE FROM applications WHERE id = %s", (app_id,))

    # events
    def add_event(self, event: Event) -> None:
        row = _event_row(event)
        self.conn.execute(_insert("events", row), row)

    def get_event(self, event_id: uuid.UUID) -> Event | None:
        r = self._one("SELECT * FROM events WHERE id = %s", (event_id,))
        return _event_from(r) if r else None

    def get_event_by_message_id(self, message_id: str) -> Event | None:
        r = self._one("SELECT * FROM events WHERE message_id = %s", (message_id,))
        return _event_from(r) if r else None

    def list_events(self, application_id: uuid.UUID) -> list[Event]:
        rows = self._all(
            "SELECT * FROM events WHERE application_id = %s ORDER BY occurred_at", (application_id,)
        )
        return [_event_from(r) for r in rows]

    def list_all_events(self) -> list[Event]:
        return [_event_from(r) for r in self._all("SELECT * FROM events ORDER BY occurred_at")]

    def list_unassigned(self) -> list[Event]:
        rows = self._all(
            "SELECT * FROM events WHERE application_id IS NULL AND dismissed = false"
            " ORDER BY occurred_at DESC"
        )
        return [_event_from(r) for r in rows]

    def update_event(self, event: Event) -> None:
        row = _event_row(event)
        self.conn.execute(_update("events", row), row)

    def thread_lookup(self, gm_thread_id: str | None, message_ids: list[str]) -> ThreadMatch:
        ids = [m for m in message_ids if m]
        if not gm_thread_id and not ids:
            return ThreadMatch(False)
        rows = self._all(
            "SELECT application_id FROM events WHERE (gm_thread_id = %s::text AND %s::text IS NOT NULL)"
            " OR message_id = ANY(%s::text[]) ORDER BY occurred_at DESC",
            (gm_thread_id, gm_thread_id, ids),
        )
        if not rows:
            return ThreadMatch(False)
        assigned = next((r["application_id"] for r in rows if r["application_id"]), None)
        return ThreadMatch(True, assigned)

    def mark_thread_replied(self, gm_thread_id: str, at: datetime) -> int:
        cur = self.conn.execute(
            "UPDATE events SET replied_at = %s WHERE gm_thread_id = %s AND needs_reply = true"
            " AND replied_at IS NULL AND occurred_at <= %s",
            (at, gm_thread_id, at),
        )
        return cur.rowcount

    # campaigns
    @staticmethod
    def _campaign_from(r: dict) -> Campaign:
        return Campaign(
            id=r["id"], name=r["name"], started_on=r["started_on"], ended_on=r["ended_on"],
            notes=r["notes"], created_at=r["created_at"],
        )  # fmt: skip

    def list_campaigns(self) -> list[Campaign]:
        return [
            self._campaign_from(r) for r in self._all("SELECT * FROM campaigns ORDER BY started_on")
        ]

    def get_campaign(self, campaign_id: uuid.UUID) -> Campaign | None:
        r = self._one("SELECT * FROM campaigns WHERE id = %s", (campaign_id,))
        return self._campaign_from(r) if r else None

    def save_campaign(self, c: Campaign) -> None:
        self.conn.execute(
            "INSERT INTO campaigns (id, name, started_on, ended_on, notes, created_at)"
            " VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,"
            " started_on = EXCLUDED.started_on, ended_on = EXCLUDED.ended_on, notes = EXCLUDED.notes",
            (c.id, c.name, c.started_on, c.ended_on, c.notes, c.created_at or _now()),
        )

    def delete_campaign(self, campaign_id: uuid.UUID) -> None:
        self.conn.execute("DELETE FROM campaigns WHERE id = %s", (campaign_id,))

    # interview notes
    def list_notes(self, application_id: uuid.UUID | None = None) -> list[InterviewNote]:
        if application_id is None:
            rows = self._all("SELECT * FROM interview_notes ORDER BY interview_at NULLS LAST")
        else:
            rows = self._all(
                "SELECT * FROM interview_notes WHERE application_id = %s ORDER BY interview_at NULLS LAST",
                (application_id,),
            )
        return [_note_from(r) for r in rows]

    def get_note(self, note_id: uuid.UUID) -> InterviewNote | None:
        r = self._one("SELECT * FROM interview_notes WHERE id = %s", (note_id,))
        return _note_from(r) if r else None

    def save_note(self, note: InterviewNote) -> None:
        row = _note_row(note)
        cols = [c for c in row if c not in {"id", "created_at"}]
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
        self.conn.execute(
            f"{_insert('interview_notes', row)} ON CONFLICT (id) DO UPDATE SET {sets}", row
        )

    def delete_note(self, note_id: uuid.UUID) -> None:
        self.conn.execute("DELETE FROM interview_notes WHERE id = %s", (note_id,))

    # interviews
    def list_interviews(self, application_id: uuid.UUID | None = None) -> list[Interview]:
        if application_id is None:
            rows = self._all("SELECT * FROM interviews ORDER BY starts_at")
        else:
            rows = self._all(
                "SELECT * FROM interviews WHERE application_id = %s ORDER BY starts_at",
                (application_id,),
            )
        return [_interview_from(r) for r in rows]

    def list_unassigned_interviews(self) -> list[Interview]:
        rows = self._all(
            "SELECT * FROM interviews WHERE application_id IS NULL AND dismissed = false"
            " AND general IS NOT TRUE AND status = %s ORDER BY starts_at DESC",
            (InterviewStatus.SCHEDULED.value,),
        )
        return [_interview_from(r) for r in rows]

    def get_interview(self, interview_id: uuid.UUID) -> Interview | None:
        r = self._one("SELECT * FROM interviews WHERE id = %s", (interview_id,))
        return _interview_from(r) if r else None

    def get_interview_by_calendar_event(
        self, calendar_id: str, calendar_event_id: str
    ) -> Interview | None:
        r = self._one(
            "SELECT * FROM interviews WHERE calendar_id = %s AND calendar_event_id = %s",
            (calendar_id, calendar_event_id),
        )
        return _interview_from(r) if r else None

    def save_interview(self, interview: Interview) -> None:
        row = _interview_row(interview)
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in row if c not in {"id", "created_at"})
        self.conn.execute(
            f"{_insert('interviews', row)} ON CONFLICT (id) DO UPDATE SET {sets}", row
        )

    def delete_interview(self, interview_id: uuid.UUID) -> None:
        self.conn.execute("DELETE FROM interviews WHERE id = %s", (interview_id,))

    # process steps
    def list_steps(self, application_id: uuid.UUID) -> list[ProcessStep]:
        rows = self._all(
            "SELECT * FROM process_steps WHERE application_id = %s ORDER BY position, created_at",
            (application_id,),
        )
        return [_step_from(r) for r in rows]

    def get_step(self, step_id: uuid.UUID) -> ProcessStep | None:
        r = self._one("SELECT * FROM process_steps WHERE id = %s", (step_id,))
        return _step_from(r) if r else None

    def save_step(self, step: ProcessStep) -> None:
        row = {c: _v(getattr(step, c)) for c in STEP_COLUMNS}
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in row if c not in {"id", "created_at"})
        self.conn.execute(
            f"{_insert('process_steps', row)} ON CONFLICT (id) DO UPDATE SET {sets}", row
        )

    def delete_step(self, step_id: uuid.UUID) -> None:
        self.conn.execute("DELETE FROM process_steps WHERE id = %s", (step_id,))

    # calendar sync
    def get_calendar_sync(self, calendar_id: str) -> str | None:
        r = self._one(
            "SELECT sync_token FROM calendar_sync_state WHERE calendar_id = %s", (calendar_id,)
        )
        return r["sync_token"] if r else None

    def set_calendar_sync(self, calendar_id: str, sync_token: str | None) -> None:
        self.conn.execute(
            "INSERT INTO calendar_sync_state (calendar_id, sync_token, updated_at)"
            " VALUES (%s, %s, %s) ON CONFLICT (calendar_id) DO UPDATE SET"
            " sync_token = EXCLUDED.sync_token, updated_at = EXCLUDED.updated_at",
            (calendar_id, sync_token, _now()),
        )

    def rename_calendar(self, old_id: str, new_id: str) -> int:
        """The same calendar under a new ID ("primary" → its address): its interviews follow, so
        the next full sync updates them instead of adding copies. The old sync token is dropped.
        Returns how many interviews moved."""
        with self.transaction():
            moved = self.conn.execute(
                "UPDATE interviews SET calendar_id = %s WHERE calendar_id = %s", (new_id, old_id)
            ).rowcount
        with self.transaction():
            self.conn.execute("DELETE FROM calendar_sync_state WHERE calendar_id = %s", (old_id,))
        return moved

    def last_calendar_sync_at(self) -> datetime | None:
        r = self._one("SELECT max(updated_at) AS at FROM calendar_sync_state")
        return r["at"] if r else None

    # OAuth logins (adapter-only: the core never sees tokens)
    def get_oauth(self, provider: str) -> dict | None:
        r = self._one("SELECT data FROM oauth_credentials WHERE provider = %s", (provider,))
        return r["data"] if r else None

    def set_oauth(self, provider: str, data: dict) -> None:
        self.conn.execute(
            "INSERT INTO oauth_credentials (provider, data, updated_at) VALUES (%s, %s, %s)"
            " ON CONFLICT (provider) DO UPDATE SET data = EXCLUDED.data,"
            " updated_at = EXCLUDED.updated_at",
            (provider, Jsonb(data), _now()),
        )

    def delete_oauth(self, provider: str) -> None:
        self.conn.execute("DELETE FROM oauth_credentials WHERE provider = %s", (provider,))

    # job discovery (plan §20)
    def posting_exists(self, source: str, source_id: str) -> bool:
        return (
            self._one(
                "SELECT 1 FROM job_postings WHERE source = %s AND source_id = %s",
                (source, source_id),
            )
            is not None
        )

    def add_posting(self, posting: JobPosting) -> None:
        self.conn.execute(_insert("job_postings", _posting_row(posting)), _posting_row(posting))

    def update_posting(self, posting: JobPosting) -> None:
        row = _posting_row(posting)
        self.conn.execute(_update("job_postings", row), row)

    def get_posting(self, posting_id: uuid.UUID) -> JobPosting | None:
        r = self._one("SELECT * FROM job_postings WHERE id = %s", (posting_id,))
        return _posting_from(r) if r else None

    def list_postings(self, since: datetime | None = None) -> list[JobPosting]:
        if since is None:
            rows = self._all("SELECT * FROM job_postings ORDER BY fetched_at DESC, id")
        else:
            rows = self._all(
                "SELECT * FROM job_postings WHERE fetched_at >= %s ORDER BY fetched_at DESC, id",
                (since,),
            )
        return [_posting_from(r) for r in rows]

    def recent_posting_keys(self, since: datetime) -> list[tuple[str, str]]:
        rows = self._all(
            "SELECT company_normalized, title FROM job_postings WHERE fetched_at >= %s", (since,)
        )
        return [(r["company_normalized"], r["title"]) for r in rows]

    def unscored_postings(self, limit: int) -> list[JobPosting]:
        rows = self._all(
            "SELECT * FROM job_postings WHERE drop_reason IS NULL AND ai_verdict IS NULL"
            " AND status = %s ORDER BY fetched_at, id LIMIT %s",
            (PostingStatus.NEW.value, limit),
        )
        return [_posting_from(r) for r in rows]

    def reset_scores(self, statuses: tuple[PostingStatus, ...], since: datetime) -> int:
        # Only scored rows change. A scored row hidden as a consultancy was hidden by the LLM (the
        # rule hides before scoring), so it gets a second chance too.
        marks = ", ".join(["%s"] * len(statuses))
        return self.conn.execute(
            "UPDATE job_postings SET ai_verdict = NULL, ai_score = NULL, ai_result = NULL,"
            " ai_model = NULL, prompt_version = NULL,"
            " drop_reason = CASE WHEN drop_reason = 'consultancy' THEN NULL ELSE drop_reason END"
            f" WHERE status IN ({marks}) AND fetched_at >= %s AND ai_verdict IS NOT NULL",
            (*[st.value for st in statuses], since),
        ).rowcount

    def list_searches(self) -> list[DiscoverySearch]:
        rows = self._all("SELECT * FROM discovery_searches ORDER BY created_at, id")
        return [
            DiscoverySearch(
                id=r["id"],
                source=r["source"],
                label=r["label"],
                params=dict(r["params"] or {}),
                enabled=r["enabled"],
                created_at=r["created_at"],
            )
            for r in rows
        ]

    def get_search(self, search_id: uuid.UUID) -> DiscoverySearch | None:
        return next((x for x in self.list_searches() if x.id == search_id), None)

    def save_search(self, search: DiscoverySearch) -> None:
        row = {
            "id": search.id,
            "source": search.source,
            "label": search.label,
            "params": Jsonb(search.params),
            "enabled": search.enabled,
            "created_at": search.created_at or _now(),
        }
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in row if c not in {"id", "created_at"})
        self.conn.execute(
            f"{_insert('discovery_searches', row)} ON CONFLICT (id) DO UPDATE SET {sets}", row
        )

    def delete_search(self, search_id: uuid.UUID) -> None:
        self.conn.execute("DELETE FROM discovery_searches WHERE id = %s", (search_id,))

    def get_discovery_setting(self, key: str) -> object | None:
        r = self._one("SELECT value FROM discovery_settings WHERE key = %s", (key,))
        return r["value"] if r else None

    def set_discovery_setting(self, key: str, value: object) -> None:
        self.conn.execute(
            "INSERT INTO discovery_settings (key, value, updated_at) VALUES (%s, %s, %s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,"
            " updated_at = EXCLUDED.updated_at",
            (key, Jsonb(value), _now()),
        )

    def save_run(self, run: DiscoveryRun) -> None:
        row = {c: getattr(run, c) for c in RUN_COLUMNS}
        row["notes"] = "\n".join(run.notes) or None
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in row if c not in {"id", "started_at"})
        self.conn.execute(
            f"{_insert('discovery_runs', row)} ON CONFLICT (id) DO UPDATE SET {sets}", row
        )

    def last_run(self) -> DiscoveryRun | None:
        r = self._one("SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 1")
        return _run_from(r) if r else None

    def jsearch_requests_since(self, since: datetime) -> int:
        r = self._one(
            "SELECT coalesce(sum(jsearch_requests), 0) AS n FROM discovery_runs"
            " WHERE started_at >= %s",
            (since,),
        )
        return int(r["n"]) if r else 0
