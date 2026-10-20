import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from jobtracker.api.app import create_app
from jobtracker.core.models import (
    Application,
    Event,
    EventKind,
    EventType,
    Interview,
    InterviewSource,
    InterviewStatus,
    ProcessStep,
    Stage,
    StepKind,
    StepLink,
)
from jobtracker.core.process import guess_kind, match_steps, timeline
from jobtracker.settings import Settings
from tests.fakes import MemoryRepo

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
APP_ID = uuid.uuid4()


def _app(**kw) -> Application:
    return Application(
        company_id=uuid.uuid4(), role_title="Backend", applied_at=NOW - timedelta(days=30), **kw
    )


def _iv(days: float, **kw) -> Interview:
    return Interview(
        starts_at=NOW + timedelta(days=days),
        source=InterviewSource.CALENDAR,
        application_id=APP_ID,
        **kw,
    )


def _plan(*names: str, **kw) -> list[ProcessStep]:
    return [
        ProcessStep(application_id=APP_ID, name=n, position=i, kind=guess_kind(n), **kw)
        for i, n in enumerate(names)
    ]


TAPI = (
    "Interviewer",
    "Agency director",
    "HR director",
    "Challenge",
    "Challenge defense + interview",
)


def _states(nodes):
    return [(n.label, n.state) for n in nodes]


def test_guess_kind():
    assert guess_kind("Challenge") == StepKind.TAKE_HOME
    assert guess_kind("Take-home exercise") == StepKind.TAKE_HOME
    assert guess_kind("Challenge defense + interview") == StepKind.INTERVIEW
    assert guess_kind("HR director") == StepKind.INTERVIEW


def test_no_information_is_just_applied():
    nodes = timeline(_app(), "applied", [], [], [], NOW)
    assert _states(nodes) == [("Applied", "done")]


def test_rejected_without_interviews():
    rejected_at = NOW - timedelta(days=3)
    events = [
        Event(
            kind=EventKind.EMAIL,
            event_type=EventType.REJECTION,
            occurred_at=rejected_at,
            application_id=APP_ID,
        )
    ]
    nodes = timeline(_app(), "rejected", [], [], events, NOW)
    assert _states(nodes) == [("Applied", "done"), ("Rejected", "outcome")]
    assert nodes[-1].at == rejected_at


def test_ghosted_has_no_date():
    nodes = timeline(_app(), "ghosted", [], [], [], NOW)
    assert _states(nodes) == [("Applied", "done"), ("Ghosted", "outcome")]
    assert nodes[-1].at is None


def test_interviews_without_a_plan_are_the_steps():
    ivs = [_iv(-5, title="Intro call"), _iv(2, title="Tech")]
    nodes = timeline(_app(), "interviewing", [], ivs, [], NOW)
    assert _states(nodes) == [("Applied", "done"), ("Intro call", "done"), ("Tech", "scheduled")]


def test_tapi_plan_midway():
    """Three rounds on the calendar; the challenge is waiting to be marked done."""
    steps = _plan(*TAPI)
    ivs = [_iv(-10), _iv(-6), _iv(-2)]
    nodes = timeline(_app(), "interviewing", steps, ivs, [], NOW)
    assert _states(nodes) == [
        ("Applied", "done"),
        ("Interviewer", "done"),
        ("Agency director", "done"),
        ("HR director", "done"),
        ("Challenge", "next"),
        ("Challenge defense + interview", "planned"),
    ]
    assert [n.interview_id for n in nodes[1:4]] == [iv.id for iv in ivs]


def test_take_home_never_takes_an_interview_and_is_implied_by_its_defense():
    steps = _plan(*TAPI)
    ivs = [_iv(-20), _iv(-15), _iv(-10), _iv(3, title="Defense")]
    nodes = timeline(_app(), "interviewing", steps, ivs, [], NOW)
    challenge, defense = nodes[4], nodes[5]
    assert (challenge.state, challenge.implied, challenge.interview_id) == ("done", True, None)
    assert (defense.state, defense.interview_id) == ("scheduled", ivs[3].id)


def test_marked_done_by_hand():
    steps = _plan(*TAPI)
    steps[3].done_at = NOW - timedelta(days=1)
    ivs = [_iv(-20), _iv(-15), _iv(-10)]
    nodes = timeline(_app(), "interviewing", steps, ivs, [], NOW)
    assert (nodes[4].state, nodes[4].at, nodes[4].implied) == ("done", steps[3].done_at, False)
    assert nodes[5].state == "next"


def test_rejection_stops_the_plan():
    steps = _plan(*TAPI)
    ivs = [_iv(-20), _iv(-15)]
    events = [
        Event(
            kind=EventKind.MANUAL,
            event_type=EventType.MANUAL_STAGE_CHANGE,
            stage_implied=Stage.REJECTED,
            occurred_at=NOW - timedelta(days=10),
            application_id=APP_ID,
        )
    ]
    nodes = timeline(_app(), "rejected", steps, ivs, events, NOW)
    assert _states(nodes) == [
        ("Applied", "done"),
        ("Interviewer", "done"),
        ("Agency director", "done"),
        ("Rejected", "outcome"),
        ("HR director", "not_reached"),
        ("Challenge", "not_reached"),
        ("Challenge defense + interview", "not_reached"),
    ]


def test_extra_interview_goes_between_steps_by_time():
    steps = _plan("Recruiter", "Tech")
    ivs = [_iv(-10, title="Recruiter call"), _iv(-5, title="Tech"), _iv(-1, title="Coffee chat")]
    # Hand link the tech step to the second one; the third is unplanned.
    steps[1].link, steps[1].interview_id = StepLink.MANUAL, ivs[1].id
    nodes = timeline(_app(), "interviewing", steps, ivs, [], NOW)
    assert _states(nodes) == [
        ("Applied", "done"),
        ("Recruiter", "done"),
        ("Tech", "done"),
        ("Coffee chat", "done"),
    ]
    assert nodes[3].kind == "interview"


def test_hand_link_bounds_the_automatic_ones():
    """An extra call before the hand-linked round can't push the earlier step past it."""
    steps = _plan("Recruiter", "Tech", "Final")
    ivs = [_iv(-10), _iv(-8, title="Unplanned"), _iv(-5), _iv(2)]
    steps[1].link, steps[1].interview_id = StepLink.MANUAL, ivs[2].id
    m = match_steps(steps, ivs)
    assert m[steps[0].id].id == ivs[0].id
    assert m[steps[1].id].id == ivs[2].id
    assert m[steps[2].id].id == ivs[3].id
    nodes = timeline(_app(), "interviewing", steps, ivs, [], NOW)
    assert [n.label for n in nodes] == ["Applied", "Recruiter", "Unplanned", "Tech", "Final"]


def test_pinned_empty_step_waits_and_cancelled_interviews_are_ignored():
    steps = _plan("Recruiter", "Tech")
    steps[1].link = StepLink.MANUAL  # "not happened yet", even though an interview exists
    ivs = [_iv(-10), _iv(-3, title="Wrong one"), _iv(-1, status=InterviewStatus.CANCELLED)]
    nodes = timeline(_app(), "interviewing", steps, ivs, [], NOW)
    assert _states(nodes) == [
        ("Applied", "done"),
        ("Recruiter", "done"),
        ("Wrong one", "done"),
        ("Tech", "next"),
    ]


def test_optional_step_skipped_and_on_hold():
    steps = _plan("Recruiter", "Culture", "Tech")
    steps[1].optional = True
    steps[2].link, steps[2].interview_id = StepLink.MANUAL, None
    ivs = [_iv(-10)]
    steps[2].done_at = NOW - timedelta(days=2)
    nodes = timeline(_app(), "on_hold", steps, ivs, [], NOW)
    assert _states(nodes) == [
        ("Applied", "done"),
        ("Recruiter", "done"),
        ("Culture", "skipped"),
        ("Tech", "done"),
        ("On hold", "outcome"),
    ]


def test_steps_api():
    repo = MemoryRepo()
    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    client = TestClient(create_app(settings, repo_factory=lambda: repo))
    app = client.post("/api/applications", json={"company": "Tapi", "role_title": "SRE"}).json()
    r = client.post(
        f"/api/applications/{app['id']}/steps",
        json={"steps": [{"name": n} for n in TAPI]},
    )
    assert r.status_code == 201, r.text
    steps = r.json()
    assert [s["kind"] for s in steps] == ["interview"] * 3 + ["take_home", "interview"]

    iv = client.post(
        f"/api/applications/{app['id']}/interviews",
        json={"starts_at": (NOW - timedelta(days=1)).isoformat(), "title": "First"},
    ).json()
    detail = client.get(f"/api/applications/{app['id']}").json()
    assert [n["state"] for n in detail["timeline"]] == ["done", "done", "next"] + ["planned"] * 3
    assert detail["timeline"][1]["interview_id"] == iv["id"]

    # Move the challenge first, mark it done, then link round 1 by hand and back to auto.
    r = client.patch(f"/api/steps/{steps[3]['id']}", json={"position": 0})
    assert r.json()["position"] == 0
    names = [s["name"] for s in client.get(f"/api/applications/{app['id']}").json()["steps"]]
    assert names == ["Challenge", *TAPI[:3], TAPI[4]]
    r = client.patch(f"/api/steps/{steps[3]['id']}", json={"done_at": NOW.isoformat()})
    assert r.json()["done_at"]
    r = client.patch(f"/api/steps/{steps[0]['id']}", json={"interview_id": None})
    assert r.json()["link"] == "manual"
    r = client.patch(f"/api/steps/{steps[0]['id']}", json={"link": "auto"})
    assert (r.json()["link"], r.json()["interview_id"]) == ("auto", None)
    other = client.post("/api/applications", json={"company": "X", "role_title": "Y"}).json()
    other_iv = client.post(
        f"/api/applications/{other['id']}/interviews", json={"starts_at": NOW.isoformat()}
    ).json()
    r = client.patch(f"/api/steps/{steps[0]['id']}", json={"interview_id": other_iv["id"]})
    assert r.status_code == 422

    assert client.delete(f"/api/steps/{steps[1]['id']}").status_code == 204
    left = client.get(f"/api/applications/{app['id']}").json()["steps"]
    assert [s["position"] for s in left] == [0, 1, 2, 3]

    # The editor's endpoints.
    note = client.post(
        f"/api/applications/{app['id']}/notes", json={"interview_id": iv["id"], "body": "# Hi"}
    ).json()
    got = client.get(f"/api/interviews/{iv['id']}").json()
    assert (got["company"], got["role"]) == ("Tapi", "SRE")
    assert [n["id"] for n in got["notes_list"]] == [note["id"]]
    assert client.get(f"/api/notes/{note['id']}").json()["company"] == "Tapi"
    assert client.get("/api/interviews/unassigned").status_code == 200

    assert client.delete(f"/api/applications/{app['id']}").status_code == 204
    assert repo.steps == {}


def test_ai_process_fills_an_empty_plan_only(repo, clock):
    from jobtracker.core import paste, services
    from tests.conftest import TZ
    from tests.fakes import paste_record

    raw = paste_record(
        company="Tapi",
        role_title="Senior Fullstack Engineer",
        process_steps=[
            {"name": "Interview with the sender (30 min)", "kind": "interview", "optional": False},
            {"name": "Challenge", "kind": "take_home", "optional": False},
            {"name": "Challenge defense + technical interview", "kind": "", "optional": True},
            {"name": "  ", "kind": "interview", "optional": False},
        ],
    )
    [rec] = paste.parse_records({"applications": [raw]}, TZ)
    assert [s["kind"] for s in rec.values["process_steps"]] == ["interview", "take_home", None]

    app = services.create_application(
        repo, clock, services.ApplicationInput(company="Tapi", role_title="Senior Fullstack")
    )
    [change] = [c for c in paste.diff(app, rec, set()) if c.field == "process_steps"]
    assert change.kind == "fill"
    assert not [c for c in paste.diff(app, rec, set(), has_plan=True) if c.field == "process_steps"]

    services.update_fields(repo, clock, app.id, {"process_steps": change.proposed})
    steps = repo.list_steps(app.id)
    assert [(s.kind, s.optional) for s in steps] == [
        (StepKind.INTERVIEW, False),
        (StepKind.TAKE_HOME, False),
        (StepKind.INTERVIEW, True),  # guessed from the name
    ]
    # A plan that exists is never replaced (links and done marks would be lost).
    services.update_fields(repo, clock, app.id, {"process_steps": [{"name": "Other"}]})
    assert len(repo.list_steps(app.id)) == 3

    created = services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company="Acme", role_title="SRE", process_steps=[{"name": "Recruiter call"}]
        ),
    )
    assert [s.name for s in repo.list_steps(created.id)] == ["Recruiter call"]
