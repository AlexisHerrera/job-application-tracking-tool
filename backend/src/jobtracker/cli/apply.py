"""`jobtracker apply …`: collect the questions application forms ask (the Apply pages)."""

from __future__ import annotations

import time

import typer
from dotenv import load_dotenv

from jobtracker.adapters.ats_forms import SUPPORTED, AtsForms, form_target
from jobtracker.adapters.db.connect import ADMIN, DsqlTarget, connect_dsql
from jobtracker.adapters.db.repo import PostgresRepo
from jobtracker.core import apply
from jobtracker.core.clock import SystemClock
from jobtracker.core.models import PostingQuery, PostingStatus
from jobtracker.core.ports import SourceError
from jobtracker.settings import Settings

apply_app = typer.Typer(no_args_is_help=True, help="Questions from application forms.")


def _open(dsql: str | None, profile: str) -> PostgresRepo:
    if dsql:
        return PostgresRepo(connect_dsql(DsqlTarget(dsql, ADMIN, profile=profile or None)))
    load_dotenv()
    return PostgresRepo.open(Settings.from_env())


def _candidates(repo: PostgresRepo, top: int) -> list[tuple[str, apply.FormSource, tuple]]:
    """(origin, where, (ats, slug, job id)) for: your applications with a link, the postings you
    marked applied, and the `top` best-scored matches you haven't acted on."""
    out, seen = [], set()

    def add(origin: str, url: str | None, company: str, title: str, src="", src_id="") -> None:
        target = form_target(url, src, src_id)
        if not target[0] or target in seen:
            return
        seen.add(target)
        where = apply.FormSource(url=url or "", company=company, role_title=title, ats=target[0])
        out.append((origin, where, target))

    for a in repo.list_applications():
        add("applied", a.job_url, a.company_name, a.role_title)
    applied, _ = repo.search_postings(
        PostingQuery(statuses=(PostingStatus.APPLIED.value,), limit=500)
    )
    for p in applied:
        add("applied", p.url, p.company, p.title, p.source, p.source_id)
    if top:
        query = PostingQuery(verdicts=("match",), statuses=("new", "interested"), limit=500)
        matches, _ = repo.search_postings(query)
        picked = 0
        for p in matches:
            if picked >= top:
                break
            if p.source in SUPPORTED and p.application_id is None:
                before = len(out)
                add("top", p.url, p.company, p.title, p.source, p.source_id)
                picked += len(out) > before
    return out


@apply_app.command("collect-questions")
def collect_questions(
    top: int = typer.Option(20, "--top", help="Also read this many best-scored matches."),
    url: str = typer.Option(None, "--url", help="Read only this posting's form."),
    company: str = typer.Option("", "--company", help="With --url: the company's name."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Fetch and show; write nothing."),
    dsql: str = typer.Option(None, "--dsql", help="Aurora DSQL endpoint (prod), as admin."),
    profile: str = typer.Option("jobtracker", "--profile", help="AWS profile for --dsql."),
) -> None:
    """Read the application forms of your applications and top matches (public ATS endpoints:
    no login, nothing submitted, no paid calls) and keep the questions you answer in your own
    words. Questions you already have only get one more place they were seen."""
    repo = _open(dsql, profile)
    clock = SystemClock()
    forms_api = AtsForms()
    if url:
        target = form_target(url)
        if not target[0]:
            raise typer.BadParameter(f"not a Greenhouse, Ashby, Lever or Workable posting: {url}")
        todo = [("url", apply.FormSource(url=url, company=company, ats=target[0]), target)]
    else:
        todo = _candidates(repo, top)
    forms, closed = [], []
    for origin, where, (ats, slug, job_id) in todo:
        try:
            fields = forms_api.fetch_form(ats, slug, job_id)
        except SourceError as err:
            typer.echo(f"  {origin:8} {ats:10} {where.company} | {where.role_title}: {err}")
            if err.gone:
                closed.append(where.url)
            continue
        kept = [f for f in fields if apply.is_open_question(f)]
        typer.echo(f"  {origin:8} {ats:10} {len(kept):2} open of {len(fields):2}  {where.company} | {where.role_title}")  # fmt: skip
        for f in kept if dry_run else []:
            typer.echo(f"      [{apply.classify(f.label)}] {f.label[:110]}")
        forms.append((where, fields))
        time.sleep(0.3)
    if dry_run:
        typer.echo(f"read {len(forms)} forms, {len(closed)} closed (dry run: nothing saved)")
        return
    result = apply.collect(repo, clock, forms)
    typer.echo(
        f"read {result.forms} forms, {len(closed)} closed: {result.new_questions} new questions,"
        f" {result.new_sources} new places seen"
    )
