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
    INVITE = "invite"  # calendar event at the time an assigned invite email names
    NONE = "none"


class AliasKind(StrEnum):
    DOMAIN = "domain"
    ADDRESS = "address"
    DISPLAY_NAME = "display_name"


class InterviewSource(StrEnum):
    CALENDAR = "calendar"
    EMAIL = "email"  # an invite email's interview_at, until the calendar event shows up
    MANUAL = "manual"


class InterviewStatus(StrEnum):
    SCHEDULED = "scheduled"  # past or upcoming is derived from starts_at, never stored
    CANCELLED = "cancelled"


class StepKind(StrEnum):
    INTERVIEW = "interview"  # takes a calendar/email interview, in order
    TAKE_HOME = "take_home"  # no calendar event: marked done by hand
    OTHER = "other"


class StepLink(StrEnum):
    AUTO = "auto"  # matched to the next interview in time order
    MANUAL = "manual"  # interview_id set by hand; None means "not happened yet"


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
    uid: str | None = None  # stays the same when the organizer moves the event


@dataclass(slots=True)
class CalendarItem:
    """One event from Google Calendar before matching. Descriptions live only in memory."""

    calendar_event_id: str
    status: str  # confirmed | tentative | cancelled
    title: str = ""
    start: datetime | None = None  # None: all-day event, or a deleted one with no details
    end: datetime | None = None
    ical_uid: str | None = None
    description: str = ""
    location: str | None = None
    meeting_url: str | None = None
    organizer: str | None = None
    attendees: list[str] = field(default_factory=list)
    html_link: str | None = None
    declined: bool = False  # I declined it


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
    ical_uid: str | None = None  # the invite's UID, when the email carried an .ics
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
class Interview:
    """One interview, from the calendar, an invite email, or added by hand. Notes hang off it."""

    starts_at: datetime
    source: InterviewSource
    id: uuid.UUID = field(default_factory=new_id)
    application_id: uuid.UUID | None = None  # None: in the review queue
    company_hint_id: uuid.UUID | None = None
    status: InterviewStatus = InterviewStatus.SCHEDULED
    ends_at: datetime | None = None
    title: str | None = None
    round: int | None = None
    interview_type: str | None = None
    location: str | None = None
    meeting_url: str | None = None
    organizer: str | None = None
    attendees: list[str] = field(default_factory=list)
    calendar_id: str | None = None
    calendar_event_id: str | None = None
    ical_uid: str | None = None
    html_link: str | None = None
    event_id: uuid.UUID | None = None  # the invite email it came from
    match_method: MatchMethod = MatchMethod.NONE
    assigned_by: str | None = None  # auto | manual
    dismissed: bool = False
    # A talk with a recruiter or agency about roles in general: no application, notes inline.
    general: bool = False
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class InterviewNote:
    application_id: uuid.UUID
    id: uuid.UUID = field(default_factory=new_id)
    interview_id: uuid.UUID | None = None  # None: about the process in general
    body: str | None = None
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


@dataclass(slots=True)
class ProcessStep:
    """One expected step of a hiring process, as the recruiter described it."""

    application_id: uuid.UUID
    name: str
    position: int
    id: uuid.UUID = field(default_factory=new_id)
    kind: StepKind = StepKind.INTERVIEW
    optional: bool = False  # "4-5 rounds": the fifth may not happen
    link: StepLink = StepLink.AUTO
    interview_id: uuid.UUID | None = None
    done_at: datetime | None = None  # marked done by hand
    created_at: datetime | None = None
    updated_at: datetime | None = None


# Job discovery (plan §20)


class PostingStatus(StrEnum):
    NEW = "new"
    INTERESTED = "interested"
    DISMISSED = "dismissed"
    APPLIED = "applied"


@dataclass(slots=True)
class JobPosting:
    """An open position collected from a job source. Everything in it comes from the web, so it's
    untrusted text: shown as text, given to the LLM as data, never followed or executed."""

    source: str  # a search source ("remoteyeah", "getonbrd", "workable", "jsearch") or an ATS
    source_id: str
    url: str
    title: str
    company: str
    description: str = ""
    location: str | None = None
    employment_type: str | None = None
    salary_text: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_period: str | None = None  # "YEAR" | "MONTH" | "HOUR" …, as the source says
    publisher: str | None = None
    posted_at: datetime | None = None
    id: uuid.UUID = field(default_factory=new_id)
    search_id: uuid.UUID | None = None
    company_normalized: str = ""
    fetched_at: datetime | None = None
    drop_reason: str | None = None  # set by the rules (or "consultancy" by the LLM): hidden
    ai_verdict: str | None = None  # "match" | "maybe" | "no"; None = not scored yet
    ai_score: int | None = None
    ai_result: dict | None = None
    ai_model: str | None = None
    prompt_version: str | None = None
    status: PostingStatus = PostingStatus.NEW
    application_id: uuid.UUID | None = None
    updated_at: datetime | None = None
    # Why it was dismissed by hand (discovery.DISCARD_REASONS), and a note (migration 0014).
    discard_reason: str | None = None
    discard_note: str | None = None
    # Search fields (migration 0012): copied from ai_result by discovery.sync_search_fields.
    seniority: str | None = None
    years_required: int | None = None
    location_fit: str | None = None
    work_mode: str | None = None
    employer_kind: str | None = None
    company_size: str | None = None
    sector: str | None = None
    technologies: list[str] = field(default_factory=list)
    ai_related: bool | None = None
    salary_usd_min: int | None = None  # yearly, from the source's salary or the LLM's reading
    salary_usd_max: int | None = None


@dataclass
class PostingQuery:
    """The Discover page's filters (discovery.matches says what each one means)."""

    hidden: bool = False  # False: only what the rules let through; True: only the hidden ones
    verdicts: tuple[str, ...] = ()  # "match" | "maybe" | "no" | "unscored"; empty = any
    statuses: tuple[str, ...] = ()
    source: str | None = None
    publisher: str | None = None  # the board: "LinkedIn", "Indeed Argentina", "remoteyeah"…
    text: str | None = None  # in the title or the company
    location: str | None = None  # in the location as the source wrote it
    location_fit: tuple[str, ...] = ()
    work_mode: tuple[str, ...] = ()
    seniority: tuple[str, ...] = ()
    company_size: tuple[str, ...] = ()
    sector: tuple[str, ...] = ()
    employer_kind: tuple[str, ...] = ()
    technologies: tuple[str, ...] = ()  # all of them, any case
    ai_only: bool = False
    salary_min_usd: int | None = None  # the range's top reaches it; postings without one fail
    posted_since: datetime | None = None  # posted_at, or fetched_at when the date is unknown
    sort: str = "score"
    limit: int = 50
    offset: int = 0


@dataclass(slots=True)
class DiscoverySearch:
    source: str
    label: str
    params: dict
    id: uuid.UUID = field(default_factory=new_id)
    enabled: bool = True
    created_at: datetime | None = None


@dataclass(slots=True)
class WatchedCompany:
    """A company whose public ATS job board a discovery run reads (plan §21)."""

    ats: str  # "ashby" | "greenhouse" | "lever"
    slug: str  # the board's name in the ATS URL
    name: str
    id: uuid.UUID = field(default_factory=new_id)
    enabled: bool = True
    note: str | None = None  # how it got on the list
    created_at: datetime | None = None
    last_checked_at: datetime | None = None
    last_status: str | None = None  # "ok" | "gone" | the error
    jobs_total: int | None = None  # on the board at the last check
    jobs_kept: int | None = None  # of those, engineering roles in an allowed location


@dataclass(slots=True)
class DiscoveryRun:
    started_at: datetime
    trigger: str
    id: uuid.UUID = field(default_factory=new_id)
    finished_at: datetime | None = None
    jsearch_requests: int = 0
    fetched: int = 0
    new: int = 0
    dropped: int = 0
    llm_calls: int = 0
    errors: int = 0
    notes: list[str] = field(default_factory=list)
