"""Repository on Postgres (local docker compose) and Aurora DSQL (prod). Plain SQL, psycopg 3."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from enum import Enum

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from jobtracker.core.models import (
    AliasKind,
    Application,
    Campaign,
    Company,
    CompanyAlias,
    Event,
    EventKind,
    EventType,
    InterviewNote,
    MatchMethod,
    Origin,
    Stage,
)
from jobtracker.core.ports import SyncState, ThreadMatch


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
]  # fmt: skip
NOTE_COLUMNS = [
    "id", "application_id", "round", "interview_at", "interview_type", "interviewers", "questions",
    "self_rating", "went_well", "went_wrong", "topics_to_study", "created_at", "updated_at",
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


class PostgresRepo:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self._providers: dict[str, tuple[str, str]] | None = None

    @classmethod
    def connect(cls, conninfo: str) -> PostgresRepo:
        return cls(psycopg.connect(conninfo, autocommit=True, row_factory=dict_row))

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
        AWS the ingest Lambda's reserved concurrency serializes runs instead (Phase 3)."""
        r = self._one("SELECT pg_try_advisory_lock(%s) AS ok", (INGEST_LOCK_KEY,))
        return bool(r and r["ok"])

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
