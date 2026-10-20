import pytest
from fastapi.testclient import TestClient

from jobtracker.api.app import create_app
from jobtracker.settings import Settings
from tests.fakes import MemoryRepo


@pytest.fixture
def repo():
    return MemoryRepo()


@pytest.fixture
def client(repo):
    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    return TestClient(create_app(settings, repo_factory=lambda: repo))


def test_application_lifecycle(client):
    r = client.post(
        "/api/applications",
        json={"company": "Northwind", "role_title": "Backend", "stack": ["python"]},
    )
    assert r.status_code == 201, r.text
    app = r.json()
    assert app["status"] == "applied"

    r = client.post(
        f"/api/applications/{app['id']}/stage", json={"stage": "interviewing", "round": 1}
    )
    assert r.json()["current_stage"] == "interviewing"

    note = client.post(f"/api/applications/{app['id']}/notes",
                       json={"round": 1, "questions": ["Design a queue"], "self_rating": 4}).json()  # fmt: skip
    detail = client.get(f"/api/applications/{app['id']}").json()
    assert [e["event_type"] for e in detail["events"]] == ["manual_stage_change"]
    assert detail["interview_notes"][0]["id"] == note["id"]

    r = client.patch(f"/api/applications/{app['id']}", json={"seniority": "senior"})
    assert r.json()["seniority"] == "senior"
    assert client.get("/api/applications", params={"q": "north"}).json()[0]["id"] == app["id"]
    assert client.delete(f"/api/applications/{app['id']}").status_code == 204
    assert client.get(f"/api/applications/{app['id']}").status_code == 404


def test_validation_errors(client):
    assert (
        client.post("/api/applications", json={"company": "", "role_title": "x"}).status_code == 422
    )
    r = client.post("/api/applications/import", json={"csv": "foo,bar\n1,2"})
    assert r.status_code == 422 and "company" in r.json()["detail"]
    assert client.get("/api/applications/not-a-uuid").status_code == 404


def test_csv_import_and_dashboard(client):
    r = client.post(
        "/api/applications/import", json={"csv": "company,role,stage\nA,SWE,screening\nB,SRE,"}
    )
    assert r.json()["created"] == 2
    assert client.get("/api/dashboard").json()["unassigned"] == 0
    stats = client.get("/api/stats").json()
    assert stats["total"] == 2


def test_inbox_assign_and_dismiss(client, repo):
    from jobtracker.cli.seed import seed
    from jobtracker.core.clock import SystemClock
    from tests.conftest import TZ

    seed(repo, SystemClock(), TZ)
    [item] = client.get("/api/inbox").json()
    target = client.get("/api/applications", params={"q": "Vandelay"}).json()[0]
    r = client.post(f"/api/events/{item['id']}/assign", json={"application_id": target["id"]})
    assert r.status_code == 200 and r.json()["application_id"] == target["id"]
    assert client.get("/api/inbox").json() == []
    assert client.get(f"/api/applications/{target['id']}").json()["current_stage"] == "interviewing"


def test_mark_reply_done(client, repo):
    from jobtracker.cli.seed import seed
    from jobtracker.core.clock import SystemClock
    from tests.conftest import TZ

    seed(repo, SystemClock(), TZ)
    pending = client.get("/api/dashboard").json()["follow_ups"]["needs_reply"]
    assert pending
    r = client.post(f"/api/events/{pending[0]['event_id']}/replied")
    assert r.status_code == 200 and r.json()["replied_at"]
    after = client.get("/api/dashboard").json()["follow_ups"]["needs_reply"]
    assert pending[0]["event_id"] not in {p["event_id"] for p in after}
    assert client.get("/api/stats").json()["flow"]["links"]


def test_scan_runs_the_incremental_pipeline(repo):
    from jobtracker.core.clock import SystemClock
    from jobtracker.core.pipeline import Pipeline, PipelineConfig
    from jobtracker.core.ports import SyncState
    from tests.conftest import ME, TZ, load
    from tests.fakes import FakeLLM
    from tests.test_pipeline import RECEIVED, FakeSource

    llm = FakeLLM(extract={"Northwind Labs": RECEIVED})
    source = FakeSource([load("ashby_received.eml", uid=11)])
    pipeline = Pipeline(repo, llm, SystemClock(), PipelineConfig(tz=TZ, my_addresses={ME}))
    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    client = TestClient(
        create_app(settings, repo_factory=lambda: repo, scan_factory=lambda _r: (pipeline, source))
    )
    repo.set_sync_state(SyncState("[Gmail]/All Mail", 1, 10))
    r = client.post("/api/scan")
    assert r.status_code == 200, r.text
    assert r.json()["seen"] == 1 and r.json()["created"] == 1
    status = client.get("/api/scan").json()
    assert status["available"] and status["last_scan_at"]


def test_interviews_and_notes_per_interview(repo):
    from datetime import UTC, datetime, timedelta

    from jobtracker.core.models import CalendarItem
    from tests.fakes import FakeCalendar

    soon = datetime.now(UTC) + timedelta(days=2)
    cal = FakeCalendar(
        [
            CalendarItem("ev1", "confirmed", "Technical interview", soon, soon + timedelta(hours=1),
                         attendees=["jane@northwind.test"]),
            CalendarItem("ev2", "confirmed", "Entrevista con Contoso", soon + timedelta(days=1)),
        ]
    )  # fmt: skip
    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    client = TestClient(
        create_app(settings, repo_factory=lambda: repo, calendar_factory=lambda _repo: cal)
    )
    app = client.post(
        "/api/applications",
        json={"company": "Northwind", "role_title": "Backend", "company_domain": "northwind.test"},
    ).json()
    assert client.get("/api/calendar").json()["connected"] is True
    r = client.post("/api/calendar/sync").json()
    assert (r["created"], r["unassigned"]) == (2, 1)

    detail = client.get(f"/api/applications/{app['id']}").json()
    [iv] = detail["interviews"]
    assert iv["interview_type"] == "technical" and iv["source"] == "calendar"
    note = client.post(f"/api/applications/{app['id']}/notes",
                       json={"interview_id": iv["id"], "body": "Asked about queues"}).json()  # fmt: skip
    assert note["interview_id"] == iv["id"]
    [iv] = client.get(f"/api/applications/{app['id']}").json()["interviews"]
    assert iv["notes_count"] == 1

    # An interview from another application can't take this application's note.
    [other] = client.get("/api/interviews/unassigned").json()
    r = client.post(f"/api/applications/{app['id']}/notes", json={"interview_id": other["id"]})
    assert r.status_code == 422

    assert client.post(f"/api/interviews/{other['id']}/assign",
                       json={"application_id": app["id"]}).status_code == 200  # fmt: skip
    manual = client.post(f"/api/applications/{app['id']}/interviews",
                         json={"starts_at": (soon - timedelta(days=5)).isoformat(),
                               "title": "Phone screen"}).json()  # fmt: skip
    assert manual["source"] == "manual"
    patched = client.patch(f"/api/interviews/{manual['id']}", json={"round": 1}).json()
    assert patched["round"] == 1

    dash = client.get("/api/dashboard").json()
    assert [i["title"] for i in dash["upcoming_interviews"]] == [
        "Technical interview",
        "Entrevista con Contoso",
    ]
    assert dash["recent_interviews"][0]["company"] == "Northwind"
    assert client.get("/api/stats").json()["interviews"] == {"done": 1, "upcoming": 2}

    assert client.delete(f"/api/interviews/{manual['id']}").status_code == 204
    assert len(client.get(f"/api/applications/{app['id']}").json()["interviews"]) == 2

    # A general talk: no application, notes inline, listed on the interviews page.
    ivs = client.get("/api/interviews").json()
    contoso = next(i for i in ivs if i["title"] == "Entrevista con Contoso")
    general = client.post(f"/api/interviews/{contoso['id']}/general").json()
    assert general["general"] and general["application_id"] is None
    r = client.patch(f"/api/interviews/{contoso['id']}", json={"notes": "Two roles to pitch"})
    assert r.json()["notes_count"] == 1
    row = next(i for i in client.get("/api/interviews").json() if i["id"] == contoso["id"])
    assert row["notes"] == "Two roles to pitch" and row["company"] is None
    assert client.get("/api/stats").json()["interviews"] == {"done": 0, "upcoming": 1}


def test_calendar_not_connected(client):
    assert client.get("/api/calendar").json()["connected"] is False
    assert client.post("/api/calendar/sync").status_code == 409
