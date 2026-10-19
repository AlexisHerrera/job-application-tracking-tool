"""`jobtracker` command line."""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path

import typer

from jobtracker.adapters.db.migrate import migrate
from jobtracker.adapters.db.repo import PostgresRepo
from jobtracker.core import campaigns, services, stats
from jobtracker.core.clock import SystemClock
from jobtracker.core.email_parse import parse_email
from jobtracker.core.models import Origin, Stage
from jobtracker.core.pipeline import (
    Pipeline,
    PipelineConfig,
    RunReport,
    run_backfill,
    run_incremental,
)
from jobtracker.core.stages import display_status
from jobtracker.settings import Settings, load_dotenv

app = typer.Typer(no_args_is_help=True, help="Personal job application tracker.")
db_app = typer.Typer(no_args_is_help=True, help="Database commands.")
apps_app = typer.Typer(no_args_is_help=True, help="Manage applications.")
dev_app = typer.Typer(no_args_is_help=True, help="Local development helpers.")
app.add_typer(db_app, name="db")
app.add_typer(apps_app, name="app")
app.add_typer(dev_app, name="dev")
campaign_app = typer.Typer(no_args_is_help=True, help="Job-search campaigns.")
app.add_typer(campaign_app, name="campaign")


@app.callback()
def _setup(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Never log request bodies or headers from HTTP clients.
    for noisy in ("httpx", "httpcore", "anthropic"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _settings() -> Settings:
    load_dotenv()
    return Settings.from_env()


def _repo(settings: Settings) -> PostgresRepo:
    return PostgresRepo.connect(settings.database_url)


def _pipeline(settings: Settings, repo: PostgresRepo, dry_run: bool) -> Pipeline:
    from jobtracker.adapters.anthropic_llm import AnthropicLLM

    llm = AnthropicLLM(settings.anthropic_api_key, settings.llm_model, settings.llm_effort)
    cfg = PipelineConfig(
        tz=settings.tz, my_addresses=settings.my_addresses, body_limit=settings.llm_body_chars
    )
    return Pipeline(repo, llm, SystemClock(), cfg, dry_run=dry_run)


def _imap(settings: Settings):
    from jobtracker.adapters.imap_gmail import GmailImapSource

    return GmailImapSource(
        settings.imap_host,
        settings.gmail_address,
        settings.gmail_app_password,
        settings.imap_extra_query,
    )


def _print_report(report: RunReport, pipeline: Pipeline) -> None:
    usage = pipeline.llm.usage if pipeline.llm else None
    typer.echo(
        json.dumps(
            {
                "seen": report.seen,
                "counts": dict(report.counts),
                "created_applications": report.created,
                "unassigned": report.unassigned,
                "errors": report.errors,
                "last_uid": report.last_uid,
                "llm_calls": usage.calls if usage else 0,
                "llm_input_tokens": usage.input_tokens if usage else 0,
                "llm_output_tokens": usage.output_tokens if usage else 0,
            },
            indent=2,
        )
    )


@db_app.command("migrate")
def db_migrate() -> None:
    """Apply pending migrations."""
    applied = migrate(_settings().database_url)
    typer.echo(f"applied: {', '.join(applied) or 'nothing (up to date)'}")


@app.command()
def ingest(
    dry_run: bool = typer.Option(False, help="Classify but write nothing."),
    limit: int | None = typer.Option(None, help="Stop after N messages."),
    loop: int | None = typer.Option(None, help="Repeat every N seconds (docker compose ingest)."),
) -> None:
    """Process new mail from your REAL Gmail inbox since the last run (paid LLM calls)."""
    settings = _settings()
    while True:
        repo = _repo(settings)
        source = _imap(settings)
        try:
            pipeline = _pipeline(settings, repo, dry_run)
            _print_report(run_incremental(pipeline, source, limit), pipeline)
        finally:
            source.close()
            repo.close()
        if not loop:
            break
        time.sleep(loop)


@app.command()
def backfill(
    since: datetime | None = typer.Option(
        None, formats=["%Y-%m-%d"], help="Default: the current campaign's start."
    ),
    until: datetime | None = typer.Option(None, formats=["%Y-%m-%d"]),
    dry_run: bool = typer.Option(False),
    limit: int | None = typer.Option(None),
) -> None:
    """Run the pipeline over a date range of your REAL inbox (paid LLM calls). Idempotent."""
    settings = _settings()
    repo = _repo(settings)
    start = since.date() if since else None
    if start is None:
        cur = campaigns.current(repo.list_campaigns(), datetime.now(settings.tz).date())
        if cur is None:
            raise typer.BadParameter("pass --since or create a campaign first")
        start = cur.started_on
        typer.echo(f"backfilling from campaign '{cur.name}' start: {start}")
    source = _imap(settings)
    try:
        pipeline = _pipeline(settings, repo, dry_run)
        report = run_backfill(pipeline, source, start, until.date() if until else None, limit)
        _print_report(report, pipeline)
    finally:
        source.close()
        repo.close()


@app.command("process-eml")
def process_eml(paths: list[Path], dry_run: bool = typer.Option(True)) -> None:
    """Run the pipeline on local .eml files (paid LLM calls for candidates). Dry run by default."""
    settings = _settings()
    repo = _repo(settings)
    pipeline = _pipeline(settings, repo, dry_run)
    for path in paths:
        email = parse_email(path.read_bytes())
        with repo.transaction():
            out = pipeline.process(email)
        ev = out.event
        typer.echo(
            f"{path.name}: {out.verdict} {out.stage} {out.reason}"
            + (f" -> {ev.event_type} app={ev.application_id} match={ev.match_method}" if ev else "")
        )


@apps_app.command("add")
def app_add(
    company: str = typer.Option(...),
    role: str = typer.Option(...),
    job_url: str | None = typer.Option(None),
    company_domain: str | None = typer.Option(None),
    source_channel: str | None = typer.Option(None),
    applied_at: datetime | None = typer.Option(None, formats=["%Y-%m-%d"]),
    stage: Stage | None = typer.Option(None),
) -> None:
    """Add an application by hand."""
    settings = _settings()
    repo = _repo(settings)
    data = services.ApplicationInput(
        company=company,
        role_title=role,
        job_url=job_url,
        company_domain=company_domain,
        source_channel=source_channel,
        applied_at=applied_at.replace(tzinfo=settings.tz).astimezone(UTC) if applied_at else None,
        stage=stage,
    )
    with repo.transaction():
        a = services.create_application(repo, SystemClock(), data)
    typer.echo(f"created {a.id} {a.company_name} / {a.role_title}")


@apps_app.command("import")
def app_import(csv_path: Path) -> None:
    """Import applications from CSV (columns: company, role, job_url, applied_at, stage, ...)."""
    settings = _settings()
    repo = _repo(settings)
    clock = SystemClock()
    rows = services.parse_csv(csv_path.read_text(), settings.tz)
    with repo.transaction():
        for r in rows:
            services.create_application(repo, clock, r, Origin.IMPORT)
        matched = services.rematch_unassigned(repo, clock, settings.tz)
    typer.echo(f"imported {len(rows)} applications; matched {matched} inbox events")


@apps_app.command("list")
def app_list() -> None:
    settings = _settings()
    now = datetime.now(UTC)
    for a in _repo(settings).list_applications():
        status = display_status(a, now, settings.ghost_days)
        flag = " [review]" if a.needs_review else ""
        applied = a.applied_at.date() if a.applied_at else "?"
        typer.echo(f"{applied}  {status:<12} {a.company_name} / {a.role_title}{flag}")


@app.command("stats")
def stats_cmd() -> None:
    settings = _settings()
    repo = _repo(settings)
    data = stats.summary(
        repo.list_applications(), repo.list_all_events(), datetime.now(UTC),
        settings.ghost_days, settings.followup_days,
    )  # fmt: skip
    typer.echo(json.dumps(data, indent=2, default=str))


@campaign_app.command("create")
def campaign_create(
    name: str = typer.Option(...),
    start: datetime = typer.Option(..., formats=["%Y-%m-%d"]),
    notes: str | None = typer.Option(None),
) -> None:
    """Start a campaign. An ongoing earlier one ends the day before."""
    from jobtracker.core.models import Campaign

    settings = _settings()
    repo = _repo(settings)
    c = Campaign(name=name, started_on=start.date(), notes=notes)
    with repo.transaction():
        campaigns.save(repo, SystemClock(), c, close_previous=True)
    typer.echo(f"campaign '{c.name}' starts {c.started_on} ({c.id})")


@campaign_app.command("list")
def campaign_list() -> None:
    settings = _settings()
    repo = _repo(settings)
    today = datetime.now(settings.tz).date()
    apps, events = repo.list_applications(), repo.list_all_events()
    for c in repo.list_campaigns():
        s = campaigns.summary(c, apps, events, today, settings.tz)
        typer.echo(
            f"{s['started_on']} → {s['ended_on'] or 'ongoing'}  {s['name']}: day {s['day']}, "
            f"{s['applications']} applications, first interview: {s['first_interview_on'] or '—'}"
        )


@dev_app.command("seed")
def dev_seed() -> None:
    """Load FAKE sample data into the local database so the UI has something to show."""
    from jobtracker.cli.seed import seed

    settings = _settings()
    if settings.app_env != "local":
        raise typer.BadParameter("seed only runs with APP_ENV=local")
    repo = _repo(settings)
    with repo.transaction():
        n = seed(repo, SystemClock(), settings.tz)
    typer.echo(f"seeded {n} sample applications")
