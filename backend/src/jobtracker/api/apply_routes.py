"""/api/apply/…: your experience, the questions forms ask with your answers, and the facts."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable, Iterator
from dataclasses import asdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from jobtracker.adapters.db.repo import PostgresRepo
from jobtracker.core import apply, services
from jobtracker.core.ports import Clock

_LONG = 20_000
_SHORT = 2_000


class QuestionIn(BaseModel):
    text: str = Field(min_length=1, max_length=_SHORT)
    category: str | None = None  # None: the rules pick one
    company: str = Field("", max_length=200)  # so "Why Acme?" matches "Why Initech?"
    url: str = Field("", max_length=1000)


class QuestionPatch(BaseModel):
    text: str | None = Field(None, max_length=_SHORT)
    category: str | None = None
    answer: str | None = Field(None, max_length=_LONG)
    style_notes: str | None = Field(None, max_length=_SHORT)


class ExperienceIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    company: str = Field("", max_length=200)
    period: str = Field("", max_length=100)
    summary: str = Field("", max_length=_SHORT)
    context: str = Field("", max_length=_LONG)
    contribution: str = Field("", max_length=_LONG)
    results: str = Field("", max_length=_LONG)
    stack: str = Field("", max_length=_SHORT)
    links: str = Field("", max_length=_SHORT)
    position: int | None = None


class ExperiencePatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    company: str | None = Field(None, max_length=200)
    period: str | None = Field(None, max_length=100)
    summary: str | None = Field(None, max_length=_SHORT)
    context: str | None = Field(None, max_length=_LONG)
    contribution: str | None = Field(None, max_length=_LONG)
    results: str | None = Field(None, max_length=_LONG)
    stack: str | None = Field(None, max_length=_SHORT)
    links: str | None = Field(None, max_length=_SHORT)
    position: int | None = None


class FactIn(BaseModel):
    label: str = Field(min_length=1, max_length=300)


class FactPatch(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=300)
    value: str | None = Field(None, max_length=_SHORT)
    notes: str | None = Field(None, max_length=_SHORT)


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def question_json(q: apply.FormQuestion) -> dict:
    return {
        "id": str(q.id), "text": q.text, "category": q.category, "answer": q.answer,
        "style_notes": q.style_notes, "answered_at": _iso(q.answered_at),
        "created_at": _iso(q.created_at), "updated_at": _iso(q.updated_at),
        "sources": [
            {"url": s.url, "company": s.company, "role_title": s.role_title, "ats": s.ats,
             "text": s.text, "seen_at": _iso(s.seen_at)}
            for s in q.sources
        ],
    }  # fmt: skip


def experience_json(e: apply.Experience) -> dict:
    d = asdict(e)
    d.update(id=str(e.id), created_at=_iso(e.created_at), updated_at=_iso(e.updated_at))
    return d


def fact_json(f: apply.Fact) -> dict:
    return {"key": f.key, "label": f.label, "value": f.value, "notes": f.notes,
            "position": f.position, "updated_at": _iso(f.updated_at)}  # fmt: skip


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as err:
        raise services.NotFound(value) from err


def apply_router(get_repo: Callable[[], Iterator[PostgresRepo]], clock: Clock) -> APIRouter:
    r = APIRouter(prefix="/apply")

    @r.get("/questions")
    def list_questions(repo: PostgresRepo = Depends(get_repo)):
        return {
            "categories": [{"key": k, "label": lbl, "hint": h} for k, lbl, h in apply.CATEGORIES],
            "questions": [question_json(q) for q in repo.list_questions()],
        }

    @r.post("/questions", status_code=201)
    def add_question(body: QuestionIn, repo: PostgresRepo = Depends(get_repo)):
        source = apply.FormSource(
            url=body.url.strip() or f"paste:{uuid.uuid4()}", company=body.company.strip(),
            ats="paste",
        )  # fmt: skip
        with repo.transaction():
            q, created, _ = apply.record(repo, clock, body.text, source, body.category)
        return {"created": created, "question": question_json(repo.get_question(q.id) or q)}

    @r.patch("/questions/{question_id}")
    def patch_question(question_id: str, body: QuestionPatch, repo: PostgresRepo = Depends(get_repo)):  # fmt: skip
        q = repo.get_question(_uuid(question_id))
        if q is None:
            raise services.NotFound(question_id)
        apply.update_question(repo, clock, q, **body.model_dump(exclude_unset=True))
        return question_json(q)

    @r.delete("/questions/{question_id}", status_code=204)
    def delete_question(question_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            repo.delete_question(_uuid(question_id))

    @r.get("/experiences")
    def list_experiences(repo: PostgresRepo = Depends(get_repo)):
        return [experience_json(e) for e in repo.list_experiences()]

    @r.post("/experiences", status_code=201)
    def add_experience(body: ExperienceIn, repo: PostgresRepo = Depends(get_repo)):
        data = body.model_dump()
        if data["position"] is None:
            data["position"] = max((e.position for e in repo.list_experiences()), default=-1) + 1
        now = clock.now()
        e = apply.Experience(**data, created_at=now, updated_at=now)
        repo.save_experience(e)
        return experience_json(e)

    @r.patch("/experiences/{experience_id}")
    def patch_experience(experience_id: str, body: ExperiencePatch, repo: PostgresRepo = Depends(get_repo)):  # fmt: skip
        e = repo.get_experience(_uuid(experience_id))
        if e is None:
            raise services.NotFound(experience_id)
        for key, value in body.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(e, key, value.strip() if isinstance(value, str) else value)
        e.updated_at = clock.now()
        repo.save_experience(e)
        return experience_json(e)

    @r.delete("/experiences/{experience_id}", status_code=204)
    def delete_experience(experience_id: str, repo: PostgresRepo = Depends(get_repo)):
        repo.delete_experience(_uuid(experience_id))

    @r.get("/facts")
    def list_facts(repo: PostgresRepo = Depends(get_repo)):
        return [fact_json(f) for f in repo.list_facts()]

    @r.post("/facts", status_code=201)
    def add_fact(body: FactIn, repo: PostgresRepo = Depends(get_repo)):
        facts = repo.list_facts()
        base = re.sub(r"[^a-z0-9]+", "_", body.label.lower()).strip("_")[:40] or "fact"
        key, n = base, 2
        while any(f.key == key for f in facts):
            key, n = f"{base}_{n}", n + 1
        f = apply.Fact(key=key, label=body.label.strip(), updated_at=clock.now(),
                       position=max((f.position for f in facts), default=-1) + 1)  # fmt: skip
        repo.save_fact(f)
        return fact_json(f)

    @r.patch("/facts/{key}")
    def patch_fact(key: str, body: FactPatch, repo: PostgresRepo = Depends(get_repo)):
        f = next((f for f in repo.list_facts() if f.key == key), None)
        if f is None:
            raise services.NotFound(key)
        for field, value in body.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(f, field, value.strip())
        f.updated_at = clock.now()
        repo.save_fact(f)
        return fact_json(f)

    @r.delete("/facts/{key}", status_code=204)
    def delete_fact(key: str, repo: PostgresRepo = Depends(get_repo)):
        repo.delete_fact(key)

    return r
