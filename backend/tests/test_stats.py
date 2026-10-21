from datetime import timedelta

from jobtracker.cli.seed import seed
from jobtracker.core import stats
from jobtracker.core.clock import FixedClock
from tests.conftest import TZ


def test_stats_on_seed_data(repo, clock):
    seed(repo, clock, TZ)
    s = stats.summary(repo.list_applications(), repo.list_all_events(), clock.now(), 14, 7)
    assert s["total"] == 7
    funnel = {r["stage"]: r["count"] for r in s["funnel"]}
    assert funnel["applied"] == 7 and funnel["interviewing"] >= 3
    rejected = {r["stage"]: r["count"] for r in s["rejection_stages"]}
    assert rejected["applied"] == 1 and rejected["interviewing"] == 1
    assert s["upcoming_interviews"][0]["company"] == "Acme Robotics"
    assert s["follow_ups"]["needs_reply"]
    assert s["time_to_first_response"]["count"] >= 3
    assert s["needs_review"] == 1
    assert "ghosted" in s["by_status"]  # Initech: 40 days of silence


def test_ghosted_clears_when_news_arrives(repo, clock):
    seed(repo, clock, TZ)
    later = FixedClock(clock.now() + timedelta(days=60))
    s = stats.summary(repo.list_applications(), repo.list_all_events(), later.now(), 14, 7)
    assert s["by_status"].get("ghosted", 0) >= 4


def _flow_fixture():
    from datetime import UTC, datetime

    from jobtracker.core.models import Application, Event, EventKind, EventType, Stage

    now = datetime(2026, 10, 12, tzinfo=UTC)

    def app(stage, max_stage, days_quiet=1):
        last = now - timedelta(days=days_quiet)
        return Application(
            company_id=None, role_title="SWE", applied_at=last, last_event_at=last,
            current_stage=stage, max_stage_reached=max_stage,
        )  # fmt: skip

    def ev(a, etype, days_ago, **kw):
        return Event(
            kind=EventKind.EMAIL, event_type=etype, occurred_at=now - timedelta(days=days_ago),
            application_id=a.id, **kw,
        )  # fmt: skip

    return now, app, ev, Stage, EventType


def test_flow_follows_the_stages_each_application_reached():
    now, app, ev, Stage, EventType = _flow_fixture()
    waiting = app(Stage.APPLIED, Stage.APPLIED)
    ghosted = app(Stage.APPLIED, Stage.APPLIED, days_quiet=30)
    rejected_early = app(Stage.REJECTED, Stage.APPLIED)
    # Screening skipped: straight to interviews, then rejected.
    rejected_late = app(Stage.REJECTED, Stage.INTERVIEWING)
    screened = app(Stage.INTERVIEWING, Stage.INTERVIEWING)
    paused = app(Stage.ON_HOLD, Stage.INTERVIEWING)
    events = [
        ev(rejected_late, EventType.INTERVIEW_INVITE, 5),
        ev(screened, EventType.SCREENING_INVITE, 9),
        ev(screened, EventType.INTERVIEW_INVITE, 4),
    ]
    apps = [waiting, ghosted, rejected_early, rejected_late, screened, paused]
    f = stats.flow(apps, stats._by_app(events), now, 14)
    links = {(lk["source"], lk["target"]): lk["value"] for lk in f["links"]}
    assert links == {
        ("applied", "waiting"): 1,
        ("applied", "ghosted"): 1,
        ("applied", "rejected"): 1,
        ("applied", "interviewing"): 2,  # rejected_late + paused (no screening event)
        ("applied", "screening"): 1,
        ("screening", "interviewing"): 1,
        ("interviewing", "rejected"): 1,
        ("interviewing", "in_progress"): 1,
        ("interviewing", "on_hold"): 1,
    }
    counts = {n["id"]: n["count"] for n in f["nodes"]}
    assert counts["applied"] == 6 and counts["interviewing"] == 3 and counts["rejected"] == 2
    assert f["paths"][str(rejected_late.id)] == ["applied", "interviewing", "rejected"]
    assert f["paths"][str(waiting.id)] == ["applied", "waiting"]


def test_reply_requests_close_when_the_process_moves_on():
    now, app, ev, Stage, EventType = _flow_fixture()
    open_ = app(Stage.INTERVIEWING, Stage.INTERVIEWING)
    superseded = app(Stage.INTERVIEWING, Stage.INTERVIEWING)
    rejected = app(Stage.REJECTED, Stage.INTERVIEWING)
    paused = app(Stage.ON_HOLD, Stage.INTERVIEWING)
    events = [
        ask := ev(open_, EventType.INTERVIEW_INVITE, 2, needs_reply=True),
        ev(superseded, EventType.INTERVIEW_INVITE, 5, needs_reply=True),
        ev(superseded, EventType.INTERVIEW_SCHEDULED, 3),
        ev(rejected, EventType.INFO_REQUEST, 6, needs_reply=True),
        ev(paused, EventType.INTERVIEW_INVITE, 6, needs_reply=True),
    ]
    fu = stats.follow_ups([open_, superseded, rejected, paused], events, now, 7, 14)
    assert [r["event_id"] for r in fu["needs_reply"]] == [str(ask.id)]
