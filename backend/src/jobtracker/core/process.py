"""An application's process as a timeline: applied → the steps it went through → where it ended.

Three sources, each of which may be missing:
- the plan: the steps the recruiter described (`ProcessStep`), entered by hand;
- the interviews (calendar, invite emails, by hand). They fill the plan's interview steps in time
  order unless a step is linked by hand; the ones no step takes show up between the steps;
- the outcome: rejected, withdrawn, offer, ghosted, on hold.

With no plan the interviews are the steps; with neither it's "Applied" and, once the process is
closed, where it ended. Built on read, never stored.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from jobtracker.core.models import (
    GHOSTED,
    Application,
    Event,
    Interview,
    InterviewStatus,
    ProcessStep,
    Stage,
    StepKind,
    StepLink,
)
from jobtracker.core.stages import stage_of

CLOSED = {Stage.REJECTED.value, Stage.WITHDRAWN.value, Stage.OFFER.value, GHOSTED}
OUTCOME_LABEL = {
    Stage.REJECTED.value: "Rejected",
    Stage.WITHDRAWN.value: "Withdrawn",
    Stage.OFFER.value: "Offer",
    Stage.ON_HOLD.value: "On hold",
    GHOSTED: "Ghosted",
}

_TAKE_HOME = re.compile(
    r"challenge|take[- ]?home|assignment|exercise|homework|desaf[ií]o|ejercicio|prueba|test\b", re.I
)
# "Challenge defense + interview" is a call, not homework.
_CALL = re.compile(r"defen[cs]e|defensa|review|present|interview|entrevista|call|llamada", re.I)


def guess_kind(name: str) -> StepKind:
    if _TAKE_HOME.search(name) and not _CALL.search(name):
        return StepKind.TAKE_HOME
    return StepKind.INTERVIEW


@dataclass(slots=True)
class Node:
    kind: str  # applied | step | interview | outcome
    label: str
    # done | scheduled | next | planned | skipped | not_reached | outcome
    # ("pending" only while building)
    state: str
    at: datetime | None = None
    step_id: uuid.UUID | None = None
    interview_id: uuid.UUID | None = None
    step_kind: StepKind | None = None
    optional: bool = False
    implied: bool = False  # done, with no date: a later step already happened
    outcome: str | None = None  # rejected | withdrawn | offer | ghosted | on_hold


def active_interviews(interviews: Iterable[Interview]) -> list[Interview]:
    return sorted(
        (
            iv
            for iv in interviews
            if iv.status == InterviewStatus.SCHEDULED and not iv.dismissed and not iv.general
        ),
        key=lambda iv: iv.starts_at,
    )


def match_steps(
    steps: list[ProcessStep], interviews: Iterable[Interview]
) -> dict[uuid.UUID, Interview]:
    """The interview each step took, by step id.

    Hand links win. Every other interview step takes the next unused interview in time order,
    later than the step before it and earlier than the next hand-linked one, so fixing one link
    doesn't scramble the rest. Take-homes and steps marked done by hand take none. A hand link to
    an interview that's gone (cancelled, hidden, moved to another application) falls back to
    automatic; a hand link to nothing means "hasn't happened yet".
    """
    ivs = active_interviews(interviews)
    by_id = {iv.id: iv for iv in ivs}
    out: dict[uuid.UUID, Interview] = {}
    for st in steps:
        if st.link == StepLink.MANUAL and st.interview_id in by_id:
            out[st.id] = by_id[st.interview_id]
    used = {iv.id for iv in out.values()}
    floor: datetime | None = None
    for i, st in enumerate(steps):
        if st.id in out:
            floor = out[st.id].starts_at
            continue
        pinned_empty = st.link == StepLink.MANUAL and st.interview_id is None
        if pinned_empty or st.kind != StepKind.INTERVIEW or st.done_at:
            continue
        ceiling = next((out[s.id].starts_at for s in steps[i + 1 :] if s.id in out), None)
        pick = next(
            (
                iv
                for iv in ivs
                if iv.id not in used
                and (floor is None or iv.starts_at > floor)
                and (ceiling is None or iv.starts_at < ceiling)
            ),
            None,
        )
        if pick:
            out[st.id] = pick
            used.add(pick.id)
            floor = pick.starts_at
    return out


def interview_label(iv: Interview) -> str:
    if iv.title:
        return iv.title
    return iv.interview_type.replace("_", " ").capitalize() if iv.interview_type else "Interview"


def _outcome_at(status: str, events: Iterable[Event]) -> datetime | None:
    """When the process got to its current stage: the latest event that says so."""
    times = [
        e.occurred_at
        for e in events
        if not e.dismissed and (s := stage_of(e)) is not None and s.value == status
    ]
    return max(times, default=None)


def timeline(
    app: Application,
    status: str,
    steps: Iterable[ProcessStep],
    interviews: Iterable[Interview],
    events: Iterable[Event],
    now: datetime,
) -> list[Node]:
    """`status` is the displayed one (ghosted included)."""
    steps = sorted(steps, key=lambda st: st.position)
    interviews = list(interviews)
    events = list(events)
    matched = match_steps(steps, interviews)

    plan: list[Node] = []
    for st in steps:
        iv = matched.get(st.id)
        if iv:
            state, at = ("done" if iv.starts_at <= now else "scheduled"), iv.starts_at
        elif st.done_at:
            state, at = "done", st.done_at
        else:
            state, at = "pending", None
        plan.append(Node(
            "step", st.name, state, at, step_id=st.id, interview_id=iv.id if iv else None,
            step_kind=st.kind, optional=st.optional,
        ))  # fmt: skip

    # A step still pending before one that already happened (or is booked) most likely happened
    # off the calendar (a phone call, the take-home before its defense); an optional one didn't.
    reached = [i for i, n in enumerate(plan) if n.state in ("done", "scheduled")]
    for n in plan[: reached[-1]] if reached else ():
        if n.state == "pending":
            if n.optional:
                n.state = "skipped"
            else:
                n.state, n.implied = "done", True

    seq = [Node("applied", "Applied", "done", app.applied_at or app.created_at)]
    seq += plan
    taken = {iv.id for iv in matched.values()}
    for iv in active_interviews(interviews):
        if iv.id in taken:
            continue
        node = Node(
            "interview", interview_label(iv), "done" if iv.starts_at <= now else "scheduled",
            iv.starts_at, interview_id=iv.id,
        )  # fmt: skip
        # Before the first step that comes later in time, or that hasn't happened yet.
        j = next(
            (
                k
                for k, m in enumerate(seq)
                if k > 0 and ((m.at is not None and m.at > iv.starts_at) or m.state == "pending")
            ),
            len(seq),
        )
        seq.insert(j, node)

    closed = status in CLOSED
    booked = any(n.state == "scheduled" for n in seq)
    pending = [n for n in seq if n.state == "pending"]
    for i, n in enumerate(pending):
        n.state = "not_reached" if closed else ("next" if i == 0 and not booked else "planned")

    if closed or status == Stage.ON_HOLD.value:
        at = None if status == GHOSTED else _outcome_at(status, events) or app.last_event_at
        node = Node("outcome", OUTCOME_LABEL[status], "outcome", at, outcome=status)
        # Where it stopped: before the steps it never got to.
        j = next(
            (k for k, m in enumerate(seq) if m.state in ("next", "planned", "not_reached")),
            len(seq),
        )
        seq.insert(j, node)
    return seq
