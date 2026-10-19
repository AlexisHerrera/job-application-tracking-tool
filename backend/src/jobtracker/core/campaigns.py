"""Campaigns: date ranges that group applications by their applied date."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from jobtracker.core.models import Application, Campaign, Event, EventKind, EventType
from jobtracker.core.ports import Clock, Repository
from jobtracker.core.stages import INTERVIEW_EVENTS, NON_RESPONSE_EVENTS


class CampaignError(ValueError):
    pass


def local_date(dt: datetime | None, tz: ZoneInfo) -> date | None:
    return dt.astimezone(tz).date() if dt else None


def contains(c: Campaign, d: date | None) -> bool:
    return d is not None and c.started_on <= d and (c.ended_on is None or d <= c.ended_on)


def campaign_for(campaigns: list[Campaign], applied: date | None) -> Campaign | None:
    hits = [c for c in campaigns if contains(c, applied)]
    return max(hits, key=lambda c: c.started_on) if hits else None


def current(campaigns: list[Campaign], today: date) -> Campaign | None:
    open_ = [
        c
        for c in campaigns
        if c.started_on <= today and (c.ended_on is None or today <= c.ended_on)
    ]
    return max(open_, key=lambda c: c.started_on) if open_ else None


def apps_in(c: Campaign, apps: list[Application], tz: ZoneInfo) -> list[Application]:
    return [a for a in apps if contains(c, local_date(a.applied_at or a.created_at, tz))]


def _validate(c: Campaign, others: list[Campaign]) -> None:
    if not c.name.strip():
        raise CampaignError("campaign name is required")
    if c.ended_on and c.ended_on < c.started_on:
        raise CampaignError("a campaign can't end before it starts")
    far = date.max
    for o in others:
        if o.id == c.id:
            continue
        if c.started_on <= (o.ended_on or far) and o.started_on <= (c.ended_on or far):
            raise CampaignError(
                f"overlaps with '{o.name}' ({o.started_on} to {o.ended_on or 'ongoing'}); end that one first"
            )


def save(repo: Repository, clock: Clock, c: Campaign, *, close_previous: bool = False) -> Campaign:
    """Create or update. With close_previous, an ongoing earlier campaign ends the day before."""
    others = repo.list_campaigns()
    if close_previous:
        for o in others:
            if o.id != c.id and o.ended_on is None and o.started_on < c.started_on:
                o.ended_on = c.started_on - timedelta(days=1)
                repo.save_campaign(o)
    _validate(c, repo.list_campaigns())
    c.created_at = c.created_at or clock.now()
    repo.save_campaign(c)
    return c


def summary(
    c: Campaign, apps: list[Application], events: list[Event], today: date, tz: ZoneInfo
) -> dict:
    mine = apps_in(c, apps, tz)
    ids = {a.id for a in mine}
    evs = sorted(
        (e for e in events if e.application_id in ids and not e.dismissed),
        key=lambda e: e.occurred_at,
    )
    end = min(c.ended_on, today) if c.ended_on else today
    days = (end - c.started_on).days + 1

    responses = [
        e for e in evs if e.kind == EventKind.EMAIL and e.event_type not in NON_RESPONSE_EVENTS
    ]
    interviews = [
        local_date(e.interview_at or e.occurred_at, tz)
        for e in evs
        if e.event_type in INTERVIEW_EVENTS or e.event_type == EventType.ASSESSMENT
    ]
    interviews = sorted(d for d in interviews if d)
    first_response = local_date(responses[0].occurred_at, tz) if responses else None
    first_interview = interviews[0] if interviews else None
    return {
        "id": str(c.id),
        "name": c.name,
        "started_on": c.started_on.isoformat(),
        "ended_on": c.ended_on.isoformat() if c.ended_on else None,
        "ongoing": c.ended_on is None or c.ended_on >= today,
        "notes": c.notes,
        "day": max(days, 0),
        "applications": len(mine),
        "per_week": round(len(mine) / max(days, 1) * 7, 1),
        "first_response_on": first_response.isoformat() if first_response else None,
        "first_interview_on": first_interview.isoformat() if first_interview else None,
        "days_to_first_interview": (first_interview - c.started_on).days + 1
        if first_interview
        else None,
    }
