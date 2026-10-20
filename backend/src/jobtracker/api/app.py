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
from jobtracker.core import campaigns, interviews, paste, services, stats
from jobtracker.core.clock import SystemClock
from jobtracker.core.models import Campaign, InterviewNote, Origin
from jobtracker.core.pipeline import Pipeline, PipelineConfig, run_incremental
from jobtracker.core.ports import (
    CalendarAuthError,
    CalendarSource,
    LLMClient,
    LLMError,
    MailSource,
)
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
    scan_factory: Callable[[PostgresRepo], tuple[Pipeline, MailSource]] | None = None,
    calendar_factory: Callable[[PostgresRepo], CalendarSource | None] | None = None,
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

    def default_scan(repo: PostgresRepo) -> tuple[Pipeline, MailSource]:
        """The same incremental run the ingest Lambda / `jobtracker ingest` does, in-process."""
        from jobtracker.adapters.anthropic_llm import AnthropicLLM
        from jobtracker.adapters.imap_gmail import GmailImapSource

        if not (settings.gmail_address and settings.gmail_app_password):
            raise HTTPException(503, "GMAIL_ADDRESS / GMAIL_APP_PASSWORD are not configured")
        if not settings.anthropic_api_key:
            raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")
        llm = AnthropicLLM(settings.anthropic_api_key, settings.llm_model, settings.llm_effort)
        cfg = PipelineConfig(
            tz=settings.tz, my_addresses=settings.my_addresses, body_limit=settings.llm_body_chars
        )
        source = GmailImapSource(
            settings.imap_host,
            settings.gmail_address,
            settings.gmail_app_password,
            settings.imap_extra_query,
        )
        return Pipeline(repo, llm, clock, cfg), source

    # Local only for now: in AWS this will invoke the ingest Lambda instead (Phase 3).
    make_scan = scan_factory or (default_scan if settings.app_env == "local" else None)

    def default_calendar(repo: PostgresRepo) -> CalendarSource | None:
        """None until `jobtracker calendar login` has stored a Google login."""
        from jobtracker.adapters.google_calendar import PROVIDER, GoogleCalendarSource

        creds = repo.get_oauth(PROVIDER)
        return GoogleCalendarSource(creds, settings.google_calendar_id) if creds else None

    make_calendar = calendar_factory or default_calendar

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

    @app.exception_handler(campaigns.CampaignError)
    def _campaign_invalid(_req, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(services.InvalidInput)
    def _invalid(_req, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    api = APIRouter(prefix="/api", dependencies=[Depends(verifier)])

    def scoped(repo, campaign: str | None):
        """Applications of one campaign (`campaign` = id), or all when empty/'all'."""
        apps = repo.list_applications()
        if not campaign or campaign == "all":
            return apps
        c = repo.get_campaign(_uuid(campaign))
        if c is None:
            raise services.NotFound(campaign)
        return campaigns.apps_in(c, apps, tz)

    def today():
        return clock.now().astimezone(tz).date()

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
        campaign: str | None = Query(None),
        repo: PostgresRepo = Depends(get_repo),
    ):
        rows = [app_json(a) for a in scoped(repo, campaign)]
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
        system, user = paste.paste_prompt(body.text, clock.now(), tz, forced)
        try:
            raw = llm.complete_json(
                system=system,
                user=user,
                schema=paste.PASTE_SCHEMA,
                max_tokens=paste.MAX_OUTPUT_TOKENS,
            )
        except LLMError as err:
            raise HTTPException(502, f"AI extraction failed ({err}); try again") from err
        records = paste.parse_records(raw, tz, forced.company_name if forced else None)
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
        notes = repo.list_notes(a.id)
        per = interviews.notes_by_interview(notes)
        return {
            **app_json(a),
            "events": [s.event_json(e) for e in repo.list_events(a.id)],
            "interviews": [
                s.interview_json(iv, per.get(iv.id, 0))
                for iv in repo.list_interviews(a.id)
                if not iv.dismissed
            ],
            "interview_notes": [s.note_json(n) for n in notes],
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
            a = services.update_fields(
                repo, clock, _uuid(app_id), body.model_dump(exclude_unset=True)
            )
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

    @api.post("/events/{event_id}/replied")
    def replied(event_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            e = services.mark_replied(repo, clock, _uuid(event_id))
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

    def check_interview(app_id: uuid.UUID, interview_id: uuid.UUID | None, repo) -> None:
        if interview_id is None:
            return
        iv = repo.get_interview(interview_id)
        if iv is None or iv.application_id != app_id:
            raise services.InvalidInput("that interview isn't part of this application")

    @api.post("/applications/{app_id}/interviews", status_code=201)
    def add_interview(app_id: str, body: s.InterviewIn, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            iv = services.add_interview(repo, clock, _uuid(app_id), body.model_dump())
        return s.interview_json(iv)

    @api.patch("/interviews/{interview_id}")
    def patch_interview(
        interview_id: str, body: s.InterviewPatch, repo: PostgresRepo = Depends(get_repo)
    ):
        with repo.transaction():
            iv = repo.get_interview(_uuid(interview_id))
            if iv is None:
                raise services.NotFound(interview_id)
            iv = services.update_interview(repo, clock, iv, body.model_dump(exclude_unset=True))
        notes = interviews.notes_by_interview(
            repo.list_notes(iv.application_id) if iv.application_id else [], [iv]
        )
        return s.interview_json(iv, notes.get(iv.id, 0))

    @api.delete("/interviews/{interview_id}", status_code=204)
    def remove_interview(interview_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            services.remove_interview(repo, clock, _uuid(interview_id))

    @api.post("/interviews/{interview_id}/assign")
    def assign_interview(
        interview_id: str, body: s.AssignIn, repo: PostgresRepo = Depends(get_repo)
    ):
        with repo.transaction():
            iv = services.assign_interview(
                repo, clock, _uuid(interview_id), _uuid(body.application_id), settings.my_addresses
            )
        return s.interview_json(iv)

    @api.post("/interviews/{interview_id}/general")
    def mark_general(interview_id: str, repo: PostgresRepo = Depends(get_repo)):
        with repo.transaction():
            iv = services.mark_general(repo, clock, _uuid(interview_id))
        return s.interview_json(iv, 1 if iv.notes else 0)

    @api.get("/interviews")
    def all_interviews(repo: PostgresRepo = Depends(get_repo)):
        """Every interview, oldest first: the applications' ones and general talks."""
        apps = {a.id: a for a in repo.list_applications()}
        companies = {c.id: c.name for c in repo.list_companies()}
        ivs = [iv for iv in repo.list_interviews() if interviews.listed(iv)]
        per = interviews.notes_by_interview(repo.list_notes(), ivs)
        return [
            {
                **s.interview_json(
                    iv,
                    per.get(iv.id, 0),
                    apps[iv.application_id].company_name
                    if iv.application_id in apps
                    else companies.get(iv.company_hint_id),
                ),
                "role": apps[iv.application_id].role_title if iv.application_id in apps else None,
            }
            for iv in ivs
        ]

    @api.get("/interviews/unassigned")
    def unassigned_interviews(repo: PostgresRepo = Depends(get_repo)):
        companies = {c.id: c.name for c in repo.list_companies()}
        return [
            s.interview_json(iv, company=companies.get(iv.company_hint_id))
            for iv in repo.list_unassigned_interviews()
        ]

    @api.get("/calendar")
    def calendar_status(repo: PostgresRepo = Depends(get_repo)):
        last = repo.last_calendar_sync_at()
        return {
            "connected": make_calendar(repo) is not None,
            "calendar_id": settings.google_calendar_id,
            "last_sync_at": last.isoformat() if last else None,
        }

    @api.post("/calendar/sync")
    def calendar_sync(repo: PostgresRepo = Depends(get_repo)):
        """Pull calendar changes (read-only, free: no LLM involved) and match them."""
        source = make_calendar(repo)
        if source is None:
            raise HTTPException(
                409, "Google Calendar isn't connected: run `jobtracker calendar login`"
            )
        try:
            report = services.sync_calendar(
                repo, clock, source, services.calendar_since(repo, clock, tz), settings.my_addresses
            )
        except CalendarAuthError as err:
            raise HTTPException(503, str(err)) from err
        return {
            "seen": report.seen,
            "created": report.created,
            "updated": report.updated,
            "cancelled": report.cancelled,
            "unassigned": report.unassigned,
            "full_sync": report.full_sync,
        }

    @api.post("/applications/{app_id}/notes", status_code=201)
    def add_note(app_id: str, body: s.NoteIn, repo: PostgresRepo = Depends(get_repo)):
        aid = _uuid(app_id)
        if repo.get_application(aid) is None:
            raise services.NotFound(app_id)
        check_interview(aid, body.interview_id, repo)
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
            check_interview(note.application_id, body.interview_id, repo)
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
    def get_stats(campaign: str | None = Query(None), repo: PostgresRepo = Depends(get_repo)):
        apps = scoped(repo, campaign)
        return {
            **stats.summary(
                apps,
                repo.list_all_events(),
                clock.now(),
                settings.ghost_days,
                settings.followup_days,
            ),
            "interviews": interviews.counts(
                repo.list_interviews(), {a.id for a in apps}, clock.now()
            ),
        }

    @api.get("/scan")
    def scan_status(repo: PostgresRepo = Depends(get_repo)):
        last = repo.last_sync_at()
        return {
            "available": make_scan is not None,
            "last_scan_at": last.isoformat() if last else None,
        }

    @api.post("/scan")
    def scan(repo: PostgresRepo = Depends(get_repo)):
        """Check the inbox now: new mail since the last run (reads Gmail, paid LLM calls)."""
        if make_scan is None:
            raise HTTPException(501, "Scanning from the dashboard isn't available here yet")
        if not repo.try_ingest_lock():
            raise HTTPException(409, "A scan is already running")
        pipeline, source = make_scan(repo)
        try:
            report = run_incremental(pipeline, source)
        finally:
            source.close()
        log.info("scan: seen=%s counts=%s", report.seen, dict(report.counts))
        return {
            "seen": report.seen,
            "job": report.counts.get("job", 0),
            "created": report.created,
            "unassigned": report.unassigned,
            "errors": report.errors,
            "started_fresh": report.started_fresh,
            "llm_calls": pipeline.llm.usage.calls if pipeline.llm else 0,
        }

    @api.get("/dashboard")
    def dashboard(repo: PostgresRepo = Depends(get_repo)):
        apps = repo.list_applications()
        now = clock.now()
        all_interviews = repo.list_interviews()
        per = interviews.notes_by_interview(repo.list_notes(), all_interviews)
        names = {a.id: a.company_name for a in apps}
        roles = {a.id: a.role_title for a in apps}

        def row(iv):
            return {
                **s.interview_json(iv, per.get(iv.id, 0), names.get(iv.application_id)),
                "role": roles.get(iv.application_id),
            }

        return {
            "upcoming_interviews": [row(iv) for iv in interviews.upcoming(all_interviews, now)],
            "recent_interviews": [row(iv) for iv in interviews.recent(all_interviews, now)],
            "unassigned_interviews": len(repo.list_unassigned_interviews()),
            "follow_ups": stats.follow_ups(
                apps, repo.list_all_events(), now, settings.followup_days, settings.ghost_days
            ),
            "needs_review": sum(1 for a in apps if a.needs_review),
            "unassigned": len(repo.list_unassigned()),
            "campaign": (
                campaigns.summary(c, apps, repo.list_all_events(), today(), tz)
                if (c := campaigns.current(repo.list_campaigns(), today()))
                else None
            ),
        }

    @api.get("/campaigns")
    def list_campaigns(repo: PostgresRepo = Depends(get_repo)):
        apps, events, cs = repo.list_applications(), repo.list_all_events(), repo.list_campaigns()
        cur = campaigns.current(cs, today())
        return {
            "current_id": str(cur.id) if cur else None,
            "campaigns": [campaigns.summary(c, apps, events, today(), tz) for c in reversed(cs)],
        }

    @api.post("/campaigns", status_code=201)
    def create_campaign(body: s.CampaignIn, repo: PostgresRepo = Depends(get_repo)):
        c = Campaign(
            name=body.name.strip(),
            started_on=body.started_on,
            ended_on=body.ended_on,
            notes=body.notes,
        )
        with repo.transaction():
            campaigns.save(repo, clock, c, close_previous=body.close_previous)
        return campaigns.summary(c, repo.list_applications(), repo.list_all_events(), today(), tz)

    @api.patch("/campaigns/{campaign_id}")
    def patch_campaign(
        campaign_id: str, body: s.CampaignPatch, repo: PostgresRepo = Depends(get_repo)
    ):
        with repo.transaction():
            c = repo.get_campaign(_uuid(campaign_id))
            if c is None:
                raise services.NotFound(campaign_id)
            for field, value in body.model_dump(exclude_unset=True).items():
                setattr(
                    c, field, value.strip() if isinstance(value, str) and field == "name" else value
                )
            campaigns.save(repo, clock, c)
        return campaigns.summary(c, repo.list_applications(), repo.list_all_events(), today(), tz)

    @api.delete("/campaigns/{campaign_id}", status_code=204)
    def delete_campaign(campaign_id: str, repo: PostgresRepo = Depends(get_repo)):
        # Only the date range goes away; applications are untouched.
        with repo.transaction():
            repo.delete_campaign(_uuid(campaign_id))

    app.include_router(api)
    return app
