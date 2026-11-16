"""The daily discovery digest: the postings rated match or maybe that you haven't been sent yet,
best score first, plus a line on what the runs did since the last digest. No LLM call: it shows
the verdicts the runs already stored.

Which postings were sent lives in discovery_settings['digest'] (id → fetched_at, kept for WINDOW),
so a posting scored a run late, or re-scored, is sent once. A day with nothing to send sends
nothing. Posting text comes from the web: everything goes into the HTML escaped, and links only
when they're http(s).
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from jobtracker.core.models import DiscoveryRun, JobPosting, PostingStatus
from jobtracker.core.ports import Clock, DiscoveryRepo, Mailer

KEY = "digest"
WINDOW = timedelta(days=7)  # postings fetched longer ago than this aren't sent any more
FIRST_WINDOW = timedelta(days=1)
LIST_LIMIT = 30
RELEVANT = ("match", "maybe")


@dataclass
class Digest:
    subject: str
    text: str
    html: str
    postings: list[JobPosting]
    more: int  # relevant postings left out of the list (LIST_LIMIT)


def _state(repo: DiscoveryRepo) -> tuple[datetime | None, dict[str, str]]:
    raw = repo.get_discovery_setting(KEY)
    raw = raw if isinstance(raw, dict) else {}
    sent = raw.get("sent") if isinstance(raw.get("sent"), dict) else {}
    try:
        sent_at = datetime.fromisoformat(raw["sent_at"]) if raw.get("sent_at") else None
    except (TypeError, ValueError):
        sent_at = None
    return sent_at, sent


def unsent(repo: DiscoveryRepo, now: datetime) -> list[JobPosting]:
    """The first digest looks back one day only: what's older is the backlog on the page."""
    sent_at, sent = _state(repo)
    rows = [
        p
        for p in repo.list_postings(now - (WINDOW if sent_at else FIRST_WINDOW))
        if p.status == PostingStatus.NEW
        and p.drop_reason is None
        and p.ai_verdict in RELEVANT
        and str(p.id) not in sent
    ]
    rows.sort(key=lambda p: (p.ai_verdict != "match", -(p.ai_score or 0), p.company, p.title))
    return rows


def _salary(p: JobPosting) -> str | None:
    lo, hi = p.salary_usd_min, p.salary_usd_max
    if not (lo or hi):
        return None
    k = [f"{round(v / 1000)}k" for v in (lo, hi) if v]
    return f"USD {'–'.join(dict.fromkeys(k))}/yr"


def _facts(p: JobPosting) -> list[str]:
    known = [
        p.location,
        p.work_mode if p.work_mode not in (None, "unclear") else None,
        (p.seniority or "").replace("_", " ") if p.seniority not in (None, "unclear") else None,
        f"{p.years_required}+ yrs" if p.years_required else None,
        _salary(p),
        p.publisher or p.source,
    ]
    return [x for x in known if x]


def _link(url: str | None) -> str | None:
    return url if url and url.lower().startswith(("https://", "http://")) else None


def _reasons(p: JobPosting) -> list[str]:
    reasons = (p.ai_result or {}).get("reasons")
    return [r for r in reasons if isinstance(r, str)] if isinstance(reasons, list) else []


def _runs_line(runs: list[DiscoveryRun], waiting: int) -> str:
    if not runs:
        line = "No runs since the last digest."
    else:
        n = len(runs)
        line = (
            f"{n} run{'s' if n != 1 else ''}: {sum(r.new for r in runs)} new postings, "
            f"{sum(r.dropped for r in runs)} hidden by the rules, "
            f"{sum(r.llm_calls for r in runs)} scored"
        )
        if errors := sum(r.errors for r in runs):
            line += f", {errors} error{'s' if errors != 1 else ''}"
        line += "."
    if waiting:
        line += f" {waiting} still waiting to be scored."
    return line


def _problems(runs: list[DiscoveryRun]) -> list[str]:
    """The notes of runs that had errors, once each (a source that fails every run)."""
    notes = [n for r in runs if r.errors for n in r.notes if not n.startswith("LLM: ")]
    return list(dict.fromkeys(notes))[:5]


def build(
    postings: list[JobPosting],
    runs: list[DiscoveryRun],
    waiting: int,
    tz: ZoneInfo,
    now: datetime,
    app_url: str,
) -> Digest:
    shown, more = postings[:LIST_LIMIT], max(0, len(postings) - LIST_LIMIT)
    matches = sum(p.ai_verdict == "match" for p in postings)
    maybes = len(postings) - matches
    counts = [f"{matches} match{'es' if matches != 1 else ''}"] if matches else []
    counts += [f"{maybes} maybe{'s' if maybes != 1 else ''}"] if maybes else []
    day = now.astimezone(tz)
    subject = f"Discover: {' and '.join(counts)} ({day:%a} {day.day} {day:%b})"
    stats, problems = _runs_line(runs, waiting), _problems(runs)
    page = f"{app_url}/discover" if app_url else None

    text = [subject, "", stats, *(f"! {x}" for x in problems), ""]
    for p in shown:
        text.append(f"[{p.ai_score} {p.ai_verdict}] {p.title} at {p.company}")
        text.append("  " + " · ".join(_facts(p)))
        text += [f"  - {r}" for r in _reasons(p)]
        if url := _link(p.url):
            text.append(f"  {url}")
        text.append("")
    if more:
        text.append(f"…and {more} more on the Discover page.")
    if page:
        text.append(f"Review them: {page}")

    e = html.escape
    items = []
    for p in shown:
        badge = "#15803d" if p.ai_verdict == "match" else "#a16207"
        url = _link(p.url)
        title = f'<a href="{e(url)}" style="color:#1e1b4b">{e(p.title)}</a>' if url else e(p.title)
        reasons = "".join(f"<li>{e(r)}</li>" for r in _reasons(p))
        items.append(
            '<tr><td style="padding:12px 0;border-top:1px solid #e5e7eb">'
            f'<span style="background:{badge};color:#fff;border-radius:4px;padding:1px 6px;'
            f'font-size:12px">{p.ai_score} {e(p.ai_verdict or "")}</span> '
            f'<strong>{title}</strong> at {e(p.company)}'
            f'<div style="color:#6b7280;font-size:13px;margin-top:2px">'
            f"{e(' · '.join(_facts(p)))}</div>"
            + (f'<ul style="margin:6px 0 0;padding-left:18px;font-size:13px">{reasons}</ul>'
               if reasons else "")
            + "</td></tr>"
        )  # fmt: skip
    footer = f"<p>…and {more} more on the Discover page.</p>" if more else ""
    if page:
        footer += f'<p><a href="{e(page)}" style="color:#4f46e5">Review them on Discover</a></p>'
    warn = "".join(f'<p style="color:#b91c1c;font-size:13px">{e(x)}</p>' for x in problems)
    body = (
        '<div style="font-family:system-ui,sans-serif;max-width:640px;color:#111827">'
        f'<p style="color:#4b5563;font-size:14px">{e(stats)}</p>{warn}'
        f'<table style="border-collapse:collapse;width:100%">{"".join(items)}</table>'
        f"{footer}</div>"
    )
    return Digest(subject, "\n".join(text), body, shown, more)


def send(
    repo: DiscoveryRepo,
    mailer: Mailer | None,
    clock: Clock,
    tz: ZoneInfo,
    app_url: str,
) -> dict:
    """Build and send today's digest (`mailer=None`: build only, a preview that marks nothing as
    sent). Returns what happened, for the logs."""
    now = clock.now()
    sent_at, sent = _state(repo)
    postings = unsent(repo, now)
    since = sent_at or now - timedelta(days=1)
    runs = [r for r in repo.list_runs(100) if r.started_at >= since and r.trigger != "rescore"]
    if not postings:
        return {"sent": False, "postings": 0, "reason": "nothing new to send"}
    digest = build(postings, runs, repo.count_unscored(), tz, now, app_url)
    if mailer is None:
        return {"sent": False, "postings": len(postings), "digest": digest}
    mailer.send(digest.subject, digest.text, digest.html)
    # Everything relevant counts as sent, also what didn't fit in the list: the page has it.
    keep = {k: v for k, v in sent.items() if datetime.fromisoformat(v) >= now - WINDOW}
    keep |= {str(p.id): (p.fetched_at or now).isoformat() for p in postings}
    with repo.transaction():
        repo.set_discovery_setting(KEY, {"sent_at": now.isoformat(), "sent": keep})
    return {"sent": True, "postings": len(postings), "subject": digest.subject}
