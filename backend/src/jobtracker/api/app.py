"""HTTP API. Every route except /api/health requires a valid Cloudflare Access JWT."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Iterator

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from jobtracker.adapters.db.repo import PostgresRepo
from jobtracker.api import schemas as s
from jobtracker.api.auth import AccessVerifier, User
from jobtracker.core import paste, services, stats
from jobtracker.core.clock import SystemClock
from jobtracker.core.models import InterviewNote, Origin
from jobtracker.core.ports import LLMClient, LLMError
from jobtracker.core.stages import display_status
from jobtracker.settings import Settings

log = logging.getLogger(__name__)


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as err:
        raise HTTPException(404, "not found") from err


def create_app(
    settings: Settings | None = None,
    repo_factory: Callable[[], PostgresRepo] | None = None,
    llm_factory: Callable[[], LLMClient] | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    verifier = AccessVerifier(settings)
    clock = SystemClock()
    tz = settings.tz
    make_repo = repo_factory or (lambda: PostgresRepo.connect(settings.database_url))

    def default_llm() -> LLMClient:
        from jobtracker.adapters.anthropic_llm import AnthropicLLM

        if not settings.anthropic_api_key:
            raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")
        return AnthropicLLM(
            settings.anthropic_api_key, settings.llm_model, settings.llm_paste_effort
        )

    make_llm = llm_factory or default_llm

    def get_repo() -> Iterator[PostgresRepo]:
        repo = make_repo()
        try:
            yield repo
        finally:
            if repo_factory is None:
                repo.close()

    app = FastAPI(title="jobtracker", docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(services.NotFound)
    def _not_found(_req, _exc):
        return JSONResponse({"detail": "not found"}, status_code=404)

    @app.exception_handler(services.InvalidInput)
    def _invalid(_req, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    api = APIRouter(prefix="/api", dependencies=[Depends(verifier)])

    def app_json(a):
        return s.application_json(a, display_status(a, clock.now(), settings.ghost_days))

    @api.get("/me")
    def me(user: User = Depends(verifier)):
        return {"email": user.email}

    @api.get("/applications")
    def list_applications(
        status: str | None = Query(None),
        q: str | None = Query(None),
        needs_review: bool | None = Query(None),
        repo: PostgresRepo = Depends(get_repo),
    ):
        rows = [app_json(a) for a in repo.list_applications()]
        if status:
            wanted = set(status.split(","))
            rows = [r for r in rows if r["status"] in wanted]
        if needs_review is not None:
            rows = [r for r in rows if r["needs_review"] == needs_review]
        if q:
            needle = q.lower()
            rows = [r for r in rows if needle in f"{r['company']} {r['role_title']}".lower()]
        return rows

    @api.post("/applications", status_code=201)
    def create_application(body: s.ApplicationIn, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            a = services.create_application(repo, clock, body.to_input())
            a = repo.get_application(a.id)
        return app_json(a)

    @api.post("/paste")
    def paste_proposal(body: s.PasteIn, repo: PostgresRepo = Depends(get_repo)):
        """AI reads pasted text and PROPOSES changes. Nothing is written here."""
        if len(body.text) > paste.MAX_PASTE_CHARS:
            raise services.InvalidInput(
                f"text is {len(body.text):,} characters; the limit is {paste.MAX_PASTE_CHARS:,}. "
                "Split it into smaller pastes."
            )
        forced = None
        if body.application_id:
            forced = repo.get_application(_uuid(body.application_id))
            if forced is None:
                raise services.NotFound(body.application_id)
        llm = make_llm()
        system, user = paste.paste_prompt(body.text, clock.now(), tz)
        try:
            raw = llm.complete_json(
                system=system, user=user, schema=paste.PASTE_SCHEMA, max_tokens=16000
            )
        except LLMError as err:
            raise HTTPException(502, f"AI extraction failed ({err}); try again") from err
        records = paste.parse_records(raw, tz)
        if forced is not None:
            records = records[:1]
        apps = repo.list_applications()
        domains = {
            a.company_id: {
                al.value for al in repo.list_aliases(a.company_id) if al.kind.value == "domain"
            }
            for a in ([forced] if forced else apps)
        }
        out = []
        for rec in records:
            options, default = paste.propose(rec, apps, domains, forced)
            out.append(
                {
                    "company": rec.company,
                    "evidence": rec.evidence,
                    "salary_note": rec.salary_note,
                    "options": [s.option_json(o) for o in options],
                    "default_option": default,
                }
            )
        return {
            "records": out,
            "llm_input_tokens": llm.usage.input_tokens,
            "llm_output_tokens": llm.usage.output_tokens,
        }

    @api.post("/applications/import")
    def import_csv(body: s.CsvImportIn, repo: PostgresRepo = Depends(get_repo)):
        rows = services.parse_csv(body.csv, tz)
        with repo.transaction():
            created = [services.create_application(repo, clock, r, Origin.IMPORT) for r in rows]
            matched = services.rematch_unassigned(repo, clock, tz)
        return {"created": len(created), "matched_from_inbox": matched}

    @api.get("/applications/{app_id}")
    def get_application(app_id: str, repo: PostgresRepo = Depends(get_repo)):
        a = repo.get_application(_uuid(app_id))
        if a is None:
            raise services.NotFound(app_id)
        return {
            **app_json(a),
            "events": [s.event_json(e) for e in repo.list_events(a.id)],
            "interview_notes": [s.note_json(n) for n in repo.list_notes(a.id)],
            "aliases": [
                {"kind": al.kind.value, "value": al.value, "learned_from": al.learned_from}
                for al in repo.list_aliases(a.company_id)
            ],
        }

    @api.patch("/applications/{app_id}")
    def patch_application(
        app_id: str, body: s.ApplicationPatch, repo: PostgresRepo = Depends(get_repo)
    ):
        with repo.transaction():
            a = repo.get_application(_uuid(app_id))
            if a is None:
                raise services.NotFound(app_id)
            changes = body.model_dump(exclude_unset=True)
            domain = changes.pop("company_domain", None)
            for field, value in changes.items():
                setattr(a, field, value)
            if a.salary_min and a.salary_max and a.salary_min > a.salary_max:
                raise services.InvalidInput("salary min is greater than salary max")
            if a.salary_currency:
                a.salary_currency = a.salary_currency.upper()
            if domain:
                company = repo.get_company(a.company_id)
                services.add_company_domain(repo, company, domain, "manual")
            a.updated_at = clock.now()
            repo.update_application(a)
            a = services.recompute(repo, clock, a.id)
        return app_json(a)

    @api.delete("/applications/{app_id}", status_code=204)
    def delete_application(app_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            services.delete_application(repo, clock, _uuid(app_id))

    @api.post("/applications/{app_id}/stage")
    def change_stage(app_id: str, body: s.StageChangeIn, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            services.change_stage(
                repo, clock, _uuid(app_id), body.stage, body.at, body.round, body.note
            )
            a = repo.get_application(_uuid(app_id))
        return app_json(a)

    @api.post("/applications/{app_id}/reviewed")
    def mark_reviewed(app_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            a = services.mark_reviewed(repo, clock, _uuid(app_id))
        return app_json(a)

    @api.get("/inbox")
    def inbox(repo: PostgresRepo = Depends(get_repo)):
        companies = {c.id: c.name for c in repo.list_companies()}
        return [
            {**s.event_json(e), "company_hint": companies.get(e.company_hint_id)}
            for e in repo.list_unassigned()
        ]

    @api.post("/events/{event_id}/assign")
    def assign(event_id: str, body: s.AssignIn, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            e = services.assign_event(repo, clock, tz, _uuid(event_id), _uuid(body.application_id))
        return s.event_json(e)

    @api.post("/events/{event_id}/dismiss")
    def dismiss(event_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            e = services.dismiss_event(repo, _uuid(event_id))
        return s.event_json(e)

    @api.post("/events/{event_id}/create-application", status_code=201)
    def create_from_event(
        event_id: str, body: s.ApplicationIn, repo: PostgresRepo = Depends(get_repo)
    ):
        with repo.transaction():
            a = services.create_application_from_event(
                repo, clock, tz, _uuid(event_id), body.to_input()
            )
            a = repo.get_application(a.id)
        return app_json(a)

    @api.get("/companies")
    def companies(repo: PostgresRepo = Depends(get_repo)):
        return [{"id": str(c.id), "name": c.name} for c in repo.list_companies()]

    @api.post("/applications/{app_id}/notes", status_code=201)
    def add_note(app_id: str, body: s.NoteIn, repo: PostgresRepo = Depends(get_repo)):
        aid = _uuid(app_id)
        if repo.get_application(aid) is None:
            raise services.NotFound(app_id)
        now = clock.now()
        note = InterviewNote(
            application_id=aid, **body.model_dump(), created_at=now, updated_at=now
        )
        with repo.transaction():
            repo.save_note(note)
        return s.note_json(note)

    @api.put("/notes/{note_id}")
    def update_note(note_id: str, body: s.NoteIn, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            note = repo.get_note(_uuid(note_id))
            if note is None:
                raise services.NotFound(note_id)
            for field, value in body.model_dump().items():
                setattr(note, field, value)
            note.updated_at = clock.now()
            repo.save_note(note)
        return s.note_json(note)

    @api.delete("/notes/{note_id}", status_code=204)
    def delete_note(note_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            repo.delete_note(_uuid(note_id))

    @api.get("/stats")
    def get_stats(repo: PostgresRepo = Depends(get_repo)):
        return stats.summary(
            repo.list_applications(),
            repo.list_all_events(),
            clock.now(),
            settings.ghost_days,
            settings.followup_days,
        )

    @api.get("/dashboard")
    def dashboard(repo: PostgresRepo = Depends(get_repo)):
        apps = repo.list_applications()
        now = clock.now()
        return {
            "upcoming_interviews": stats.upcoming_interviews(apps, now),
            "follow_ups": stats.follow_ups(
                apps, repo.list_all_events(), now, settings.followup_days, settings.ghost_days
            ),
            "needs_review": sum(1 for a in apps if a.needs_review),
            "unassigned": len(repo.list_unassigned()),
        }

    app.include_router(api)
    return app
