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
    CalendarItem,
    Campaign,
    Company,
    CompanyAlias,
    DiscoveryRun,
    DiscoverySearch,
    EmailMessage,
    Event,
    Interview,
    InterviewNote,
    JobPosting,
    PostingQuery,
    PostingStatus,
    ProcessStep,
    WatchedCompany,
)


class Clock(Protocol):
    def now(self) -> datetime: ...


@dataclass(slots=True)
class LLMUsage:
    calls: int = 0
    input_tokens: int = 0  # billed at the full rate (includes cache writes)
    output_tokens: int = 0
    cached_tokens: int = 0  # read from the prompt cache: ~10% of the price, no rate-limit cost

    def add(self, other: LLMUsage) -> None:
        self.calls += other.calls
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cached_tokens += other.cached_tokens


class LLMClient(Protocol):
    model: str
    usage: LLMUsage

    def complete_json(self, *, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        """Return a dict that conforms to `schema`. Raise LLMError on refusal or failure."""
        ...


class LLMError(Exception):
    """Transient failure (network, rate limit, overload): retry on the next run."""


class LLMRateLimited(LLMError):
    """Still rate limited (429) after waiting it out: the account's per-minute limit is too low
    for this pace."""


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

    def fetch_by_message_ids(self, message_ids: list[str]) -> Iterator[EmailMessage]:
        """Specific messages by Message-ID (missing ones are skipped), no X-GM-RAW filter."""
        ...


@dataclass(slots=True)
class CalendarChanges:
    items: list[CalendarItem]
    next_sync_token: str


class CalendarSyncExpired(Exception):
    """The saved sync token is no longer valid (HTTP 410): do a full sync again."""


class CalendarAuthError(Exception):
    """Google rejected the saved login (expired or revoked): run `jobtracker calendar login`."""


class CalendarSource(Protocol):
    calendar_id: str

    def fetch_changes(self, sync_token: str | None, since: datetime) -> CalendarChanges:
        """Everything changed since `sync_token`, or every event from `since` when it's None.
        Recurring events come expanded into single instances; deletions come as cancelled."""
        ...


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

    # interviews
    def list_interviews(self, application_id: uuid.UUID | None = None) -> list[Interview]: ...
    def list_unassigned_interviews(self) -> list[Interview]: ...
    def get_interview(self, interview_id: uuid.UUID) -> Interview | None: ...
    def get_interview_by_calendar_event(
        self, calendar_id: str, calendar_event_id: str
    ) -> Interview | None: ...
    def save_interview(self, interview: Interview) -> None:
        """Insert or update."""
        ...

    def delete_interview(self, interview_id: uuid.UUID) -> None: ...

    # process steps
    def list_steps(self, application_id: uuid.UUID) -> list[ProcessStep]:
        """In position order."""
        ...

    def get_step(self, step_id: uuid.UUID) -> ProcessStep | None: ...
    def save_step(self, step: ProcessStep) -> None: ...
    def delete_step(self, step_id: uuid.UUID) -> None: ...

    # calendar sync
    def get_calendar_sync(self, calendar_id: str) -> str | None:
        """The saved sync token."""
        ...

    def set_calendar_sync(self, calendar_id: str, sync_token: str | None) -> None: ...
    def last_calendar_sync_at(self) -> datetime | None: ...


# Job discovery (plan §20)


@dataclass
class FetchResult:
    postings: list[JobPosting]
    requests: int = 0  # paid API requests this fetch used (JSearch: one per page)


class SourceError(Exception):
    """A job source failed (HTTP error, bad payload). The run notes it and goes on. `requests`
    is what the failed call still cost (JSearch bills some errors)."""

    def __init__(self, message: str, requests: int = 0, gone: bool = False):
        super().__init__(message)
        self.requests = requests
        self.gone = gone  # the board or feed doesn't exist any more


class JobSource(Protocol):
    def fetch(self, params: dict) -> FetchResult: ...


class BoardSource(Protocol):
    def fetch_board(self, ats: str, slug: str, company: str) -> list[JobPosting]:
        """Every job on a company's public ATS board. Raises SourceError; `gone` is set on it
        when the board no longer exists."""
        ...


class DiscoveryRepo(Repository, Protocol):
    def posting_exists(self, source: str, source_id: str) -> bool: ...
    def add_posting(self, posting: JobPosting) -> None: ...
    def update_posting(self, posting: JobPosting) -> None: ...
    def get_posting(self, posting_id: uuid.UUID) -> JobPosting | None: ...
    def list_postings(self, since: datetime | None = None) -> list[JobPosting]:
        """Newest first. `since` filters on fetched_at."""
        ...

    def recent_posting_keys(self, since: datetime) -> list[tuple[str, str]]:
        """(company_normalized, title) of postings fetched since then, for the duplicate check."""
        ...

    def unscored_postings(
        self, *, include_hidden: bool = False, any_status: bool = False
    ) -> list[JobPosting]:
        """Not scored yet, oldest first (the caller orders and limits them). By default only
        visible ones with status new; `include_hidden` adds the rule-hidden ones except duplicates,
        `any_status` every status."""
        ...

    def count_unscored(self) -> int:
        """How many visible new postings wait for a score."""
        ...

    def search_postings(self, query: PostingQuery) -> tuple[list[JobPosting], int]:
        """One page of postings matching the query (discovery.matches), in its order
        (discovery.sort_postings), and how many match in all."""
        ...

    def facet_postings(self) -> list[JobPosting]:
        """Every posting, without its description: enough for discovery.facets."""
        ...

    def reset_scores(self, statuses: tuple[PostingStatus, ...], since: datetime) -> int: ...
    def list_searches(self) -> list[DiscoverySearch]: ...
    def get_search(self, search_id: uuid.UUID) -> DiscoverySearch | None: ...
    def save_search(self, search: DiscoverySearch) -> None: ...
    def delete_search(self, search_id: uuid.UUID) -> None: ...
    def get_discovery_setting(self, key: str) -> object | None: ...
    def set_discovery_setting(self, key: str, value: object) -> None: ...
    def save_run(self, run: DiscoveryRun) -> None: ...
    def last_run(self) -> DiscoveryRun | None: ...
    def jsearch_requests_since(self, since: datetime) -> int: ...
    def list_watched(self) -> list[WatchedCompany]: ...
    def save_watched(self, company: WatchedCompany) -> None: ...
    def hide_company_postings(self, company_normalized: str, reason: str) -> int:
        """Set the drop reason on that company's visible postings; returns how many."""
        ...
