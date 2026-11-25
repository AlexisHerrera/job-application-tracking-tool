"""The Insights page (Discover → Insights): what the sources brought each day and how much of it
the rules hid, what was reviewed each day, and why postings were discarded, each reason with the
change it points to (discard_hints). Pure functions over repo.insight_postings, which reads only
the fields used here. Days are calendar days in the app's timezone."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from jobtracker.core import discard_hints
from jobtracker.core.criteria import Profile
from jobtracker.core.discard_hints import SOURCE_REASONS, Context
from jobtracker.core.discovery import DISCARD_REASONS, Rules
from jobtracker.core.models import JobPosting, PostingStatus

WINDOW_DEFAULT = 30
REVIEW_KINDS = {
    PostingStatus.INTERESTED: "saved",
    PostingStatus.APPLIED: "applied",
    PostingStatus.DISMISSED: "discarded",
}
KEPT = (PostingStatus.INTERESTED, PostingStatus.APPLIED)
SPLITS = ("source", "publisher", "seniority", "company")
SPLIT_TOP = 5
NOTES_TOP = 5
NOTE_CHARS = 200
# One more split for the reasons where a field says the most.
DETAIL = {
    "too_senior": "years", "too_junior": "years", "stack": "technologies", "location": "location",
    "language": "location", "work_mode": "work_mode", "salary": "salary",
    "contract": "employment_type", "intermediary": "employer_kind",
}  # fmt: skip


def window(today: date, days: int) -> list[date]:
    """The last `days` calendar days, today last."""
    return [today - timedelta(days=days - 1 - i) for i in range(days)]


def _day(dt: datetime | None, tz: ZoneInfo) -> date | None:
    return dt.astimezone(tz).date() if dt else None


def hide_group(drop_reason: str) -> str:
    """ "title: java" → "title"; the other hide reasons stand as they are."""
    return "title" if drop_reason.startswith("title: ") else drop_reason


def new_postings(rows: list[JobPosting], days: list[date], tz: ZoneInfo) -> dict:
    """Postings stored each day, per source: how many reached the queue (nothing hid them) and
    how many the rules (or the dedupe, or the AI's consultancy check) hid, as they stand now."""
    index = {d: i for i, d in enumerate(days)}

    def empty() -> list[dict]:
        return [{"queue": 0, "hidden": 0} for _ in days]

    totals, per_source = empty(), {}
    hidden_by: Counter[str] = Counter()
    for p in rows:
        i = index.get(_day(p.fetched_at, tz))
        if i is None:
            continue
        kind = "hidden" if p.drop_reason else "queue"
        totals[i][kind] += 1
        per_source.setdefault(p.source, empty())[i][kind] += 1
        if p.drop_reason:
            hidden_by[hide_group(p.drop_reason)] += 1

    def sums(per_day: list[dict]) -> dict:
        return {k: sum(d[k] for d in per_day) for k in ("queue", "hidden")}

    sources = [{"source": s, **sums(v), "days": v} for s, v in per_source.items()]
    sources.sort(key=lambda r: (-(r["queue"] + r["hidden"]), r["source"]))
    total = sums(totals)
    return {
        "total": total["queue"] + total["hidden"],
        **total,
        "days": totals,
        "sources": sources,
        "hidden_by": sorted(hidden_by.items(), key=lambda kv: (-kv[1], kv[0])),
    }


def reviewed_in(rows: list[JobPosting], days: list[date], tz: ZoneInfo) -> list[JobPosting]:
    """What left the review queue in the window (saved, applied or discarded)."""
    first, last = days[0], days[-1]
    return [
        p
        for p in rows
        if p.status in REVIEW_KINDS and (d := _day(p.reviewed_at, tz)) and first <= d <= last
    ]


def reviews(reviewed: list[JobPosting], days: list[date], tz: ZoneInfo) -> dict:
    """Postings reviewed each day, by what they are now (a posting saved and applied to later
    counts as applied, on the day it was first saved)."""
    index = {d: i for i, d in enumerate(days)}
    per_day = [dict.fromkeys(REVIEW_KINDS.values(), 0) for _ in days]
    for p in reviewed:
        per_day[index[_day(p.reviewed_at, tz)]][REVIEW_KINDS[p.status]] += 1
    totals = {k: sum(d[k] for d in per_day) for k in REVIEW_KINDS.values()}
    return {"total": len(reviewed), **totals, "days": per_day}


def _tally(values) -> list[list]:
    counts = Counter(v for v in values if v not in (None, ""))
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], str(kv[0]).lower()))
    return [[v, n] for v, n in ranked[:SPLIT_TOP]]


def _split(group: list[JobPosting], key: str) -> list[list]:
    if key != "company":
        return _tally(getattr(p, key) for p in group)
    names: dict[str, str] = {}  # one name per company, however each source spells it
    for p in group:
        names.setdefault(p.company_normalized, p.company)
    return _tally(names[p.company_normalized] for p in group)


def _detail(reason: str, group: list[JobPosting], profile: Profile) -> dict | None:
    kind = DETAIL.get(reason)
    if kind is None:
        return None
    if kind == "years":
        values = sorted(_tally(p.years_required for p in group), key=lambda v: v[0])
    elif kind == "technologies":  # what's outside the stack: the stack is in most postings
        mine = [t for p in group for t in p.technologies if not discard_hints.mentions(profile.stack, t)]  # fmt: skip
        values = _tally(mine)
    elif kind == "salary":  # 10k bands: 40 is USD 40–50k a year
        values = _tally(p.salary_usd_max // 10_000 * 10 for p in group if p.salary_usd_max)
        values.sort(key=lambda v: v[0])
    else:
        values = _tally(getattr(p, kind) for p in group)
    return {"kind": kind, "values": values} if values else None


def _notes(group: list[JobPosting]) -> list[dict]:
    noted = sorted((p for p in group if p.discard_note), key=lambda p: p.reviewed_at, reverse=True)
    return [
        {"note": p.discard_note[:NOTE_CHARS], "title": p.title, "company": p.company}
        for p in noted[:NOTES_TOP]
    ]


def source_quality(reviewed: list[JobPosting]) -> list[dict]:
    """Per source: what was reviewed from it, how much was kept (saved or applied to), and how
    much was discarded for the posting itself (closed, fake, no way to apply, a duplicate)."""
    rows: dict[str, dict] = {}
    for p in reviewed:
        row = rows.setdefault(
            p.source,
            {"source": p.source, "reviewed": 0, "kept": 0, "discarded": 0}
            | dict.fromkeys(SOURCE_REASONS, 0),
        )
        row["reviewed"] += 1
        row["kept"] += p.status in KEPT
        row["discarded"] += p.status == PostingStatus.DISMISSED
        if p.status == PostingStatus.DISMISSED and p.discard_reason in SOURCE_REASONS:
            row[p.discard_reason] += 1
    return sorted(rows.values(), key=lambda r: (-r["reviewed"], r["source"]))


def discards(reviewed: list[JobPosting], ctx: Context) -> dict:
    """Each discard reason used in the window, most used first: how many, split by source,
    publisher, seniority and company, what the AI had said of them, the notes left, and the
    change they point to."""
    dismissed = [p for p in reviewed if p.status == PostingStatus.DISMISSED]
    groups: dict[str, list[JobPosting]] = {}
    for p in dismissed:
        if p.discard_reason:
            groups.setdefault(p.discard_reason, []).append(p)
    order = {r: i for i, r in enumerate(DISCARD_REASONS)}
    rows = []
    for reason, group in sorted(groups.items(), key=lambda kv: (-len(kv[1]), order.get(kv[0], 99))):  # fmt: skip
        verdicts = Counter(p.ai_verdict or "unscored" for p in group)
        about = "source" if reason in SOURCE_REASONS else "criteria"
        if reason == "already_applied":
            about = "application"
        rows.append(
            {
                "reason": reason,
                "count": len(group),
                "about": about,
                "splits": {k: _split(group, k) for k in SPLITS},
                "detail": _detail(reason, group, ctx.profile),
                "verdicts": {v: verdicts[v] for v in ("match", "maybe", "no", "unscored")},
                "hints": discard_hints.hints_for(reason, group, ctx),
                "notes": _notes(group),
            }
        )
    return {
        "total": len(dismissed),
        "without_reason": sum(1 for p in dismissed if not p.discard_reason),
        "reasons": rows,
        "sources": source_quality(reviewed),
    }


def summary(
    rows: list[JobPosting],
    *,
    today: date,
    days: int,
    tz: ZoneInfo,
    profile: Profile,
    rules: Rules,
    waiting: int,
) -> dict:
    """GET /discover/insights. `rows` is repo.insight_postings since the window's first day;
    `waiting` is the review queue now (visible postings still new)."""
    span = window(today, days)
    reviewed = reviewed_in(rows, span, tz)
    ctx = Context(
        kept=[p for p in rows if p.status in KEPT], reviewed=reviewed, profile=profile, rules=rules
    )
    return {
        "days": [d.isoformat() for d in span],
        "postings": new_postings(rows, span, tz),
        "reviews": {**reviews(reviewed, span, tz), "waiting": waiting},
        "discards": discards(reviewed, ctx),
    }
