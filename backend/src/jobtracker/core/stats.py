"""Stats over applications + events. Pure functions; data volume is hundreds of rows."""

from __future__ import annotations

import statistics
import uuid
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from datetime import datetime
from itertools import pairwise

from jobtracker.core.models import GHOSTED, Application, Event, EventKind, Stage
from jobtracker.core.stages import (
    NON_RESPONSE_EVENTS,
    PROGRESS_ORDER,
    display_status,
    is_active,
    is_ghosted,
    is_stale,
    stage_of,
)

FUNNEL = [Stage.APPLIED, Stage.SCREENING, Stage.INTERVIEWING, Stage.OFFER]


def _by_app(events: Iterable[Event]) -> dict[uuid.UUID, list[Event]]:
    out: dict[uuid.UUID, list[Event]] = defaultdict(list)
    for e in events:
        if e.application_id and not e.dismissed:
            out[e.application_id].append(e)
    for evs in out.values():
        evs.sort(key=lambda e: e.occurred_at)
    return out


def first_response_at(app: Application, events: list[Event]) -> datetime | None:
    for e in events:
        if e.kind == EventKind.EMAIL and e.event_type not in NON_RESPONSE_EVENTS:
            return e.occurred_at
    return None


def responded(app: Application, events: list[Event]) -> bool:
    return (
        first_response_at(app, events) is not None
        or PROGRESS_ORDER.get(app.max_stage_reached, 0) > 0
        or app.current_stage == Stage.REJECTED
    )


def funnel(apps: list[Application]) -> list[dict]:
    total = len(apps)
    rows = []
    for stage in FUNNEL:
        n = sum(1 for a in apps if PROGRESS_ORDER[a.max_stage_reached] >= PROGRESS_ORDER[stage])
        rows.append(
            {"stage": stage.value, "count": n, "pct": round(100 * n / total, 1) if total else 0}
        )
    return rows


def _rate_by(
    apps: list[Application],
    by_app: dict[uuid.UUID, list[Event]],
    key: Callable[[Application], list[str]],
) -> list[dict]:
    groups: dict[str, list[Application]] = defaultdict(list)
    for a in apps:
        for k in key(a) or ["(unknown)"]:
            groups[k].append(a)
    rows = []
    for k, group in groups.items():
        r = sum(1 for a in group if responded(a, by_app.get(a.id, [])))
        interviews = sum(1 for a in group if PROGRESS_ORDER[a.max_stage_reached] >= 2)
        rows.append(
            {
                "key": k,
                "applications": len(group),
                "responded": r,
                "response_rate": round(100 * r / len(group), 1),
                "interview_rate": round(100 * interviews / len(group), 1),
            }
        )
    return sorted(rows, key=lambda r: (-r["applications"], r["key"]))


def rejection_stages(apps: list[Application]) -> list[dict]:
    """Where rejections happen: the furthest stage reached before the 'no'."""
    c = Counter(a.max_stage_reached.value for a in apps if a.current_stage == Stage.REJECTED)
    total = sum(c.values())
    return [
        {
            "stage": s.value,
            "count": c.get(s.value, 0),
            "pct": round(100 * c.get(s.value, 0) / total, 1) if total else 0,
        }
        for s in FUNNEL
    ]


def time_to_first_response(apps: list[Application], by_app: dict[uuid.UUID, list[Event]]) -> dict:
    days = []
    for a in apps:
        first = first_response_at(a, by_app.get(a.id, []))
        if first and a.applied_at and first >= a.applied_at:
            days.append((first - a.applied_at).total_seconds() / 86400)
    if not days:
        return {"count": 0, "median_days": None, "mean_days": None}
    return {
        "count": len(days),
        "median_days": round(statistics.median(days), 1),
        "mean_days": round(statistics.fmean(days), 1),
    }


def awaiting_reply(event: Event, app: Application | None, latest: datetime | None) -> bool:
    """A reply request still open: not answered, and the process hasn't moved past it.

    Closed or on-hold processes need nothing from you, and any later event on the same
    application (a scheduled interview, a rejection, a manual change) means it was handled.
    """
    if not event.needs_reply or event.replied_at is not None or event.dismissed:
        return False
    if app is None:
        return True  # unassigned: still worth a look
    if not is_active(app) or app.current_stage == Stage.ON_HOLD:
        return False
    return latest is None or latest <= event.occurred_at


def follow_ups(
    apps: list[Application],
    events: list[Event],
    now: datetime,
    followup_days: int,
    ghost_days: int,
) -> dict:
    names = {a.id: a for a in apps}
    latest: dict[uuid.UUID, datetime] = {}
    for e in events:
        if e.application_id and not e.dismissed:
            latest[e.application_id] = max(
                latest.get(e.application_id, e.occurred_at), e.occurred_at
            )
    replies = [
        {
            "event_id": str(e.id),
            "application_id": str(e.application_id) if e.application_id else None,
            "company": names[e.application_id].company_name if e.application_id in names else None,
            "subject": e.subject,
            "received_at": e.occurred_at.isoformat(),
        }
        for e in events
        if (e.application_id is None or e.application_id in names)
        and awaiting_reply(e, names.get(e.application_id), latest.get(e.application_id))
    ]
    stale = [
        {
            "application_id": str(a.id),
            "company": a.company_name,
            "role": a.role_title,
            "last_event_at": (a.last_event_at or a.applied_at).isoformat()
            if (a.last_event_at or a.applied_at)
            else None,
        }
        for a in apps
        if is_stale(a, now, followup_days, ghost_days)
    ]
    return {"needs_reply": sorted(replies, key=lambda r: r["received_at"]), "no_news": stale}


FLOW_LABELS = {
    "applied": "Applied",
    "screening": "Screening",
    "interviewing": "Interviews",
    "offer": "Offer",
    "rejected": "Rejected",
    "withdrawn": "Withdrawn",
    GHOSTED: "Ghosted",
    "on_hold": "On hold",
    "waiting": "No reply yet",
    "in_progress": "In progress",
}


def flow(
    apps: list[Application], by_app: dict[uuid.UUID, list[Event]], now: datetime, ghost_days: int
) -> dict:
    """Sankey of the search: each application walks the progress stages it actually reached
    (from its events, so a skipped screening isn't invented), then ends where it stands now."""
    links: Counter[tuple[str, str]] = Counter()
    nodes: Counter[str] = Counter()
    for a in apps:
        reached = {Stage.APPLIED, a.max_stage_reached}
        reached |= {s for e in by_app.get(a.id, []) if (s := stage_of(e)) in PROGRESS_ORDER}
        path = [s.value for s in FUNNEL if s in reached]
        status = display_status(a, now, ghost_days)
        if status in PROGRESS_ORDER.keys() - {Stage.OFFER}:
            status = "waiting" if path[-1] == Stage.APPLIED else "in_progress"
        if status != path[-1]:
            path.append(status)
        for node in path:
            nodes[node] += 1
        for src, dst in pairwise(path):
            links[(src, dst)] += 1
    return {
        "nodes": [{"id": n, "label": FLOW_LABELS.get(n, n), "count": c} for n, c in nodes.items()],
        "links": [{"source": s, "target": t, "value": v} for (s, t), v in links.items()],
    }


def upcoming_interviews(apps: list[Application], now: datetime) -> list[dict]:
    rows = [
        {
            "application_id": str(a.id),
            "company": a.company_name,
            "role": a.role_title,
            "round": a.current_round,
            "at": a.next_interview_at.isoformat(),
        }
        for a in apps
        if a.next_interview_at and a.next_interview_at >= now
    ]
    return sorted(rows, key=lambda r: r["at"])


def summary(
    apps: list[Application],
    events: list[Event],
    now: datetime,
    ghost_days: int,
    followup_days: int,
) -> dict:
    by_app = _by_app(events)
    status = Counter(display_status(a, now, ghost_days) for a in apps)
    return {
        "total": len(apps),
        "by_status": dict(status),
        "ghosted": sum(1 for a in apps if is_ghosted(a, now, ghost_days)),
        "needs_review": sum(1 for a in apps if a.needs_review),
        "funnel": funnel(apps),
        "response_by_source": _rate_by(
            apps,
            by_app,
            lambda a: (
                [a.source_ats or a.source_channel or ""]
                if (a.source_ats or a.source_channel)
                else []
            ),
        ),
        "response_by_channel": _rate_by(
            apps, by_app, lambda a: [a.source_channel] if a.source_channel else []
        ),
        "response_by_seniority": _rate_by(
            apps, by_app, lambda a: [a.seniority] if a.seniority else []
        ),
        "response_by_stack": _rate_by(apps, by_app, lambda a: [s.lower() for s in a.stack]),
        "rejection_stages": rejection_stages(apps),
        "time_to_first_response": time_to_first_response(apps, by_app),
        "upcoming_interviews": upcoming_interviews(apps, now),
        "follow_ups": follow_ups(apps, events, now, followup_days, ghost_days),
        "flow": flow(apps, by_app, now, ghost_days),
    }
