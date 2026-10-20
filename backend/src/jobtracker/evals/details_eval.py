"""Details eval: does the prompt fill an application's fields from its emails the way you would?

Everything lives in the gitignored eval/details/ folder, one set of files per application:

    <name>.txt            its emails, as the prompt sees them              (`collect`, reads Gmail)
    <name>.meta.json      which application and emails they are            (`collect`)
    <name>.expected.json  the fields as you reviewed them in the app       (`snapshot`, reads the DB)
    <name>.actual.json    what the prompt produced on the last run         (`run`, paid)
    reports/<time>.json   per-field counts of each run, to compare prompt changes

Ground truth is what you saved after reviewing "Fill from its emails". A filled field that you
know from somewhere else (a call, the posting page) doesn't belong in expected: delete it there,
or the run counts it as a miss.
"""

from __future__ import annotations

import json
import re
import unicodedata
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from jobtracker.core import details, paste
from jobtracker.core.models import Application
from jobtracker.core.ports import LLMClient, MailSource, Repository
from jobtracker.evals.paste_eval import _short, check_field, expected_value, record_json

# Fields the eval scores and how `snapshot` writes them. Stages, dates and notes are left out:
# stages are tracked by hand, applied_at comes from the emails already, notes are free-form.
EXACT = ["seniority", "source_channel", "salary_min", "salary_max", "salary_currency", "job_url"]
SIMILAR = {"role_title": 90, "location": 85, "benefits": 70, "job_description": 90}
STACK_OVERLAP = 0.8
FIELDS = ["role_title", *EXACT[:2], "stack", "location", *EXACT[2:5], "benefits", "job_url",
          "job_description"]  # fmt: skip

OUTCOMES = ["correct", "wrong", "missed", "empty_ok"]


def _slug(text: str, limit: int) -> str:
    ascii_ = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-")[:limit].rstrip("-")


def case_name(app: Application) -> str:
    return f"{_slug(app.company_name, 30)}-{_slug(app.role_title, 40)}-{str(app.id)[:8]}"


# ---------------------------------------------------------------- collect


def collect(repo: Repository, source: MailSource, out: Path, tz: ZoneInfo) -> list[str]:
    """Write every application's emails to out/. Returns a line per application."""
    out.mkdir(parents=True, exist_ok=True)
    lines = []
    for app in sorted(repo.list_applications(), key=lambda a: a.company_name.lower()):
        ids = details.message_ids(repo.list_events(app.id))
        if not ids:
            continue
        emails = list(source.fetch_by_message_ids(ids))
        name = case_name(app)
        if emails:
            (out / f"{name}.txt").write_text(details.emails_text(emails, tz))
        meta = {
            "application_id": str(app.id),
            "company": app.company_name,
            "role_title": app.role_title,
            "message_ids": ids,
            "emails_read": len(emails),
        }
        (out / f"{name}.meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
        missing = len(ids) - len(emails)
        lines.append(
            f"{name}: {len(emails)} email(s)"
            + (f", {missing} no longer in Gmail" if missing else "")
        )
    return lines


def metas(directory: Path, only: str | None = None) -> list[tuple[str, dict]]:
    return [
        (p.name.removesuffix(".meta.json"), json.loads(p.read_text()))
        for p in sorted(directory.glob("*.meta.json"))
        if only is None or only in p.name
    ]


# ---------------------------------------------------------------- snapshot


def expectation(app: Application) -> dict[str, Any]:
    fields: dict[str, Any] = {name: getattr(app, name) for name in EXACT}
    for name, min_score in SIMILAR.items():
        value = getattr(app, name)
        fields[name] = {"similar": value, "min": min_score} if value else None
    fields["stack"] = (
        {"items": sorted(s.lower() for s in app.stack), "min": STACK_OVERLAP} if app.stack else None
    )
    return {"application_id": str(app.id), "fields": {k: fields[k] for k in FIELDS}}


def snapshot(repo: Repository, directory: Path, force: bool = False) -> list[str]:
    lines = []
    for name, meta in metas(directory):
        path = directory / f"{name}.expected.json"
        if path.exists() and not force:
            lines.append(f"{name}: kept the existing expectation (use --force to replace it)")
            continue
        app = repo.get_application(uuid.UUID(meta["application_id"]))
        if app is None:
            lines.append(f"{name}: application deleted, skipped")
            continue
        exp = expectation(app)
        path.write_text(json.dumps(exp, indent=2, ensure_ascii=False))
        filled = sum(v is not None for v in exp["fields"].values())
        lines.append(f"{name}: {filled}/{len(FIELDS)} fields filled")
    return lines


# ---------------------------------------------------------------- run


def outcome(expected: Any, actual: Any) -> tuple[str, list[str]]:
    want, got = expected_value(expected), actual
    want_empty, got_empty = want in (None, "", []), got in (None, "", [])
    if want_empty and got_empty:
        return "empty_ok", []
    if want_empty:
        return "wrong", ["should be empty"]
    if got_empty:
        return "missed", []
    problems = check_field(expected, actual)
    return ("wrong", problems) if problems else ("correct", [])


@dataclass
class FieldOutcome:
    field: str
    outcome: str
    actual: Any
    expected: Any
    problems: list[str]


@dataclass
class CaseRun:
    name: str
    fields: list[FieldOutcome] = field(default_factory=list)
    error: str | None = None


def run_case(directory: Path, name: str, meta: dict, llm: LLMClient, tz: ZoneInfo,
             now: datetime) -> CaseRun:  # fmt: skip
    text_path = directory / f"{name}.txt"
    if not text_path.is_file():
        return CaseRun(name, error="no emails collected")
    exp_path = directory / f"{name}.expected.json"
    if not exp_path.is_file():
        return CaseRun(name, error="no expectation yet: review it in the app, then run snapshot")
    # The target comes from meta, not the DB, so a run doesn't depend on later edits.
    target = Application(
        company_id=uuid.UUID(int=0),
        id=uuid.UUID(meta["application_id"]),
        company_name=meta["company"],
        role_title=meta["role_title"],
    )
    system, user = details.details_prompt(text_path.read_text(), now, tz, target)
    raw = llm.complete_json(
        system=system, user=user, schema=paste.PASTE_SCHEMA, max_tokens=paste.MAX_OUTPUT_TOKENS
    )
    rec = details.proposal(raw, tz, target)
    actual = record_json(rec) if rec else {}
    (directory / f"{name}.actual.json").write_text(json.dumps(actual, indent=2, ensure_ascii=False))
    expected = json.loads(exp_path.read_text())["fields"]
    result = CaseRun(name)
    for fname, exp in expected.items():
        got = actual.get(fname)
        kind, problems = outcome(exp, got)
        result.fields.append(FieldOutcome(fname, kind, got, expected_value(exp), problems))
    return result


def tally(runs: list[CaseRun]) -> dict[str, dict[str, int]]:
    counts: dict[str, Counter] = {}
    for r in runs:
        for f in r.fields:
            counts.setdefault(f.field, Counter())[f.outcome] += 1
    return {k: {o: c[o] for o in OUTCOMES} for k, c in counts.items()}


def save_report(directory: Path, runs: list[CaseRun], model: str, now: datetime) -> Path:
    reports = directory / "reports"
    reports.mkdir(exist_ok=True)
    path = reports / f"{now:%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps({"model": model, "at": now.isoformat(), "fields": tally(runs)},
                               indent=2))  # fmt: skip
    return path


def previous_report(directory: Path, current: Path) -> dict | None:
    older = sorted(p for p in (directory / "reports").glob("*.json") if p.name < current.name)
    return json.loads(older[-1].read_text())["fields"] if older else None


def render(runs: list[CaseRun], previous: dict | None = None) -> list[str]:
    lines = []
    for r in runs:
        if r.error:
            lines.append(f"-- {r.name}: {r.error}")
            continue
        bad = [f for f in r.fields if f.outcome in ("wrong", "missed")]
        lines.append(f"{'ok' if not bad else 'XX'} {r.name}")
        for f in bad:
            why = f"  ({'; '.join(f.problems)})" if f.problems else ""
            lines.append(f"     {f.outcome:6} {f.field}: got {_short(f.actual, 90)}{why}")
            if f.outcome == "missed" or f.problems:
                lines.append(f"            want {_short(f.expected, 90)}")
    totals = tally(runs)
    if not totals:
        return lines
    lines.append("")
    lines.append(f"{'field':16} {'correct':>8} {'wrong':>6} {'missed':>7} {'empty ok':>9}")
    for fname in FIELDS:
        if fname not in totals:
            continue
        c = totals[fname]
        delta = ""
        if previous and fname in previous:
            changes = [
                f"{o} {c[o] - previous[fname][o]:+d}"
                for o in ("wrong", "missed")
                if c[o] != previous[fname][o]
            ]
            delta = f"   vs last: {', '.join(changes)}" if changes else ""
        lines.append(
            f"{fname:16} {c['correct']:>8} {c['wrong']:>6} {c['missed']:>7} {c['empty_ok']:>9}{delta}"
        )
    wrong = sum(c["wrong"] for c in totals.values())
    missed = sum(c["missed"] for c in totals.values())
    lines.append(f"\nwrong fills: {wrong} · misses: {missed}")
    return lines
