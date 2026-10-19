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
        }
    finally:
        source.close()
        repo.close()
