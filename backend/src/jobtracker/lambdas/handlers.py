"""AWS Lambda entry points. Thin: all logic lives in core/services.

Both functions read their secrets from SSM once per cold start (see `adapters/ssm_secrets`) and
open one Aurora DSQL connection per request / run (IAM token auth, `PostgresRepo.open`).
"""

from __future__ import annotations

import logging

logging.getLogger().setLevel(logging.INFO)
# Never log request bodies or headers from HTTP clients.
for _noisy in ("httpx", "httpcore", "anthropic", "urllib3", "botocore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

_api_handler = None
_secrets_loaded = False


def _load_secrets() -> list[str]:
    """Once per container. Returns the secret names SSM doesn't have yet."""
    global _secrets_loaded
    from jobtracker.adapters import ssm_secrets

    missing = [] if _secrets_loaded else ssm_secrets.load_into_env()
    _secrets_loaded = True
    return missing


def api(event, context):
    global _api_handler
    if _api_handler is None:
        _load_secrets()  # a missing one only disables its feature (paste → 503)
        from mangum import Mangum

        from jobtracker.api.app import create_app

        _api_handler = Mangum(create_app(), lifespan="off")
    return _api_handler(event, context)


def ingest(event, context):
    """Every 15 minutes from EventBridge Scheduler, or on demand from the API's scan button.
    One run at a time: a run takes the ingest lease in DSQL before it reads any mail, and a run
    that finds it taken returns `{"busy": true}` without touching Gmail."""
    from jobtracker.adapters.anthropic_llm import AnthropicLLM
    from jobtracker.adapters.db.repo import PostgresRepo
    from jobtracker.adapters.imap_gmail import GmailImapSource
    from jobtracker.core.clock import SystemClock
    from jobtracker.core.pipeline import Pipeline, PipelineConfig, run_incremental
    from jobtracker.settings import ConfigError, Settings

    _load_secrets()
    s = Settings.from_env()
    if not (s.gmail_address and s.gmail_app_password and s.anthropic_api_key):
        raise ConfigError(
            "ingest needs GMAIL_ADDRESS, GMAIL_APP_PASSWORD and ANTHROPIC_API_KEY "
            "(the secrets live in SSM: `jobtracker aws push-secrets`)"
        )
    trigger = (event or {}).get("trigger", "schedule")
    repo = PostgresRepo.open(s)
    holder, seconds = _lease_terms(context)
    if not repo.acquire_lease(LEASE, holder, seconds):
        repo.close()
        logging.info("ingest (%s): another run holds the lease, skipping", trigger)
        return {"trigger": trigger, "busy": True}
    try:
        source = GmailImapSource(
            s.imap_host, s.gmail_address, s.gmail_app_password, s.imap_extra_query
        )
    except BaseException:
        repo.release_lease(LEASE, holder)
        repo.close()
        raise
    try:
        llm = AnthropicLLM(s.anthropic_api_key, s.llm_model, s.llm_effort)
        cfg = PipelineConfig(tz=s.tz, my_addresses=s.my_addresses, body_limit=s.llm_body_chars)
        report = run_incremental(Pipeline(repo, llm, SystemClock(), cfg), source)
        result = {
            "trigger": trigger,
            "seen": report.seen,
            "counts": dict(report.counts),
            "job": report.counts.get("job", 0),
            "created": report.created,
            "unassigned": report.unassigned,
            "errors": report.errors,
            "started_fresh": report.started_fresh,
            "last_uid": report.last_uid,
            "llm_calls": llm.usage.calls,
            "calendar": _sync_calendar(s, repo),
        }
        logging.info("ingest: %s", {k: v for k, v in result.items() if k != "calendar"})
        return result
    finally:
        source.close()
        try:
            repo.release_lease(LEASE, holder)
        finally:
            repo.close()


LEASE = "ingest"
LEASE_MARGIN_S = 60
LEASE_FALLBACK_S = 660  # the function timeout (600 s) plus the margin


def _lease_terms(context) -> tuple[str, float]:
    """The lease outlives this invocation by a minute: Lambda kills a run at its timeout, so a
    lease left by a crashed or timed-out run frees itself soon after."""
    import uuid

    holder = getattr(context, "aws_request_id", None) or f"local-{uuid.uuid4()}"
    remaining = getattr(context, "get_remaining_time_in_millis", None)
    seconds = remaining() / 1000 + LEASE_MARGIN_S if remaining else LEASE_FALLBACK_S
    return holder, seconds


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
