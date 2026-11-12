"""`jobtracker` command line."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import typer

from jobtracker.adapters.db.connect import ADMIN, DsqlTarget, connect_dsql, connect_url
from jobtracker.adapters.db.migrate import migrate, migrate_connection
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
eval_app = typer.Typer(no_args_is_help=True, help="Prompt evaluations (paid LLM calls).")
app.add_typer(eval_app, name="eval")
details_app = typer.Typer(
    no_args_is_help=True, help="Fill application details from their emails: the eval."
)
eval_app.add_typer(details_app, name="details")
calendar_app = typer.Typer(no_args_is_help=True, help="Google Calendar sync (read-only).")
app.add_typer(calendar_app, name="calendar")
aws_app = typer.Typer(no_args_is_help=True, help="AWS deployment helpers (touch your AWS account).")
app.add_typer(aws_app, name="aws")
discover_app = typer.Typer(
    no_args_is_help=True, help="Job discovery: collect new postings and score them (plan §20)."
)
app.add_typer(discover_app, name="discover")
DETAILS_DIR = Path("../eval/details")


@app.callback()
def _setup(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Never log request bodies or headers from HTTP clients.
    for noisy in ("httpx", "httpcore", "anthropic", "google_auth_oauthlib", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _settings() -> Settings:
    load_dotenv()
    return Settings.from_env()


def _repo(settings: Settings) -> PostgresRepo:
    return PostgresRepo.open(settings)


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


def _show_outcome(email, out) -> None:
    ev = out.event
    detail = ""
    if ev is not None:
        x = ev.extraction or {}
        detail = (
            f" -> {ev.event_type} | {x.get('company') or '?'} / {x.get('role') or '?'}"
            f" | conf {ev.confidence:.2f} | match {ev.match_method}"
            + (f" | interview {ev.interview_at:%Y-%m-%d %H:%M}Z" if ev.interview_at else "")
        )
    typer.echo(
        f"{email.received_at:%m-%d} {email.from_address[:34]:<34} {email.subject[:60]:<60} "
        f"{out.verdict}:{out.stage or ''}:{out.reason}{detail}"
    )


DSQL_OPT = typer.Option(
    None, "--dsql", help="Aurora DSQL cluster endpoint (<id>.dsql.<region>.on.aws), as admin."
)
PROFILE_OPT = typer.Option("jobtracker", "--profile", help="AWS profile for the IAM token.")


def _dsql(endpoint: str, profile: str):
    return connect_dsql(DsqlTarget(endpoint, ADMIN, profile=profile))


@db_app.command("migrate")
def db_migrate(dsql: str | None = DSQL_OPT, profile: str = PROFILE_OPT) -> None:
    """Apply pending migrations (local Postgres, or Aurora DSQL with --dsql)."""
    if dsql:
        with _dsql(dsql, profile) as conn:
            applied = migrate_connection(conn, dsql=True)
    else:
        applied = migrate(_settings().database_url)
    typer.echo(f"applied: {', '.join(applied) or 'nothing (up to date)'}")


@db_app.command("grant-roles")
def db_grant_roles(
    dsql: str = typer.Option(..., "--dsql", help="Aurora DSQL cluster endpoint."),
    role: list[str] = typer.Option(
        ..., "--role", help="db_role=arn:aws:iam::…:role/… (repeat per Lambda)."
    ),
    profile: str = PROFILE_OPT,
) -> None:
    """DSQL only: a login role per Lambda, mapped to its IAM role, with DML on the app tables."""
    from jobtracker.adapters.db.dsql_roles import ensure_app_roles

    roles = dict(r.split("=", 1) for r in role)
    with _dsql(dsql, profile) as conn:
        ran = ensure_app_roles(conn, roles)
    typer.echo("\n".join(ran) or "nothing to do")


@db_app.command("copy-to-dsql")
def db_copy_to_dsql(
    dsql: str = typer.Option(..., "--dsql", help="Aurora DSQL cluster endpoint."),
    profile: str = PROFILE_OPT,
    overwrite: bool = typer.Option(
        False, help="Update rows that already exist in DSQL from local (default: only add)."
    ),
    dry_run: bool = typer.Option(False, help="Read and count only; write nothing."),
    yes: bool = typer.Option(False, "--yes", "-y", help="Don't ask for confirmation."),
) -> None:
    """Copy the local database (read-only) into Aurora DSQL, in batches. Includes the mail
    checkpoint so the ingest Lambda continues where the local app stopped."""
    from jobtracker.adapters.db.copy import CopyError, copy_all

    settings = _settings()
    if not (dry_run or yes):
        typer.confirm(
            f"Copy {settings.database_url.rsplit('@', 1)[-1]} into {dsql}"
            f"{' (overwriting existing rows)' if overwrite else ''}?",
            abort=True,
        )
    with connect_url(settings.database_url) as source, _dsql(dsql, profile) as target:
        try:
            report = copy_all(
                source, target, overwrite=overwrite, dry_run=dry_run, progress=typer.echo
            )
        except CopyError as err:
            raise typer.BadParameter(str(err)) from err
    typer.echo(f"mail checkpoint in DSQL: {report.mail_sync_state}")
    typer.echo(f"newest processed UID in DSQL: {report.max_processed_uid}")
    if report.mismatched and not dry_run:
        typer.echo(f"⚠ fewer rows in DSQL than locally: {', '.join(report.mismatched)}")
        raise typer.Exit(1)


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
            if not dry_run:
                _sync_calendar_if_connected(settings, repo)
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
    show: bool = typer.Option(False, help="Print one line per email (sender, subject, verdict)."),
    reprocess_dropped: bool = typer.Option(False, help="Re-run mail dropped by an earlier run."),
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
        pipeline.reprocess_dropped = reprocess_dropped
        report = run_backfill(
            pipeline, source, start, until.date() if until else None, limit,
            on_outcome=_show_outcome if show else None,
        )  # fmt: skip
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


def _value(value) -> str:
    text = ", ".join(value) if isinstance(value, list) else str(value)
    text = " ".join(text.split())
    return text if len(text) <= 90 else f"{text[:90]}…"


@apps_app.command("fill-details")
def app_fill_details(
    only: str | None = typer.Option(None, help="Only applications whose company contains this"),
    all_: bool = typer.Option(
        False, "--all", help="Also applications that already have some details"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be filled, save nothing"
    ),
    yes: bool = typer.Option(False, "--yes", help="Skip the confirmation"),
) -> None:
    """⚠️ Paid + reads your inbox: fill each application's empty fields from its own emails.

    Never overwrites a value you have: those proposals are listed, not applied.
    """
    from jobtracker.adapters.anthropic_llm import AnthropicLLM
    from jobtracker.core import details
    from jobtracker.core.ports import LLMError

    settings = _settings()
    repo = _repo(settings)
    clock = SystemClock()
    apps = [
        a
        for a in sorted(repo.list_applications(), key=lambda a: a.company_name.lower())
        if (all_ or details.has_no_details(a))
        and (only is None or only.lower() in a.company_name.lower())
        and details.message_ids(repo.list_events(a.id))
    ]
    if not apps:
        typer.echo("nothing to fill (use --all to include applications that have details)")
        return
    typer.echo(
        f"{len(apps)} application(s) -> reads their emails from Gmail (read-only) and makes "
        f"{len(apps)} paid call(s) to {settings.llm_model} (effort {settings.llm_paste_effort})"
        + (" · dry run, nothing is saved" if dry_run else "")
    )
    if not yes:
        typer.confirm("Go?", abort=True)
    llm = AnthropicLLM(settings.anthropic_api_key, settings.llm_model, settings.llm_paste_effort)
    source = _imap(settings)
    filled = failed = 0
    try:
        for app in apps:
            typer.echo(f"\n{app.company_name} · {app.role_title}")
            try:
                with repo.transaction():
                    r = details.fill_application(
                        repo, clock, source, llm, settings.tz, app, dry_run=dry_run
                    )
            except LLMError as err:
                failed += 1
                typer.echo(f"   ! AI call failed ({err}); skipped")
                continue
            if r.error:
                typer.echo(f"   ! {r.error}")
                continue
            note = f", {r.emails_missing} no longer in Gmail" if r.emails_missing else ""
            typer.echo(f"   {r.emails_read} email(s){note}")
            for c in r.applied:
                verb = "added to" if c.kind == "append" else "filled"
                typer.echo(f"   {verb:9} {c.label}: {_value(c.proposed)}")
            for c in r.skipped:
                typer.echo(
                    f"   kept      {c.label}: {_value(c.current)}  (emails say: {_value(c.proposed)})"
                )
            if r.salary_note:
                typer.echo(f"   salary {r.salary_note}")
            if not r.applied and not r.skipped:
                typer.echo("   nothing to add")
            filled += bool(r.applied)
    finally:
        source.close()
    u = llm.usage
    verb = "would fill" if dry_run else "filled"
    typer.echo(
        f"\n{verb} {filled}/{len(apps)} application(s)"
        + (f", {failed} failed" if failed else "")
        + f" · {u.calls} call(s), {u.input_tokens} in / {u.output_tokens} out tokens"
    )


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


@eval_app.command("paste")
def eval_paste(
    directory: Path = typer.Argument(Path("../eval/paste"), help="Folder of .txt pastes"),
    only: str | None = typer.Option(None, help="Only files whose name contains this"),
    yes: bool = typer.Option(False, "--yes", help="Skip the confirmation"),
) -> None:
    """⚠️ Paid: run the paste prompt over real pastes and check them against approved expectations."""
    from jobtracker.adapters.anthropic_llm import AnthropicLLM
    from jobtracker.evals import paste_eval

    settings = _settings()
    files = [f for f in sorted(directory.glob("*.txt")) if only is None or only in f.name]
    if not files:
        raise typer.BadParameter(f"no .txt files in {directory}")
    typer.echo(
        f"{len(files)} file(s) -> {len(files)} paid call(s) to {settings.llm_model} "
        f"(effort {settings.llm_paste_effort})"
    )
    if not yes:
        typer.confirm("Run them?", abort=True)
    llm = AnthropicLLM(settings.anthropic_api_key, settings.llm_model, settings.llm_paste_effort)
    results = []
    for path in files:
        result = paste_eval.run_case(path, llm, settings.tz, datetime.now(UTC))
        results.append(result)
        typer.echo("\n".join(paste_eval.render(result)))
    u = llm.usage
    passed = sum(r.passed for r in results)
    typer.echo(
        f"\n{passed}/{len(results)} passed · {u.input_tokens} in / {u.output_tokens} out tokens"
    )
    if passed < len(results):
        raise typer.Exit(1)


@details_app.command("collect")
def details_collect(directory: Path = typer.Argument(DETAILS_DIR)) -> None:
    """⚠️ Reads your inbox (read-only, no AI): saves each application's emails for the eval."""
    from jobtracker.evals import details_eval

    settings = _settings()
    repo, source = _repo(settings), _imap(settings)
    try:
        lines = details_eval.collect(repo, source, directory, settings.tz)
    finally:
        source.close()
    typer.echo("\n".join(lines) or "no application has emails")
    chars = sum(len(p.read_text()) for p in directory.glob("*.txt"))
    typer.echo(f"\n{len(lines)} application(s) -> {len(lines)} paid call(s) per run, "
               f"~{chars // 4:,} input tokens of emails in total")  # fmt: skip


@details_app.command("snapshot")
def details_snapshot(
    directory: Path = typer.Argument(DETAILS_DIR),
    force: bool = typer.Option(False, "--force", help="Replace existing expectations"),
) -> None:
    """Save each application's reviewed fields (from the DB) as its expected result."""
    from jobtracker.evals import details_eval

    settings = _settings()
    typer.echo("\n".join(details_eval.snapshot(_repo(settings), directory, force)))


@details_app.command("run")
def details_run(
    directory: Path = typer.Argument(DETAILS_DIR),
    only: str | None = typer.Option(None, help="Only applications whose file name contains this"),
    yes: bool = typer.Option(False, "--yes", help="Skip the confirmation"),
) -> None:
    """⚠️ Paid: run the prompt over the collected emails and score it against the snapshot."""
    from jobtracker.adapters.anthropic_llm import AnthropicLLM
    from jobtracker.evals import details_eval

    settings = _settings()
    cases = details_eval.metas(directory, only)
    ready = [c for c in cases if (directory / f"{c[0]}.expected.json").is_file()]
    if not ready:
        raise typer.BadParameter(f"nothing to run in {directory}: collect, review, snapshot first")
    typer.echo(
        f"{len(ready)} application(s) -> {len(ready)} paid call(s) to {settings.llm_model} "
        f"(effort {settings.llm_paste_effort})"
    )
    if not yes:
        typer.confirm("Run them?", abort=True)
    llm = AnthropicLLM(settings.anthropic_api_key, settings.llm_model, settings.llm_paste_effort)
    now = datetime.now(UTC)
    runs = [
        details_eval.run_case(directory, name, meta, llm, settings.tz, now) for name, meta in cases
    ]
    report = details_eval.save_report(directory, runs, settings.llm_model, now)
    previous = details_eval.previous_report(directory, report)
    typer.echo("\n".join(details_eval.render(runs, previous)))
    u = llm.usage
    typer.echo(f"{u.calls} call(s) · {u.input_tokens} in / {u.output_tokens} out tokens · {report}")


def _calendar(settings: Settings, repo: PostgresRepo):
    from jobtracker.adapters.google_calendar import PROVIDER, make_source

    return make_source(
        settings.google_service_account_key, settings.google_calendar_id, repo.get_oauth(PROVIDER)
    )


def _sync_calendar(settings: Settings, repo: PostgresRepo, source) -> None:
    clock = SystemClock()
    since = services.calendar_since(repo, clock, settings.tz)
    report = services.sync_calendar(repo, clock, source, since, settings.my_addresses)
    typer.echo(json.dumps({"calendar": asdict(report)}, indent=2))


def _sync_calendar_if_connected(settings: Settings, repo: PostgresRepo) -> None:
    from jobtracker.core.ports import CalendarAuthError

    if (source := _calendar(settings, repo)) is None:
        return
    try:
        _sync_calendar(settings, repo, source)
    except CalendarAuthError as err:
        typer.echo(f"calendar skipped: {err}", err=True)


@calendar_app.command("login")
def calendar_login(
    client_file: Path | None = typer.Option(
        None, help="OAuth client JSON from Google Cloud (default: client_secret*.json in the repo)"
    ),
) -> None:
    """Connect Google Calendar: opens the browser for a read-only consent, stores the login locally."""
    from jobtracker.adapters.google_calendar import PROVIDER, find_client_file, login

    settings = _settings()
    path = client_file or find_client_file()
    if path is None or not path.is_file():
        raise typer.BadParameter("no client_secret*.json found; pass --client-file")
    creds = login(path)
    repo = _repo(settings)
    repo.set_oauth(PROVIDER, creds)
    typer.echo("Google Calendar connected (read-only). Run `jobtracker calendar sync` next.")


@calendar_app.command("use-service-account")
def calendar_use_service_account(
    key_file: Path = typer.Argument(..., help="The service account's JSON key from Google Cloud"),
    calendar_id: str | None = typer.Option(
        None, help="Calendar ID (Calendar settings → Integrate calendar). Default: GMAIL_ADDRESS"
    ),
) -> None:
    """Read the calendar as a service account it's shared with: no consent screen, no expiry.

    Checks the access (reads the calendar's name only, no events), then writes the key and the
    calendar ID into `.env`. Run it on the host, not in a container."""
    from jobtracker.adapters.google_calendar import (
        GoogleCalendarSource,
        decode_service_account_key,
        encode_service_account_key,
    )
    from jobtracker.core.ports import CalendarAuthError
    from jobtracker.settings import find_dotenv, set_dotenv_values

    settings = _settings()
    env_file = find_dotenv()
    if env_file is None:
        raise typer.BadParameter("no .env found here or one folder up; run it from backend/")
    try:
        info = decode_service_account_key(key_file.read_text())
    except (OSError, ValueError) as err:
        raise typer.BadParameter(str(err)) from err
    target = calendar_id or (
        settings.google_calendar_id
        if settings.google_calendar_id != "primary"
        else settings.gmail_address
    )
    if not target:
        raise typer.BadParameter("pass --calendar-id (your Gmail address for the main calendar)")
    try:
        name = GoogleCalendarSource.from_service_account(info, target).calendar_name()
    except CalendarAuthError as err:
        typer.echo(f"Not saved: {err}", err=True)
        raise typer.Exit(1) from err

    set_dotenv_values(
        env_file,
        {
            "GOOGLE_SERVICE_ACCOUNT_KEY": encode_service_account_key(info),
            "GOOGLE_CALENDAR_ID": target,
        },
    )
    repo = _repo(settings)
    moved = 0
    if settings.google_calendar_id != target:
        # Same calendar, new ID: keep its interviews (and their notes) instead of adding copies.
        moved = repo.rename_calendar(settings.google_calendar_id, target)
    typer.echo(
        f"Reading {name!r} as {info['client_email']}. Saved to {env_file} (owner-only).\n"
        + (f"{moved} synced interview(s) moved to {target}.\n" if moved else "")
        + "Next:\n"
        f"  1. Delete the key file: rm {key_file}\n"
        "  2. Reload the API: docker compose up -d --force-recreate api\n"
        "  3. uv run jobtracker calendar sync\n"
        "  4. Once it works: uv run jobtracker calendar logout"
    )


@calendar_app.command("logout")
def calendar_logout() -> None:
    """Forget the stored Google login (revoke it too at myaccount.google.com/permissions)."""
    from jobtracker.adapters.google_calendar import PROVIDER

    settings = _settings()
    _repo(settings).delete_oauth(PROVIDER)
    typer.echo("Google login removed from the local database.")
    if settings.google_service_account_key:
        typer.echo(
            "The service account still reads the calendar. To stop that, unshare the calendar "
            "or delete GOOGLE_SERVICE_ACCOUNT_KEY from .env."
        )


@calendar_app.command("sync")
def calendar_sync(
    full: bool = typer.Option(False, help="Forget the sync token and re-read the whole window."),
) -> None:
    """Pull calendar changes and match them to applications (free: no LLM calls)."""
    settings = _settings()
    repo = _repo(settings)
    source = _calendar(settings, repo)
    if source is None:
        raise typer.BadParameter(
            "not connected: run `jobtracker calendar use-service-account KEY_FILE` first"
        )
    if full:
        repo.set_calendar_sync(source.calendar_id, None)
    _sync_calendar(settings, repo, source)


@calendar_app.command("list")
def calendar_list() -> None:
    """Interviews the app knows about, oldest first."""
    settings = _settings()
    repo = _repo(settings)
    names = {a.id: a.company_name for a in repo.list_applications()}
    for iv in repo.list_interviews():
        if iv.dismissed:
            continue
        who = names.get(iv.application_id, "UNMATCHED") if iv.application_id else "UNMATCHED"
        when = iv.starts_at.astimezone(settings.tz)
        typer.echo(
            f"{when:%Y-%m-%d %H:%M}  {iv.status.value:<9} {iv.source.value:<8} {who:<24} "
            f"{iv.title or ''}"
        )


@aws_app.command("push-secrets")
def aws_push_secrets(
    profile: str = PROFILE_OPT,
    prefix: str = typer.Option("/jobtracker/prod/", help="SSM parameter name prefix."),
    region: str = typer.Option("us-east-1"),
    only: list[str] = typer.Option([], "--only", help="Push only these names."),
    yes: bool = typer.Option(False, "--yes", "-y", help="Don't ask for confirmation."),
) -> None:
    """Write the secrets from your local .env into SSM SecureStrings (aws/ssm key). The values
    never go through Terraform, a command line or the Lambda configuration."""
    import os

    import boto3

    from jobtracker.adapters import ssm_secrets

    load_dotenv()
    names = list(only) or list(ssm_secrets.SECRET_NAMES)
    unknown = set(names) - set(ssm_secrets.SECRET_NAMES)
    if unknown:
        raise typer.BadParameter(f"not a secret this app reads: {sorted(unknown)}")
    values = {n: os.environ.get(n, "").strip() for n in names}
    if "GMAIL_APP_PASSWORD" in values:
        values["GMAIL_APP_PASSWORD"] = values["GMAIL_APP_PASSWORD"].replace(" ", "")
    empty = [n for n, v in values.items() if not v]
    if empty:
        raise typer.BadParameter(f"empty in .env: {', '.join(empty)}")
    if not yes:
        typer.confirm(
            f"Write {', '.join(prefix + n for n in values)} (profile {profile}, {region})?",
            abort=True,
        )
    client = boto3.Session(profile_name=profile, region_name=region).client("ssm")
    for name in ssm_secrets.push(client, prefix, values):
        typer.echo(f"wrote {name}")


@discover_app.command("seed")
def discover_seed() -> None:
    """Write the default criteria, rules and searches (keeps what already exists)."""
    from jobtracker.core import discovery

    repo = _repo(_settings())
    added = discovery.seed(repo, SystemClock())
    typer.echo(f"added: {added}")


@discover_app.command("searches")
def discover_searches() -> None:
    """List the saved searches."""
    for x in _repo(_settings()).list_searches():
        flag = " " if x.enabled else "x"
        typer.echo(f"[{flag}] {x.id}  {x.source:<10} {x.label}  {json.dumps(x.params)}")


@discover_app.command("run")
def discover_run(
    source: str | None = typer.Option(None, help="Only this source: jsearch or remoteyeah."),
    no_llm: bool = typer.Option(False, "--no-llm", help="Collect and store, score later."),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Print what would be stored. Stores nothing, no LLM calls."
    ),
    rescore: bool = typer.Option(False, help="Score the recent new postings again."),
) -> None:
    """Collect every enabled search (JSearch requests count against the month's quota), store
    the new postings, then score the ones that pass the rules (paid Haiku calls)."""
    from jobtracker.adapters.anthropic_llm import AnthropicLLM
    from jobtracker.adapters.jsearch import JSearchSource
    from jobtracker.adapters.remoteyeah import RemoteYeahSource
    from jobtracker.core import discovery

    settings = _settings()
    clock = SystemClock()
    sources: dict = {"remoteyeah": RemoteYeahSource()}
    if settings.jsearch_api_key:
        sources["jsearch"] = JSearchSource(settings.jsearch_api_key, clock=clock)
    llm = None
    if not (no_llm or dry_run):
        if not settings.anthropic_api_key:
            raise typer.BadParameter("ANTHROPIC_API_KEY is empty (or pass --no-llm)")
        llm = AnthropicLLM(settings.anthropic_api_key, settings.llm_model, settings.llm_effort)
    repo = _repo(settings)
    if not repo.list_searches():
        raise typer.BadParameter("no saved searches yet: run `jobtracker discover seed` first")
    result = discovery.run_discovery(
        repo, sources, llm, clock, trigger="cli", only_source=source, dry_run=dry_run,
        rescore=rescore,
    )  # fmt: skip
    r = result.run
    if dry_run:
        for p in result.new:
            mark = f"hidden: {p.drop_reason}" if p.drop_reason else "→ LLM"
            typer.echo(f"{mark:<22} {p.source:<10} {p.company} / {p.title} ({p.location or '?'})")
    typer.echo(
        f"fetched {r.fetched}, new {r.new}, hidden {r.dropped}, LLM calls {r.llm_calls}, "
        f"errors {r.errors}, JSearch requests {r.jsearch_requests}"
    )
    for note in r.notes:
        typer.echo(f"  note: {note}")
    if llm is not None:
        u = llm.usage
        typer.echo(f"LLM tokens: {u.input_tokens} in, {u.output_tokens} out")
