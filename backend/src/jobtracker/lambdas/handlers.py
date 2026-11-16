"""AWS Lambda entry points. Thin: all logic lives in core/services.

Three functions share the zip: `api`, `ingest` (mail + calendar) and `discover` (job discovery
and its digest). Each reads its secrets from SSM once per cold start (see `adapters/ssm_secrets`)
and opens one Aurora DSQL connection per request / run (IAM token auth, `PostgresRepo.open`).
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
    if not (s.gmail_address and s.gmail_app_password and s.llm_configured):
        raise ConfigError(
            "ingest needs GMAIL_ADDRESS, GMAIL_APP_PASSWORD (SSM: `jobtracker aws push-secrets`) "
            "and the ANTHROPIC_FEDERATION_* IDs for the LLM"
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
        llm = AnthropicLLM.from_settings(s, s.llm_effort)
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


DISCOVER_LEASE = "discover"
DEADLINE_MARGIN_S = 120  # stop scoring this long before the timeout: in-flight calls finish


def discover(event, context):
    """Job discovery in AWS (plan round 5). Every 6 hours from EventBridge Scheduler, or from the
    Discover page's buttons (an async invoke: the page follows the progress row in DSQL).

    `{"action": "run", "score": bool, "collect": bool}` collects and scores, `"rescore"` scores
    the recent postings again, `"digest"` emails the day's matches. Runs and re-scores take their
    own lease (not the mail ingest's), so they never wait on a mail scan; a second one answers
    `{"busy": true}`. The digest reads only, apart from noting what it sent."""
    from jobtracker.adapters.db.repo import PostgresRepo
    from jobtracker.settings import Settings

    _load_secrets()
    s = Settings.from_env()
    event = event or {}
    action = event.get("action", "run")
    trigger = event.get("trigger", "schedule")
    repo = PostgresRepo.open(s)
    try:
        if action == "digest":
            return _digest(s, repo)
        if action not in ("run", "rescore"):
            raise ValueError(f"unknown discover action {action!r}")
        holder, seconds = _lease_terms(context)
        if not repo.acquire_lease(DISCOVER_LEASE, holder, seconds):
            logging.info("discover (%s): another run holds the lease, skipping", trigger)
            return {"action": action, "trigger": trigger, "busy": True}
        try:
            return _discover_run(s, repo, event, action, trigger, context)
        finally:
            repo.release_lease(DISCOVER_LEASE, holder)
    finally:
        repo.close()


def _discover_run(s, repo, event, action, trigger, context) -> dict:
    from datetime import timedelta

    from jobtracker.adapters.anthropic_llm import AnthropicLLM
    from jobtracker.adapters.ats_boards import AtsBoards
    from jobtracker.adapters.job_sources import discovery_sources
    from jobtracker.api.schemas import run_json
    from jobtracker.core import discovery, discovery_progress
    from jobtracker.core.clock import SystemClock
    from jobtracker.settings import ConfigError

    clock = SystemClock()
    score = action == "rescore" or bool(event.get("score", True))
    if score and not s.llm_configured:
        raise ConfigError("discover needs the ANTHROPIC_FEDERATION_* IDs (or a key) to score")
    llm = AnthropicLLM.from_settings(s, s.llm_effort) if score else None
    remaining = getattr(context, "get_remaining_time_in_millis", None)
    deadline = (
        clock.now() + timedelta(seconds=remaining() / 1000 - DEADLINE_MARGIN_S)
        if remaining
        else None
    )
    writer = discovery_progress.ProgressWriter(repo, clock)
    try:
        if action == "rescore":
            run = discovery.rescore(
                repo, llm, clock, include_hidden=bool(event.get("include_hidden")),
                deadline=deadline, on_progress=writer,
            )  # fmt: skip
        else:
            run = discovery.run_discovery(
                repo, discovery_sources(), llm, clock, boards=AtsBoards(), trigger=trigger,
                collect=bool(event.get("collect", True)), deadline=deadline, on_progress=writer,
            ).run  # fmt: skip
    finally:
        _close_progress(repo, clock)
    result = {"action": action, **run_json(run)}
    logging.info("discover: %s", result)
    return result


def _close_progress(repo, clock) -> None:
    """A run that raised leaves its progress row unfinished: mark it done for the page."""
    from jobtracker.core import discovery_progress

    p = discovery_progress.load(repo, clock.now())
    if p is not None and p.phase != "done":
        p.phase, p.finished_at = "done", clock.now()
        discovery_progress.save(repo, p, clock.now())


def _digest(s, repo) -> dict:
    from jobtracker.adapters.smtp_mail import GmailSmtpMailer
    from jobtracker.core import digest
    from jobtracker.core.clock import SystemClock

    mailer = GmailSmtpMailer(s.smtp_host, s.gmail_address, s.gmail_app_password)
    result = digest.send(repo, mailer, SystemClock(), s.tz, s.app_url)
    logging.info("discover digest: %s", result)
    return {"action": "digest", **result}
