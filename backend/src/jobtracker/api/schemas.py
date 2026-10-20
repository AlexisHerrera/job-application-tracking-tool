"""Request bodies and JSON serialization for the API."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from jobtracker.core.models import (
    Application,
    Event,
    Interview,
    InterviewNote,
    ProcessStep,
    Stage,
    StepKind,
    StepLink,
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
