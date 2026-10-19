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
