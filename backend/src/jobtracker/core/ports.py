"""Interfaces the core depends on. Adapters (Postgres, IMAP, Anthropic) implement them."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from jobtracker.core.models import (
    AliasKind,
    Application,
    Campaign,
    Company,
    CompanyAlias,
    EmailMessage,
    Event,
    InterviewNote,
)


class Clock(Protocol):
    def now(self) -> datetime: ...


@dataclass(slots=True)
class LLMUsage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    def add(self, other: LLMUsage) -> None:
        self.calls += other.calls
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens


class LLMClient(Protocol):
    model: str
    usage: LLMUsage

    def complete_json(self, *, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        """Return a dict that conforms to `schema`. Raise LLMError on refusal or failure."""
        ...


class LLMError(Exception):
    """Transient failure (network, rate limit, overload): retry on the next run."""


class LLMRefusal(LLMError):
    """The model declined or returned unusable output for this email: don't retry forever."""


@dataclass(slots=True)
class ThreadMatch:
    known: bool
    application_id: uuid.UUID | None = None


@dataclass(slots=True)
class SyncState:
    mailbox: str
    uidvalidity: int
    last_uid: int


class MailSource(Protocol):
    mailbox: str

    def uidvalidity(self) -> int: ...

    def last_uid(self) -> int:
        """Highest UID currently in the mailbox."""
        ...

    def fetch_new(self, after_uid: int) -> Iterator[EmailMessage]:
        """Messages with UID > after_uid, oldest first, pre-filtered with X-GM-RAW."""
        ...

    def fetch_range(self, since: date, until: date | None) -> Iterator[EmailMessage]: ...


class Repository(Protocol):
    def transaction(self) -> AbstractContextManager[None]: ...

    # ingestion bookkeeping
    def is_processed(self, message_id: str) -> bool: ...
    def processed_verdict(self, message_id: str) -> str | None: ...
    def record_processed(
        self, message_id: str, uid: int | None, verdict: str, stage: str, reason: str
    ) -> None:
        """Insert, or overwrite the verdict of an earlier run."""
        ...

    def get_sync_state(self, mailbox: str) -> SyncState | None: ...
    def set_sync_state(self, state: SyncState) -> None: ...
    def max_processed_uid(self) -> int | None:
        """Highest IMAP UID any run (backfill included) has processed."""
        ...

    def last_sync_at(self) -> datetime | None:
        """When an incremental run last looked at the mailbox."""
        ...

    # companies
    def ats_domains(self) -> dict[str, str]:
        """ATS, scheduler and assessment senders: allowlisted, shared across companies."""
        ...

    def agency_domains(self) -> dict[str, str]:
        """Recruiting agencies: shared senders, matched only by the extracted company."""
        ...

    def company_domains(self) -> set[str]: ...
    def get_company(self, company_id: uuid.UUID) -> Company | None: ...
    def find_company_by_alias(self, kind: AliasKind, value: str) -> Company | None: ...
    def find_company_by_name(self, normalized_name: str) -> Company | None: ...
    def list_companies(self) -> list[Company]: ...
    def list_aliases(self, company_id: uuid.UUID) -> list[CompanyAlias]: ...
    def add_company(self, company: Company) -> None: ...
    def add_alias(self, alias: CompanyAlias) -> bool:
        """Insert unless (kind, value) exists. Return True if inserted."""
        ...

    # applications
    def list_applications(self) -> list[Application]: ...
    def get_application(self, app_id: uuid.UUID) -> Application | None: ...
    def add_application(self, app: Application) -> None: ...
    def update_application(self, app: Application) -> None: ...
    def delete_application(self, app_id: uuid.UUID) -> None: ...

    # events
    def add_event(self, event: Event) -> None: ...
    def get_event(self, event_id: uuid.UUID) -> Event | None: ...
    def get_event_by_message_id(self, message_id: str) -> Event | None: ...
    def list_events(self, application_id: uuid.UUID) -> list[Event]: ...
    def list_all_events(self) -> list[Event]: ...
    def list_unassigned(self) -> list[Event]: ...
    def update_event(self, event: Event) -> None: ...
    def thread_lookup(self, gm_thread_id: str | None, message_ids: list[str]) -> ThreadMatch:
        """Find earlier job events in the same Gmail thread or referenced by Message-ID."""
        ...

    def mark_thread_replied(self, gm_thread_id: str, at: datetime) -> int: ...

    # campaigns
    def list_campaigns(self) -> list[Campaign]: ...
    def get_campaign(self, campaign_id: uuid.UUID) -> Campaign | None: ...
    def save_campaign(self, campaign: Campaign) -> None: ...
    def delete_campaign(self, campaign_id: uuid.UUID) -> None: ...

    # interview notes
    def list_notes(self, application_id: uuid.UUID | None = None) -> list[InterviewNote]: ...
    def get_note(self, note_id: uuid.UUID) -> InterviewNote | None: ...
    def save_note(self, note: InterviewNote) -> None: ...
    def delete_note(self, note_id: uuid.UUID) -> None: ...
