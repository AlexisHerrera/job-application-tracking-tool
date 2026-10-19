"""In-memory test doubles for the core ports."""

from __future__ import annotations

import copy
import uuid
from contextlib import contextmanager
from datetime import datetime

from jobtracker.core.models import (
    AliasKind,
    Application,
    Company,
    CompanyAlias,
    Event,
    InterviewNote,
)
from jobtracker.core.ports import LLMError, LLMUsage, SyncState, ThreadMatch

ATS = {
    "ashbyhq.com": "ashby",
    "lever.co": "lever",
    "hire.lever.co": "lever",
    "greenhouse.io": "greenhouse",
    "us.greenhouse-mail.io": "greenhouse",
    "workablemail.com": "workable",
    "calendly.com": "calendly",
}


class MemoryRepo:
    def __init__(self, ats: dict[str, str] | None = None):
        self.ats = dict(ATS if ats is None else ats)
        self.processed: dict[str, tuple] = {}
        self.sync: dict[str, SyncState] = {}
        self.companies: dict[uuid.UUID, Company] = {}
        self.aliases: list[CompanyAlias] = []
        self.apps: dict[uuid.UUID, Application] = {}
        self.events: dict[uuid.UUID, Event] = {}
        self.notes: dict[uuid.UUID, InterviewNote] = {}

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

    def record_processed(self, message_id, uid, verdict, stage, reason):
        self.processed.setdefault(message_id, (uid, verdict, stage, reason))

    def get_sync_state(self, mailbox):
        s = self.sync.get(mailbox)
        return copy.copy(s) if s else None

    def set_sync_state(self, state):
        self.sync[state.mailbox] = copy.copy(state)

    def ats_domains(self):
        return self.ats

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


class FakeLLM:
    """Scripted responses keyed by a substring of the user prompt (the rendered email)."""

    model = "fake-model"

    def __init__(self, gate: dict[str, bool] | None = None, extract: dict[str, dict] | None = None):
        self.gate = gate or {}
        self.extract = extract or {}
        self.calls: list[str] = []
        self.usage = LLMUsage()
        self.fail_with: Exception | None = None
        self.paste_response: dict = {"applications": []}

    def complete_json(self, *, system, user, schema, max_tokens):
        if self.fail_with:
            raise self.fail_with
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

    base = {k: None for k in RECORD_PROPERTIES}
    base.update({"stack": [], "evidence": "scripted"})
    return {**base, **overrides}
