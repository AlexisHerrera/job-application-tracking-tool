"""Request bodies and JSON serialization for the API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from jobtracker.core.models import Application, Event, InterviewNote, Stage
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


def note_json(n: InterviewNote) -> dict:
    return {
        "id": str(n.id),
        "application_id": str(n.application_id),
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
    applied_at: datetime | None = None
    stage: Stage | None = None
    notes: str | None = None

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
            applied_at=self.applied_at,
            stage=self.stage,
            notes=self.notes or None,
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
    applied_at: datetime | None = None
    notes: str | None = None
    needs_review: bool | None = None


class StageChangeIn(BaseModel):
    stage: Stage
    at: datetime | None = None
    round: int | None = Field(default=None, ge=1, le=20)
    note: str | None = Field(default=None, max_length=500)


class AssignIn(BaseModel):
    application_id: str


class CsvImportIn(BaseModel):
    csv: str = Field(min_length=1, max_length=2_000_000)


class NoteIn(BaseModel):
    round: int | None = Field(default=None, ge=1, le=20)
    interview_at: datetime | None = None
    interview_type: str | None = None
    interviewers: str | None = None
    questions: list[str] = []
    self_rating: int | None = Field(default=None, ge=1, le=5)
    went_well: str | None = None
    went_wrong: str | None = None
    topics_to_study: list[str] = []
