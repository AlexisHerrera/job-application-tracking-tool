"""Request bodies and JSON serialization for the API."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from jobtracker.core.discovery import Progress
from jobtracker.core.models import (
    Application,
    DiscoveryRun,
    DiscoverySearch,
    Event,
    Interview,
    InterviewNote,
    JobPosting,
    PostingStatus,
    ProcessStep,
    Stage,
    StepKind,
    StepLink,
    WatchedCompany,
)
from jobtracker.core.process import Node
from jobtracker.core.services import ApplicationInput


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def application_json(a: Application, status: str) -> dict:
    return {
        "id": str(a.id),
        "company_id": str(a.company_id),
        "company": a.company_name,
        "role_title": a.role_title,
        "job_url": a.job_url,
        "job_description": a.job_description,
        "source_ats": a.source_ats,
        "source_channel": a.source_channel,
        "seniority": a.seniority,
        "stack": a.stack,
        "location": a.location,
        "salary_min": a.salary_min,
        "salary_max": a.salary_max,
        "salary_currency": a.salary_currency,
        "benefits": a.benefits,
        "applied_at": _iso(a.applied_at),
        "current_stage": a.current_stage.value,
        "status": status,
        "current_round": a.current_round,
        "max_stage_reached": a.max_stage_reached.value,
        "outcome": a.outcome.value if a.outcome else None,
        "last_event_at": _iso(a.last_event_at),
        "next_interview_at": _iso(a.next_interview_at),
        "origin": a.origin.value,
        "needs_review": a.needs_review,
        "notes": a.notes,
        "created_at": _iso(a.created_at),
        "updated_at": _iso(a.updated_at),
    }


def event_json(e: Event) -> dict:
    extraction = e.extraction or {}
    return {
        "id": str(e.id),
        "application_id": str(e.application_id) if e.application_id else None,
        "company_hint_id": str(e.company_hint_id) if e.company_hint_id else None,
        "kind": e.kind.value,
        "event_type": e.event_type.value,
        "occurred_at": _iso(e.occurred_at),
        "from_address": e.from_address,
        "from_name": e.from_name,
        "subject": e.subject,
        "snippet": e.snippet,
        "stage_implied": e.stage_implied.value if e.stage_implied else None,
        "round": e.round,
        "interview_at": _iso(e.interview_at),
        "needs_reply": e.needs_reply,
        "replied_at": _iso(e.replied_at),
        "summary": e.summary,
        "confidence": e.confidence,
        "extracted_company": extraction.get("company"),
        "extracted_role": extraction.get("role"),
        "match_method": e.match_method.value,
        "assigned_by": e.assigned_by,
        "dismissed": e.dismissed,
    }


def interview_json(iv: Interview, notes: int = 0, company: str | None = None) -> dict:
    return {
        "id": str(iv.id),
        "application_id": str(iv.application_id) if iv.application_id else None,
        "company": company,
        "source": iv.source.value,
        "status": iv.status.value,
        "starts_at": _iso(iv.starts_at),
        "ends_at": _iso(iv.ends_at),
        "title": iv.title,
        "round": iv.round,
        "interview_type": iv.interview_type,
        "location": iv.location,
        "meeting_url": iv.meeting_url,
        "organizer": iv.organizer,
        "attendees": iv.attendees,
        "html_link": iv.html_link,
        "match_method": iv.match_method.value,
        "general": iv.general,
        "notes": iv.notes,
        "notes_count": notes,
    }


def note_json(n: InterviewNote) -> dict:
    return {
        "id": str(n.id),
        "application_id": str(n.application_id),
        "interview_id": str(n.interview_id) if n.interview_id else None,
        "body": n.body,
        "round": n.round,
        "interview_at": _iso(n.interview_at),
        "interview_type": n.interview_type,
        "interviewers": n.interviewers,
        "questions": n.questions,
        "self_rating": n.self_rating,
        "went_well": n.went_well,
        "went_wrong": n.went_wrong,
        "topics_to_study": n.topics_to_study,
        "created_at": _iso(n.created_at),
        "updated_at": _iso(n.updated_at),
    }


def step_json(st: ProcessStep) -> dict:
    return {
        "id": str(st.id),
        "position": st.position,
        "name": st.name,
        "kind": st.kind.value,
        "optional": st.optional,
        "link": st.link.value,
        "interview_id": str(st.interview_id) if st.interview_id else None,
        "done_at": _iso(st.done_at),
    }


def node_json(n: Node) -> dict:
    return {
        "kind": n.kind,
        "label": n.label,
        "state": n.state,
        "at": _iso(n.at),
        "step_id": str(n.step_id) if n.step_id else None,
        "interview_id": str(n.interview_id) if n.interview_id else None,
        "step_kind": n.step_kind.value if n.step_kind else None,
        "optional": n.optional,
        "implied": n.implied,
        "outcome": n.outcome,
    }


class StepIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: StepKind | None = None  # guessed from the name when missing
    optional: bool = False


class ApplicationIn(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    role_title: str = Field(min_length=1, max_length=300)
    job_url: str | None = None
    company_domain: str | None = None
    job_description: str | None = Field(default=None, max_length=50_000)
    source_ats: str | None = None
    source_channel: str | None = None
    seniority: str | None = None
    stack: list[str] = []
    location: str | None = None
    salary_min: int | None = Field(default=None, ge=0, le=100_000_000)
    salary_max: int | None = Field(default=None, ge=0, le=100_000_000)
    salary_currency: str | None = Field(default=None, max_length=8)
    benefits: str | None = Field(default=None, max_length=5000)
    applied_at: datetime | None = None
    stage: Stage | None = None
    stage_at: datetime | None = None
    notes: str | None = None
    process_steps: list[StepIn] = Field(default=[], max_length=30)

    def to_input(self) -> ApplicationInput:
        return ApplicationInput(
            company=self.company,
            role_title=self.role_title,
            job_url=self.job_url or None,
            company_domain=self.company_domain or None,
            job_description=self.job_description or None,
            source_ats=self.source_ats or None,
            source_channel=self.source_channel or None,
            seniority=self.seniority or None,
            stack=self.stack,
            location=self.location or None,
            salary_min=self.salary_min,
            salary_max=self.salary_max,
            salary_currency=self.salary_currency or None,
            benefits=self.benefits or None,
            applied_at=self.applied_at,
            stage=self.stage,
            stage_at=self.stage_at,
            notes=self.notes or None,
            process_steps=[st.model_dump() for st in self.process_steps],
        )


class ApplicationPatch(BaseModel):
    role_title: str | None = Field(default=None, min_length=1, max_length=300)
    job_url: str | None = None
    job_description: str | None = Field(default=None, max_length=50_000)
    source_ats: str | None = None
    source_channel: str | None = None
    seniority: str | None = None
    stack: list[str] | None = None
    location: str | None = None
    salary_min: int | None = Field(default=None, ge=0, le=100_000_000)
    salary_max: int | None = Field(default=None, ge=0, le=100_000_000)
    salary_currency: str | None = Field(default=None, max_length=8)
    benefits: str | None = Field(default=None, max_length=5000)
    applied_at: datetime | None = None
    notes: str | None = None
    needs_review: bool | None = None
    company_domain: str | None = Field(default=None, max_length=200)  # adds an alias, never removes
    process_steps: list[StepIn] | None = Field(default=None, max_length=30)  # fills an empty plan


class PasteIn(BaseModel):
    text: str = Field(min_length=1)
    application_id: str | None = None  # scope the proposal to one application


def _val(v):
    return v.isoformat() if isinstance(v, datetime) else v


def option_json(o) -> dict:
    sc = o.stage_change
    return {
        "application_id": str(o.application_id) if o.application_id else None,
        "label": o.label,
        "score": o.score,
        "changes": [
            {
                "field": c.field,
                "label": c.label,
                "current": _val(c.current),
                "proposed": _val(c.proposed),
                "kind": c.kind,
            }
            for c in o.changes
        ],
        "stage_change": {
            "current": sc.current.value if sc.current else None,
            "proposed": sc.proposed.value,
            "at": _iso(sc.at),
            "kind": sc.kind,
        }
        if sc
        else None,
    }


class CampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    started_on: date
    ended_on: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    close_previous: bool = True  # an ongoing earlier campaign ends the day before this one starts


class CampaignPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    started_on: date | None = None
    ended_on: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class StageChangeIn(BaseModel):
    stage: Stage
    at: datetime | None = None
    round: int | None = Field(default=None, ge=1, le=20)
    note: str | None = Field(default=None, max_length=500)


class AssignIn(BaseModel):
    application_id: str


class CsvImportIn(BaseModel):
    csv: str = Field(min_length=1, max_length=2_000_000)


class InterviewIn(BaseModel):
    starts_at: datetime
    ends_at: datetime | None = None
    title: str | None = Field(default=None, max_length=300)
    round: int | None = Field(default=None, ge=1, le=20)
    interview_type: str | None = None
    location: str | None = Field(default=None, max_length=500)


class InterviewPatch(BaseModel):
    notes: str | None = Field(default=None, max_length=20_000)  # general talks only
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    title: str | None = Field(default=None, max_length=300)
    round: int | None = Field(default=None, ge=1, le=20)
    interview_type: str | None = None
    location: str | None = Field(default=None, max_length=500)


class NoteIn(BaseModel):
    interview_id: uuid.UUID | None = None
    body: str | None = Field(default=None, max_length=20_000)
    round: int | None = Field(default=None, ge=1, le=20)
    interview_at: datetime | None = None
    interview_type: str | None = None
    interviewers: str | None = None
    questions: list[str] = []
    self_rating: int | None = Field(default=None, ge=1, le=5)
    went_well: str | None = None
    went_wrong: str | None = None
    topics_to_study: list[str] = []


class StepsIn(BaseModel):
    steps: list[StepIn] = Field(min_length=1, max_length=30)


class StepPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: StepKind | None = None
    optional: bool | None = None
    link: StepLink | None = None
    interview_id: uuid.UUID | None = None
    done_at: datetime | None = None
    position: int | None = Field(default=None, ge=0, le=50)


# Job discovery (plan §20)


def posting_json(p: JobPosting, *, in_tracker: bool, search_label: str | None) -> dict:
    ai = p.ai_result or {}
    return {
        "id": str(p.id),
        "source": p.source,
        "search_label": search_label,
        "url": p.url,
        "title": p.title,
        "company": p.company,
        "location": p.location,
        "employment_type": p.employment_type,
        "salary_text": p.salary_text,
        "salary_min": p.salary_min,
        "salary_max": p.salary_max,
        "salary_period": p.salary_period,
        "publisher": p.publisher,
        "posted_at": _iso(p.posted_at),
        "fetched_at": _iso(p.fetched_at),
        "description": p.description,
        "drop_reason": p.drop_reason,
        "verdict": p.ai_verdict,
        "score": p.ai_score,
        "reasons": ai.get("reasons") or [],
        # Postings scored before the search fields existed have them only in ai_result.
        "location_fit": p.location_fit or ai.get("location_fit"),
        "seniority": p.seniority or ai.get("seniority"),
        "years_required": p.years_required
        if p.years_required is not None
        else ai.get("years_required"),
        "employer_kind": p.employer_kind or ai.get("employer_kind"),
        "ai_related": bool(p.ai_related if p.ai_related is not None else ai.get("ai_related")),
        "stack_overlap": ai.get("stack_overlap") or [],
        "technologies": p.technologies,
        "work_mode": p.work_mode,
        "company_size": p.company_size,
        "sector": p.sector,
        "salary_usd_min": p.salary_usd_min,
        "salary_usd_max": p.salary_usd_max,
        "status": p.status.value,
        "discard_reason": p.discard_reason,
        "discard_note": p.discard_note,
        "application_id": str(p.application_id) if p.application_id else None,
        "in_tracker": in_tracker,
    }


def search_json(x: DiscoverySearch) -> dict:
    return {
        "id": str(x.id),
        "source": x.source,
        "label": x.label,
        "params": x.params,
        "enabled": x.enabled,
    }


def companies_json(rows: list[WatchedCompany], scan: object = None) -> dict:
    """The watchlist in numbers: the page shows a summary, the CLI lists the companies. `scan`
    is what the last directory scan left in the settings."""
    on = [c for c in rows if c.enabled]
    checked = [c.last_checked_at for c in rows if c.last_checked_at]
    return {
        "total": len(rows),
        "enabled": len(on),
        "by_ats": {
            ats: sum(1 for c in on if c.ats == ats) for ats in ("ashby", "greenhouse", "lever")
        },
        "with_jobs": sum(1 for c in on if c.jobs_kept),
        "jobs_kept": sum(c.jobs_kept or 0 for c in on),
        "last_checked_at": _iso(max(checked)) if checked else None,
        "last_scan_at": scan.get("at") if isinstance(scan, dict) else None,
    }


def watched_json(c: WatchedCompany) -> dict:
    from jobtracker.core.discovery_settings import board_url

    return {
        "id": str(c.id),
        "ats": c.ats,
        "slug": c.slug,
        "name": c.name,
        "enabled": c.enabled,
        "note": c.note,
        "created_at": _iso(c.created_at),
        "last_checked_at": _iso(c.last_checked_at),
        "last_status": c.last_status,
        "jobs_total": c.jobs_total,
        "jobs_kept": c.jobs_kept,
        "board_url": board_url(c.ats, c.slug),
    }


def run_json(r: DiscoveryRun | None) -> dict | None:
    if r is None:
        return None
    return {
        "id": str(r.id),
        "started_at": _iso(r.started_at),
        "finished_at": _iso(r.finished_at),
        "trigger": r.trigger,
        "jsearch_requests": r.jsearch_requests,
        "fetched": r.fetched,
        "new": r.new,
        "dropped": r.dropped,
        "llm_calls": r.llm_calls,
        "errors": r.errors,
        "notes": r.notes,
    }


def progress_json(p: Progress | None, now: datetime) -> dict:
    """`running` is false when nothing has run since the API started, or the last run ended."""
    if p is None:
        return {"running": False}

    def seconds(since: datetime | None) -> float | None:
        end = p.finished_at or now
        return round((end - since).total_seconds(), 1) if since else None

    return {
        "running": p.phase != "done",
        "kind": p.kind,
        "phase": p.phase,
        "elapsed_s": seconds(p.started_at),
        "phase_elapsed_s": seconds(p.phase_started_at),
        "searches_total": p.searches_total,
        "searches_done": p.searches_done,
        "current": p.current,
        "fetched": p.fetched,
        "new": p.new,
        "hidden": p.hidden,
        "to_score": p.to_score,
        "scored": p.scored,
        "errors": p.errors,
    }


DiscardReason = Literal[
    "closed",
    "no_apply",
    "fake",
    "duplicate",
    "too_senior",
    "too_junior",
    "stack",
    "role",
    "language",
    "location",
    "work_mode",
    "salary",
    "contract",
    "company",
    "intermediary",
    "other",
]  # fmt: skip  (discovery.DISCARD_REASONS; test_api checks the two agree)


class PostingPatch(BaseModel):
    status: PostingStatus
    # Only kept with status "dismissed"; any other status clears them.
    discard_reason: DiscardReason | None = None
    discard_note: str | None = Field(None, max_length=500)


class DiscoverySettingsIn(BaseModel):
    criteria: str | None = Field(None, max_length=6000)
    profile: dict | None = None  # wins over `criteria`: the text is rendered from it (round 6)
    rules: dict | None = None


class CriteriaPreviewIn(BaseModel):
    profile: dict


class WatchedIn(BaseModel):
    ats: str = Field(pattern="^(ashby|greenhouse|lever)$")
    slug: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
    name: str | None = Field(None, max_length=200)


class WatchedPatch(BaseModel):
    enabled: bool | None = None
    name: str | None = Field(None, min_length=1, max_length=200)


class SearchIn(BaseModel):
    source: str = Field(pattern="^(jsearch|remoteyeah|getonbrd|workable)$")
    label: str = Field(min_length=1, max_length=120)
    params: dict
    enabled: bool = True


class SearchPatch(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=120)
    params: dict | None = None
    enabled: bool | None = None


class DiscoverRunIn(BaseModel):
    rescore: bool = False
    score: bool = True  # false: collect only, no LLM calls (plan §21)
    collect: bool = True  # false: only score what is waiting, read no source


class BlockCompanyIn(BaseModel):
    company: str = Field(min_length=1, max_length=200)


class DiscoverRescoreIn(BaseModel):
    include_hidden: bool = False
