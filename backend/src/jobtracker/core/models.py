"""Domain types. Plain dataclasses, no I/O."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import StrEnum


def new_id() -> uuid.UUID:
    return uuid.uuid4()


class Stage(StrEnum):
    APPLIED = "applied"
    SCREENING = "screening"
    INTERVIEWING = "interviewing"
    OFFER = "offer"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    ON_HOLD = "on_hold"  # paused by the company/recruiter; set by hand, pauses the ghosted timer


# Never stored: derived at read time from inactivity (see stages.display_status).
GHOSTED = "ghosted"


class EventType(StrEnum):
    APPLICATION_RECEIVED = "application_received"
    RECRUITER_OUTREACH = "recruiter_outreach"
    SCREENING_INVITE = "screening_invite"
    INTERVIEW_INVITE = "interview_invite"
    INTERVIEW_SCHEDULED = "interview_scheduled"
    INTERVIEW_RESCHEDULED = "interview_rescheduled"
    ASSESSMENT = "assessment"
    OFFER = "offer"
    REJECTION = "rejection"
    INFO_REQUEST = "info_request"
    WITHDRAWAL = "withdrawal"
    MANUAL_STAGE_CHANGE = "manual_stage_change"
    OTHER = "other"


class EventKind(StrEnum):
    EMAIL = "email"
    MANUAL = "manual"


class MatchMethod(StrEnum):
    THREAD = "thread"
    ALIAS = "alias"
    FUZZY = "fuzzy"
    MANUAL = "manual"
    CREATED = "created"
    NONE = "none"


class AliasKind(StrEnum):
    DOMAIN = "domain"
    ADDRESS = "address"
    DISPLAY_NAME = "display_name"


class Origin(StrEnum):
    MANUAL = "manual"
    EMAIL = "email"
    IMPORT = "import"


@dataclass(slots=True)
class EmailMessage:
    """A parsed email. Bodies live only in memory while the pipeline runs."""

    message_id: str
    from_address: str
    from_name: str
    subject: str
    received_at: datetime
    text: str
    uid: int | None = None
    gm_thread_id: str | None = None
    to_addresses: list[str] = field(default_factory=list)
    in_reply_to: str | None = None
    references: list[str] = field(default_factory=list)
    list_unsubscribe: bool = False
    list_id: str | None = None
    auto_submitted: bool = False
    calendar_parts: list[bytes] = field(default_factory=list)
    attachment_names: list[str] = field(default_factory=list)

    @property
    def from_domain(self) -> str:
        return self.from_address.rsplit("@", 1)[-1].lower() if "@" in self.from_address else ""


@dataclass(slots=True)
class CalendarEvent:
    start: datetime
    end: datetime | None
    summary: str
    organizer: str | None
    method: str | None  # REQUEST / CANCEL / PUBLISH
    location: str | None = None


@dataclass(slots=True)
class Extraction:
    is_job_related: bool
    company: str | None
    role: str | None
    event_type: EventType
    stage_implied: Stage | None
    round: int | None
    interview_at: datetime | None
    needs_reply: bool
    summary: str
    confidence: float


@dataclass(slots=True)
class Company:
    name: str
    normalized_name: str
    id: uuid.UUID = field(default_factory=new_id)
    website: str | None = None
    created_at: datetime | None = None


@dataclass(slots=True)
class CompanyAlias:
    company_id: uuid.UUID
    kind: AliasKind
    value: str
    learned_from: str
    id: uuid.UUID = field(default_factory=new_id)


@dataclass(slots=True)
class Application:
    company_id: uuid.UUID
    role_title: str
    id: uuid.UUID = field(default_factory=new_id)
    company_name: str = ""
    job_url: str | None = None
    job_description: str | None = None
    source_ats: str | None = None
    source_channel: str | None = None
    seniority: str | None = None
    stack: list[str] = field(default_factory=list)
    location: str | None = None
    salary_min: int | None = None  # yearly
    salary_max: int | None = None  # yearly
    salary_currency: str | None = None
    benefits: str | None = None
    applied_at: datetime | None = None
    current_stage: Stage = Stage.APPLIED
    current_round: int | None = None
    max_stage_reached: Stage = Stage.APPLIED
    outcome: Stage | None = None
    last_event_at: datetime | None = None
    next_interview_at: datetime | None = None
    origin: Origin = Origin.MANUAL
    needs_review: bool = False
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class Event:
    kind: EventKind
    event_type: EventType
    occurred_at: datetime
    id: uuid.UUID = field(default_factory=new_id)
    application_id: uuid.UUID | None = None
    company_hint_id: uuid.UUID | None = None
    message_id: str | None = None
    gm_thread_id: str | None = None
    in_reply_to: str | None = None
    references: list[str] = field(default_factory=list)
    from_address: str | None = None
    from_name: str | None = None
    subject: str | None = None
    snippet: str | None = None
    stage_implied: Stage | None = None
    round: int | None = None
    interview_at: datetime | None = None
    needs_reply: bool = False
    replied_at: datetime | None = None
    summary: str | None = None
    confidence: float | None = None
    extraction: dict | None = None
    model: str | None = None
    filter_path: str | None = None
    match_method: MatchMethod = MatchMethod.NONE
    assigned_by: str | None = None  # auto | manual
    dismissed: bool = False
    created_at: datetime | None = None


@dataclass(slots=True)
class Campaign:
    """A job-search period. Applications belong to it by their applied date (computed, not stored)."""

    name: str
    started_on: date
    id: uuid.UUID = field(default_factory=new_id)
    ended_on: date | None = None
    notes: str | None = None
    created_at: datetime | None = None


@dataclass(slots=True)
class InterviewNote:
    application_id: uuid.UUID
    id: uuid.UUID = field(default_factory=new_id)
    round: int | None = None
    interview_at: datetime | None = None
    interview_type: str | None = None
    interviewers: str | None = None
    questions: list[str] = field(default_factory=list)
    self_rating: int | None = None
    went_well: str | None = None
    went_wrong: str | None = None
    topics_to_study: list[str] = field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
