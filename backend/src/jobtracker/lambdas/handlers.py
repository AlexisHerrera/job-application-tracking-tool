"""AWS Lambda entry points (wired up in Phase 3). Thin: all logic lives in core/services."""

from __future__ import annotations

import logging

logging.getLogger().setLevel(logging.INFO)

_api_handler = None


def api(event, context):
    global _api_handler
    if _api_handler is None:
        from mangum import Mangum

        from jobtracker.api.app import create_app

        _api_handler = Mangum(create_app(), lifespan="off")
    return _api_handler(event, context)


def ingest(event, context):
    from jobtracker.adapters.anthropic_llm import AnthropicLLM
    from jobtracker.adapters.db.repo import PostgresRepo
    from jobtracker.adapters.imap_gmail import GmailImapSource
    from jobtracker.core.clock import SystemClock
    from jobtracker.core.pipeline import Pipeline, PipelineConfig, run_incremental
    from jobtracker.settings import Settings

    s = Settings.from_env()
    repo = PostgresRepo.connect(s.database_url)
    source = GmailImapSource(s.imap_host, s.gmail_address, s.gmail_app_password, s.imap_extra_query)
    try:
        llm = AnthropicLLM(s.anthropic_api_key, s.llm_model, s.llm_effort)
        cfg = PipelineConfig(tz=s.tz, my_addresses=s.my_addresses, body_limit=s.llm_body_chars)
        report = run_incremental(Pipeline(repo, llm, SystemClock(), cfg), source)
        return {
            "seen": report.seen,
            "counts": dict(report.counts),
            "errors": report.errors,
            "llm_calls": llm.usage.calls,
            "calendar": _sync_calendar(s, repo),
        }
    finally:
        source.close()
        repo.close()


def _sync_calendar(s, repo) -> dict | None:
    """Calendar changes after the mail, as `jobtracker ingest` does. In AWS only the service
    account works (an OAuth login needs a browser), and a calendar failure never fails the mail
    run: it's logged and returned."""
    from dataclasses import asdict

    from jobtracker.adapters.google_calendar import make_source
    from jobtracker.core import services
    from jobtracker.core.clock import SystemClock
    from jobtracker.core.ports import CalendarAuthError

    source = make_source(s.google_service_account_key, s.google_calendar_id, None)
    if source is None:
        return None
    clock = SystemClock()
    try:
        since = services.calendar_since(repo, clock, s.tz)
        return asdict(services.sync_calendar(repo, clock, source, since, s.my_addresses))
    except CalendarAuthError as err:
        logging.error("calendar sync skipped: %s", err)
        return {"error": str(err)}
