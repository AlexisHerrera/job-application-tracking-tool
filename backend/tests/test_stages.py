from datetime import UTC, datetime, timedelta

from jobtracker.core.models import GHOSTED, Application, Event, EventKind, EventType, Stage
from jobtracker.core.stages import display_status, is_stale, project

NOW = datetime(2026, 10, 12, tzinfo=UTC)


def _app(**kw):
    return Application(company_id=None, role_title="SWE", applied_at=NOW - timedelta(days=30), **kw)


def _ev(days_ago, etype, kind=EventKind.EMAIL, **kw):
    return Event(kind=kind, event_type=etype, occurred_at=NOW - timedelta(days=days_ago), **kw)


def test_forward_only_and_round_counting():
    events = [
        _ev(20, EventType.SCREENING_INVITE),
        _ev(10, EventType.INTERVIEW_SCHEDULED, interview_at=NOW - timedelta(days=8)),
        _ev(5, EventType.INTERVIEW_SCHEDULED, interview_at=NOW + timedelta(days=2)),
        _ev(4, EventType.APPLICATION_RECEIVED),  # late auto-reply never moves backwards
    ]
    p = project(_app(), events, NOW)
    assert p.current_stage == Stage.INTERVIEWING
    assert p.current_round == 2
    assert p.next_interview_at == NOW + timedelta(days=2)
    assert p.max_stage_reached == Stage.INTERVIEWING


def test_rejection_is_terminal_and_keeps_max_stage():
    events = [
        _ev(10, EventType.INTERVIEW_INVITE, round=1),
        _ev(3, EventType.REJECTION),
        _ev(1, EventType.INFO_REQUEST),
    ]
    p = project(_app(), events, NOW)
    assert p.current_stage == Stage.REJECTED
    assert p.outcome == Stage.REJECTED
    assert p.max_stage_reached == Stage.INTERVIEWING


def test_automatic_events_dont_reopen_but_manual_does():
    events = [_ev(5, EventType.REJECTION), _ev(3, EventType.INTERVIEW_INVITE)]
    assert project(_app(), events, NOW).current_stage == Stage.REJECTED
    manual = _ev(
        1, EventType.MANUAL_STAGE_CHANGE, kind=EventKind.MANUAL, stage_implied=Stage.INTERVIEWING
    )
    assert project(_app(), [*events, manual], NOW).current_stage == Stage.INTERVIEWING


def test_dismissed_events_are_ignored():
    p = project(_app(), [_ev(2, EventType.OFFER, dismissed=True)], NOW)
    assert p.current_stage == Stage.APPLIED


def test_ghosted_and_stale_are_computed():
    app = _app(last_event_at=NOW - timedelta(days=15))
    assert display_status(app, NOW, 14) == GHOSTED
    app.last_event_at = NOW - timedelta(days=8)
    assert display_status(app, NOW, 14) == "applied"
    assert is_stale(app, NOW, 7, 14)
    app.current_stage = Stage.REJECTED
    assert display_status(app, NOW, 14) == "rejected"
    assert not is_stale(app, NOW, 7, 14)


def _manual(days_ago, stage):
    return _ev(days_ago, EventType.MANUAL_STAGE_CHANGE, kind=EventKind.MANUAL, stage_implied=stage)


def test_on_hold_pauses_timers_and_keeps_max_stage():
    events = [_ev(40, EventType.INTERVIEW_INVITE), _manual(35, Stage.ON_HOLD)]
    p = project(_app(), events, NOW)
    assert p.current_stage == Stage.ON_HOLD and p.max_stage_reached == Stage.INTERVIEWING
    app = _app(current_stage=Stage.ON_HOLD, last_event_at=NOW - timedelta(days=35))
    assert display_status(app, NOW, 14) == "on_hold"  # not ghosted
    assert not is_stale(app, NOW, 7, 14)


def test_on_hold_resumes_on_progress_but_not_on_noise():
    base = [_ev(40, EventType.INTERVIEW_INVITE), _manual(35, Stage.ON_HOLD)]
    assert (
        project(_app(), [*base, _ev(30, EventType.INFO_REQUEST)], NOW).current_stage
        == Stage.ON_HOLD
    )
    assert (
        project(_app(), [*base, _ev(30, EventType.APPLICATION_RECEIVED)], NOW).current_stage
        == Stage.ON_HOLD
    )
    assert (
        project(_app(), [*base, _ev(30, EventType.SCREENING_INVITE)], NOW).current_stage
        == Stage.ON_HOLD
    )
    assert (
        project(_app(), [*base, _ev(30, EventType.INTERVIEW_SCHEDULED)], NOW).current_stage
        == Stage.INTERVIEWING
    )
    assert (
        project(_app(), [*base, _ev(30, EventType.REJECTION)], NOW).current_stage == Stage.REJECTED
    )
    assert (
        project(_app(), [*base, _manual(30, Stage.SCREENING)], NOW).current_stage == Stage.SCREENING
    )
