"""Insights for the dashboard and the calendar: how interviews went by type, and every process
laid out in time. Pure functions over applications, events, interviews and notes."""

from __future__ import annotations

import statistics
import uuid
from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime
from zoneinfo import ZoneInfo

from jobtracker.core.interviews import counted, guess_type, listed
from jobtracker.core.models import GHOSTED, Application, Event, Interview, InterviewNote, Stage
from jobtracker.core.stages import TERMINAL, display_status, stage_of
from jobtracker.core.stats import _by_app, first_response_at

CLOSED = {Stage.OFFER.value, Stage.REJECTED.value, Stage.WITHDRAWN.value, GHOSTED}
OUTCOMES = ("advanced", "rejected", "withdrew", "no_answer", "waiting")


def _interviews_by_app(interviews: Iterable[Interview]) -> dict[uuid.UUID, list[Interview]]:
    out: dict[uuid.UUID, list[Interview]] = defaultdict(list)
    for iv in interviews:
        if iv.application_id and counted(iv) and not iv.general:
            out[iv.application_id].append(iv)
    for ivs in out.values():
        ivs.sort(key=lambda iv: iv.starts_at)
    return out


def ended_at(app: Application, events: list[Event]) -> datetime | None:
    """When a closed process got its final answer: the last event that set the closing stage."""
    if app.current_stage not in TERMINAL:
        return None
    hits = [e.occurred_at for e in events if stage_of(e) == app.current_stage]
    return max(hits) if hits else app.last_event_at


def interview_outcomes(
    app: Application, ivs: list[Interview], now: datetime, ghost_days: int
) -> list[tuple[Interview, str]]:
    """Each interview that happened, and what came of it: advanced (another round or an offer
    followed), rejected, withdrew, no_answer (ghosted) or waiting."""
    status = display_status(app, now, ghost_days)
    last = {
        Stage.REJECTED.value: "rejected",
        Stage.WITHDRAWN.value: "withdrew",
        GHOSTED: "no_answer",
        Stage.OFFER.value: "advanced",
    }.get(status, "waiting")
    return [
        (iv, "advanced" if i < len(ivs) - 1 else last)
        for i, iv in enumerate(ivs)
        if iv.starts_at < now
    ]


def _mean(values: list[float]) -> float | None:
    return round(statistics.fmean(values), 1) if values else None


def interview_types(
    apps: list[Application],
    ivs_by_app: dict[uuid.UUID, list[Interview]],
    notes: Iterable[InterviewNote],
    now: datetime,
    ghost_days: int,
) -> list[dict]:
    """How interviews went, by type: the one set by hand, else a guess from the title, else
    "not_set". Each row lists its interviews so the type can be fixed from there, and carries
    the self-rating from notes next to the outcome."""
    rating: dict[uuid.UUID, list[int]] = defaultdict(list)
    for n in notes:
        if n.interview_id and n.self_rating:
            rating[n.interview_id].append(n.self_rating)
    groups: dict[str, list[dict]] = defaultdict(list)
    for a in apps:
        for iv, outcome in interview_outcomes(a, ivs_by_app.get(a.id, []), now, ghost_days):
            guessed = None if iv.interview_type else guess_type(iv.title)
            groups[iv.interview_type or guessed or "not_set"].append(
                {
                    "id": str(iv.id),
                    "company": a.company_name,
                    "role": a.role_title,
                    "at": iv.starts_at.isoformat(),
                    "title": iv.title,
                    "round": iv.round,
                    "interview_type": iv.interview_type,
                    "guessed": guessed,
                    "outcome": outcome,
                    "rating": _mean(rating[iv.id]) if iv.id in rating else None,
                }
            )
    rows = []
    for kind, ivs in groups.items():
        rated = [(i["rating"], i["outcome"]) for i in ivs if i["rating"] is not None]
        rows.append(
            {
                "type": kind,
                "done": len(ivs),
                **{k: sum(1 for i in ivs if i["outcome"] == k) for k in OUTCOMES},
                "rated": len(rated),
                "rating_advanced": _mean([r for r, o in rated if o == "advanced"]),
                "rating_not": _mean([r for r, o in rated if o in ("rejected", "no_answer")]),
                "interviews": sorted(ivs, key=lambda i: i["at"], reverse=True),
            }
        )
    return sorted(rows, key=lambda r: (r["type"] == "not_set", -r["done"], r["type"]))


def summary(
    apps: list[Application],
    interviews: list[Interview],
    notes: list[InterviewNote],
    now: datetime,
    ghost_days: int,
) -> dict:
    ivs = _interviews_by_app(interviews)
    return {"interview_types": interview_types(apps, ivs, notes, now, ghost_days)}


def _iv_json(iv: Interview, now: datetime) -> dict:
    return {
        "id": str(iv.id),
        "at": iv.starts_at.isoformat(),
        "title": iv.title,
        "interview_type": iv.interview_type,
        "round": iv.round,
        "upcoming": iv.starts_at >= now,
    }


def activity(
    apps: list[Application],
    events: list[Event],
    interviews: list[Interview],
    now: datetime,
    ghost_days: int,
    talks_from: date | None,
    tz: ZoneInfo,
) -> dict:
    """What happened when, for the calendar: dated items (applied, first reply, interviews,
    final answers, general talks) and each application as a process from applied to its answer."""
    by_app = _by_app(events)
    ivs = _interviews_by_app(interviews)
    items: list[dict] = []
    processes = []
    for a in apps:
        evs = by_app.get(a.id, [])
        base = {"application_id": str(a.id), "company": a.company_name, "role": a.role_title}
        reply = first_response_at(a, evs)
        end = ended_at(a, evs)
        status = display_status(a, now, ghost_days)
        if a.applied_at:
            items.append({**base, "kind": "applied", "at": a.applied_at.isoformat()})
        if reply:
            items.append({**base, "kind": "reply", "at": reply.isoformat()})
        if end:
            items.append({**base, "kind": a.current_stage.value, "at": end.isoformat()})
        outcomes = {iv.id: o for iv, o in interview_outcomes(a, ivs.get(a.id, []), now, ghost_days)}
        for iv in ivs.get(a.id, []):
            items.append(
                {**base, "kind": "interview", **_iv_json(iv, now), "interview_id": str(iv.id)}
            )
        last = a.last_event_at or a.applied_at
        processes.append(
            {
                **base,
                "status": status,
                "applied_at": a.applied_at.isoformat() if a.applied_at else None,
                "reply_at": reply.isoformat() if reply else None,
                "ended_at": end.isoformat() if end else None,
                "last_event_at": last.isoformat() if last else None,
                "days": ((end or now) - a.applied_at).days if a.applied_at else None,
                "quiet_days": (now - last).days if last and status not in CLOSED else None,
                "interviews": [
                    {**_iv_json(iv, now), "outcome": outcomes.get(iv.id)}
                    for iv in ivs.get(a.id, [])
                ],
            }
        )
    for iv in interviews:
        if (
            iv.general
            and listed(iv)
            and (talks_from is None or iv.starts_at.astimezone(tz).date() >= talks_from)
        ):
            items.append(
                {
                    "kind": "talk",
                    **_iv_json(iv, now),
                    "interview_id": str(iv.id),
                    "organizer": iv.organizer,
                    "attendees": iv.attendees,
                }
            )
    items.sort(key=lambda i: i["at"])
    processes.sort(key=lambda p: p["applied_at"] or "")
    return {"items": items, "processes": processes}
