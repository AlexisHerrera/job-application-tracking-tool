"""Stage machine. An application's stage is a projection of its events; history is never edited."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta

from jobtracker.core.models import GHOSTED, Application, Event, EventKind, EventType, Stage

PROGRESS_ORDER = {
    Stage.APPLIED: 0,
    Stage.SCREENING: 1,
    Stage.INTERVIEWING: 2,
    Stage.OFFER: 3,
}
TERMINAL = {Stage.OFFER, Stage.REJECTED, Stage.WITHDRAWN}

EVENT_STAGE: dict[EventType, Stage | None] = {
    EventType.APPLICATION_RECEIVED: Stage.APPLIED,
    EventType.RECRUITER_OUTREACH: Stage.SCREENING,
    EventType.SCREENING_INVITE: Stage.SCREENING,
    EventType.INTERVIEW_INVITE: Stage.INTERVIEWING,
    EventType.INTERVIEW_SCHEDULED: Stage.INTERVIEWING,
    EventType.INTERVIEW_RESCHEDULED: Stage.INTERVIEWING,
    EventType.ASSESSMENT: Stage.INTERVIEWING,
    EventType.OFFER: Stage.OFFER,
    EventType.REJECTION: Stage.REJECTED,
    EventType.WITHDRAWAL: Stage.WITHDRAWN,
    EventType.INFO_REQUEST: None,
    EventType.OTHER: None,
    EventType.MANUAL_STAGE_CHANGE: None,  # uses event.stage_implied
}
INTERVIEW_EVENTS = {
    EventType.INTERVIEW_INVITE,
    EventType.INTERVIEW_SCHEDULED,
    EventType.INTERVIEW_RESCHEDULED,
}
# Auto-replies don't count as "the company responded".
NON_RESPONSE_EVENTS = {EventType.APPLICATION_RECEIVED, EventType.MANUAL_STAGE_CHANGE}


def stage_of(event: Event) -> Stage | None:
    if event.event_type == EventType.MANUAL_STAGE_CHANGE:
        return event.stage_implied
    return EVENT_STAGE.get(event.event_type) or event.stage_implied


@dataclass(slots=True)
class Projection:
    current_stage: Stage
    current_round: int | None
    max_stage_reached: Stage
    outcome: Stage | None
    last_event_at: datetime | None
    next_interview_at: datetime | None


def project(app: Application, events: Iterable[Event], now: datetime) -> Projection:
    """Replay events in time order.

    Rules: automatic events only move forward; a terminal stage sticks unless a later terminal
    event or a manual change overrides it. Manual changes can set any stage. On hold remembers
    where the process was and resumes when an email moves it to that stage or beyond.
    """
    ordered = sorted((e for e in events if not e.dismissed), key=lambda e: e.occurred_at)
    stage = Stage.APPLIED
    max_stage = Stage.APPLIED
    rounds: set[datetime] = set()
    explicit_round: int | None = None
    last_at = app.applied_at
    resume = Stage.APPLIED  # where an on-hold process stands

    for ev in ordered:
        last_at = ev.occurred_at if last_at is None else max(last_at, ev.occurred_at)
        new = stage_of(ev)
        if ev.event_type in INTERVIEW_EVENTS:
            if ev.interview_at:
                rounds.add(ev.interview_at)
            if ev.round:
                explicit_round = max(explicit_round or 0, ev.round)
        if new is None:
            continue
        manual = ev.kind == EventKind.MANUAL
        if new == Stage.ON_HOLD:
            if stage not in TERMINAL and stage != Stage.ON_HOLD:
                resume = stage
            if manual or stage not in TERMINAL:
                stage = Stage.ON_HOLD
        elif manual or new in TERMINAL:
            stage = new
            if ev.round and manual:
                explicit_round = ev.round
        elif stage == Stage.ON_HOLD:
            # News that moves the process along means it's no longer paused.
            if (
                ev.event_type != EventType.APPLICATION_RECEIVED
                and PROGRESS_ORDER[new] >= PROGRESS_ORDER[resume]
            ):
                stage = new
        elif stage not in TERMINAL and PROGRESS_ORDER[new] > PROGRESS_ORDER[stage]:
            stage = new
        if stage in PROGRESS_ORDER and PROGRESS_ORDER[stage] > PROGRESS_ORDER[max_stage]:
            max_stage = stage

    round_ = explicit_round or (len(rounds) or None)
    upcoming = [
        e.interview_at
        for e in ordered
        if e.interview_at and e.interview_at >= now and e.event_type != EventType.REJECTION
    ]
    return Projection(
        current_stage=stage,
        current_round=round_,
        max_stage_reached=max_stage,
        outcome=stage if stage in TERMINAL else None,
        last_event_at=last_at,
        next_interview_at=min(upcoming) if upcoming else None,
    )


def apply_projection(app: Application, p: Projection) -> Application:
    app.current_stage = p.current_stage
    app.current_round = p.current_round
    app.max_stage_reached = p.max_stage_reached
    app.outcome = p.outcome
    app.last_event_at = p.last_event_at
    app.next_interview_at = p.next_interview_at
    return app


def is_active(app: Application) -> bool:
    return app.current_stage not in TERMINAL


def is_ghosted(app: Application, now: datetime, ghost_days: int) -> bool:
    if not is_active(app) or app.current_stage == Stage.ON_HOLD:
        return False
    if app.next_interview_at and app.next_interview_at >= now:
        return False
    ref = app.last_event_at or app.applied_at or app.created_at
    return ref is not None and now - ref >= timedelta(days=ghost_days)


def display_status(app: Application, now: datetime, ghost_days: int) -> str:
    return GHOSTED if is_ghosted(app, now, ghost_days) else app.current_stage.value


def is_stale(app: Application, now: datetime, followup_days: int, ghost_days: int) -> bool:
    """Active, quiet for FOLLOWUP_DAYS, not yet ghosted: worth a nudge."""
    if not is_active(app) or app.current_stage == Stage.ON_HOLD or is_ghosted(app, now, ghost_days):
        return False
    if app.next_interview_at and app.next_interview_at >= now:
        return False
    ref = app.last_event_at or app.applied_at or app.created_at
    return ref is not None and now - ref >= timedelta(days=followup_days)
