from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from jobtracker.core import insights
from jobtracker.core.models import (
    Application,
    Event,
    EventKind,
    EventType,
    Interview,
    InterviewNote,
    InterviewSource,
    Stage,
)

NOW = datetime(2026, 10, 21, 15, tzinfo=UTC)  # a Wednesday
TZ = ZoneInfo("America/Buenos_Aires")


def app(stage, max_stage, applied_days_ago, quiet_days=1):
    return Application(
        company_id=None, role_title="SWE", applied_at=NOW - timedelta(days=applied_days_ago),
        last_event_at=NOW - timedelta(days=quiet_days), current_stage=stage,
        max_stage_reached=max_stage,
    )  # fmt: skip


def ev(a, etype, days_ago):
    return Event(
        kind=EventKind.EMAIL, event_type=etype, occurred_at=NOW - timedelta(days=days_ago),
        application_id=a.id,
    )  # fmt: skip


def iv(a, days_ago, **kw):
    return Interview(
        starts_at=NOW - timedelta(days=days_ago), source=InterviewSource.CALENDAR,
        application_id=a.id, **kw,
    )  # fmt: skip


def fixture():
    silent = app(Stage.APPLIED, Stage.APPLIED, 3)
    early_no = app(Stage.REJECTED, Stage.APPLIED, 20)
    # Two rounds, then rejected 10 days after applying.
    two_rounds = app(Stage.REJECTED, Stage.INTERVIEWING, 16)
    # One round done, the next one tomorrow.
    going = app(Stage.INTERVIEWING, Stage.INTERVIEWING, 9)
    events = [
        ev(early_no, EventType.REJECTION, 18),
        ev(two_rounds, EventType.INTERVIEW_INVITE, 14),
        ev(two_rounds, EventType.REJECTION, 6),
        ev(going, EventType.INTERVIEW_INVITE, 8),
    ]
    first = iv(two_rounds, 12, title="Intro call with the recruiter")
    ivs = [
        first,
        iv(two_rounds, 8, interview_type="technical"),
        iv(going, 5),
        iv(going, -1),
    ]
    notes = [InterviewNote(application_id=two_rounds.id, interview_id=first.id, self_rating=4)]
    return [silent, early_no, two_rounds, going], events, ivs, notes


def test_interview_types_say_what_came_of_each_interview():
    apps, _, ivs, notes = fixture()
    rows = {r["type"]: r for r in insights.summary(apps, ivs, notes, NOW, 14)["interview_types"]}
    assert list(rows) == ["recruiter", "technical", "not_set"]  # not set always last
    recruiter = rows["recruiter"]  # guessed from "Intro call with the recruiter"
    assert (recruiter["done"], recruiter["advanced"], recruiter["rating_advanced"]) == (1, 1, 4)
    assert recruiter["interviews"][0]["guessed"] == "recruiter"
    assert recruiter["interviews"][0]["interview_type"] is None
    assert rows["technical"]["rejected"] == 1
    # `going` had one interview and the next is tomorrow: it went on; tomorrow's isn't counted.
    assert (rows["not_set"]["done"], rows["not_set"]["advanced"]) == (1, 1)


def test_activity_lays_out_each_process():
    apps, events, ivs, _ = fixture()
    a = insights.activity(apps, events, ivs, NOW, 14, None, TZ)
    p = next(p for p in a["processes"] if p["application_id"] == str(apps[2].id))
    assert p["days"] == 10 and p["quiet_days"] is None
    assert [i["outcome"] for i in p["interviews"]] == ["advanced", "rejected"]
    kinds = [i["kind"] for i in a["items"] if i.get("application_id") == str(apps[3].id)]
    assert sorted(kinds) == ["applied", "interview", "interview", "reply"]
