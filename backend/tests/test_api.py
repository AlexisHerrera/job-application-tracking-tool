import pytest
from fastapi.testclient import TestClient

from jobtracker.api import schemas as s
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


def test_shell_is_the_sidebar_in_one_request(repo):
    from jobtracker.cli.seed import seed
    from jobtracker.core.clock import SystemClock
    from tests.conftest import TZ

    opened = []

    def one_repo():
        opened.append(repo)
        return repo

    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    client = TestClient(create_app(settings, repo_factory=one_repo))
    seed(repo, SystemClock(), TZ)

    shell = client.get("/api/shell").json()
    assert len(opened) == 1  # one connection for all four parts
    dashboard = client.get("/api/dashboard").json()
    assert shell["inbox"] == {
        "unassigned": dashboard["unassigned"],
        "unassigned_interviews": dashboard["unassigned_interviews"],
    }
    assert shell["inbox"]["unassigned"] == 1
    assert shell["scan"] == client.get("/api/scan").json()
    assert shell["calendar"] == client.get("/api/calendar").json()
    assert shell["discovery"] == client.get("/api/discover/status").json()
    assert shell["discovery"] == {"to_review": 0, "last_run": None}


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

    kinds = [i["kind"] for i in client.get("/api/activity").json()["items"]]
    assert "talk" in kinds and "interview" in kinds
    types = client.get("/api/insights").json()["interview_types"]
    assert sum(r["done"] for r in types) == 0  # like stats: the past one was deleted


def test_calendar_not_connected(client):
    assert client.get("/api/calendar").json()["connected"] is False
    assert client.post("/api/calendar/sync").status_code == 409


def test_discover_page_flow(repo):
    from datetime import UTC, datetime

    from jobtracker.core import discovery
    from tests.fakes import FakeLLM, FakeSource, posting, verdict

    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    now = datetime.now(UTC)
    source = FakeSource([
        posting(source_id="1", company="Northwind Pay", title="Senior Backend Engineer", posted_at=now),
        posting(source_id="2", company="Contoso", title="Full Stack Engineer", posted_at=now),
        posting(source_id="3", company="Toptal", title="Senior React Developer", posted_at=now),
    ])  # fmt: skip
    llm = FakeLLM(discover={"Northwind": verdict(verdict="match", score=88, sector="fintech",
                                                 technologies=["TypeScript", "React"]),
                            "Contoso": verdict(verdict="no", score=20, salary_min=90000,
                                               salary_currency="USD", salary_period="year")})  # fmt: skip
    client = TestClient(
        create_app(settings, repo_factory=lambda: repo,
                   discovery_factory=lambda: ({"workable": source}, llm))
    )  # fmt: skip

    assert client.get("/api/discover/progress").json() == {"running": False}
    state = client.post("/api/discover/seed").json()
    assert state["added"]["searches"] == len(discovery.DEFAULT_SEARCHES)
    assert state["can_run"]
    assert state["companies"]["total"] == 0  # a test app seeds no watchlist
    # only one search on, so the fake source answers once
    for x in state["searches"]:
        assert client.patch(f"/api/discover/searches/{x['id']}", json={"enabled": False}).status_code == 200  # fmt: skip
    mine = client.post("/api/discover/searches", json={"source": "workable", "label": "Workable · fintech", "params": {"query": "fintech"}}).json()  # fmt: skip

    run = client.post("/api/discover/run", json={}).json()
    assert (run["new"], run["dropped"], run["llm_calls"]) == (3, 1, 2)
    progress = client.get("/api/discover/progress").json()
    assert progress["running"] is False and (progress["kind"], progress["phase"]) == ("run", "done")
    assert (progress["searches_done"], progress["new"], progress["scored"]) == (1, 3, 2)

    page = client.get("/api/discover").json()
    assert [p["company"] for p in page["postings"]] == ["Northwind Pay", "Contoso"]  # by score
    searched = next(x for x in client.get("/api/discover/settings").json()["searches"] if x["id"] == mine["id"])  # fmt: skip
    assert (searched["last_status"], searched["last_count"], searched["fail_streak"]) == (
        "ok",
        3,
        0,
    )
    assert searched["last_fetched_at"] and searched["last_found_at"]
    assert page["counts"] == {"total": 3, "hidden": 1, "unscored": 0}
    assert page["postings"][0]["search_label"] == mine["label"]
    hidden = client.get("/api/discover", params={"hidden": True}).json()["postings"]
    assert [(p["company"], p["drop_reason"]) for p in hidden] == [("Toptal", "agency")]
    assert [p["company"] for p in client.get("/api/discover", params={"verdict": "match"}).json()["postings"]] == ["Northwind Pay"]  # fmt: skip

    def companies(**params):
        return [p["company"] for p in client.get("/api/discover", params=params).json()["postings"]]

    assert companies(q="backend") == ["Northwind Pay"]
    assert companies(tech="react,typescript", sector="fintech") == ["Northwind Pay"]
    assert companies(salary_min=80000) == ["Contoso"]
    assert companies(sort="salary") == ["Contoso", "Northwind Pay"]
    assert companies(posted_days=1) == ["Northwind Pay", "Contoso"]
    paged = client.get("/api/discover", params={"limit": 1, "offset": 1}).json()
    assert [p["company"] for p in paged["postings"]] == ["Contoso"] and paged["total"] == 2
    assert page["facets"]["technologies"] == [["React", 1], ["TypeScript", 1]]
    assert page["postings"][1]["salary_usd_max"] == 90000
    assert client.get("/api/discover", params={"sort": "random"}).status_code == 422

    rescored = client.post("/api/discover/rescore", json={"include_hidden": True}).json()
    assert rescored["trigger"] == "rescore" and rescored["llm_calls"] == 3
    assert len(source.calls) == 1

    top = page["postings"][0]
    r = client.post(f"/api/discover/{top['id']}/apply")
    assert r.status_code == 201, r.text
    assert r.json()["application"]["source_channel"] == "discover"
    after = client.get("/api/discover").json()["postings"]
    assert after[0]["status"] == "applied" and after[0]["in_tracker"]
    contoso = after[1]
    assert client.patch(f"/api/discover/{contoso['id']}", json={"status": "dismissed"}).json()["status"] == "dismissed"  # fmt: skip
    url = f"/api/discover/{contoso['id']}"
    r = client.patch(url, json={"status": "dismissed", "discard_reason": "too_senior", "discard_note": " 10+ years "}).json()  # fmt: skip
    assert (r["discard_reason"], r["discard_note"]) == ("too_senior", "10+ years")
    assert r["reviewed_at"] is not None
    listed = client.get("/api/discover", params={"status": "dismissed"}).json()["postings"]
    assert listed[0]["discard_reason"] == "too_senior" and listed[0]["discard_note"] == "10+ years"
    assert client.patch(url, json={"status": "dismissed", "discard_reason": "bogus"}).status_code == 422  # fmt: skip
    # Any other status clears the reason, even when one is sent.
    r = client.patch(url, json={"status": "new", "discard_reason": "salary"}).json()
    assert r["status"] == "new" and r["discard_reason"] is None and r["discard_note"] is None
    assert r["reviewed_at"] is None
    assert set(s.DiscardReason.__args__) == set(discovery.DISCARD_REASONS)
    assert client.patch(f"/api/discover/{contoso['id']}", json={"status": "bogus"}).status_code == 422  # fmt: skip


def test_discover_insights(client, repo):
    from datetime import UTC, datetime, timedelta

    from tests.fakes import posting

    now = datetime.now(UTC)
    staff = posting(source="workable", fetched_at=now, title="Staff Engineer")
    hidden = posting(source="workable", fetched_at=now, drop_reason="location")
    old = posting(source="ashby", fetched_at=now - timedelta(days=40))  # before the window
    for p in (staff, hidden, old):
        repo.add_posting(p)

    empty = client.get("/api/discover/insights").json()
    assert len(empty["days"]) == 30 and empty["reviews"]["total"] == 0
    assert (empty["postings"]["total"], empty["postings"]["hidden"]) == (2, 1)
    assert empty["reviews"]["waiting"] == 2  # the queue now, whenever the postings came
    assert empty["discards"] == {"total": 0, "without_reason": 0, "reasons": [], "sources": []}

    body = {"status": "dismissed", "discard_reason": "too_senior", "discard_note": "staff"}
    client.patch(f"/api/discover/{staff.id}", json=body)
    out = client.get("/api/discover/insights", params={"days": 7}).json()
    assert len(out["days"]) == 7 and out["reviews"]["days"][-1]["discarded"] == 1
    reason = out["discards"]["reasons"][0]
    assert (reason["reason"], reason["count"], reason["hints"]) == ("too_senior", 1, [])
    assert reason["notes"][0]["note"] == "staff" and reason["splits"]["source"] == [["workable", 1]]
    assert client.get("/api/discover/insights", params={"days": 0}).status_code == 422


def test_discover_settings_and_searches(client):
    r = client.put("/api/discover/settings", json={"criteria": "  Lives in BA  ", "rules": {"max_age_days": 10, "agencies": ["Acme Talent"]}})  # fmt: skip
    body = r.json()
    assert body["criteria"] == "Lives in BA"
    assert body["rules"]["max_age_days"] == 10 and body["rules"]["agencies"] == ["Acme Talent"]
    assert body["rules"]["title_exclude"]  # defaults kept for keys not sent
    assert client.put("/api/discover/settings", json={"criteria": " "}).status_code == 422

    r = client.post("/api/discover/searches", json={"source": "workable", "label": "BR", "params": {"query": " backend ", "location": "Brazil"}})  # fmt: skip
    assert r.status_code == 201 and r.json()["params"] == {"query": "backend", "location": "Brazil"}
    gone = client.post("/api/discover/searches", json={"source": "jsearch", "label": "x", "params": {"query": "x"}})  # fmt: skip
    assert gone.status_code == 422
    sid = r.json()["id"]
    bad = client.post("/api/discover/searches", json={"source": "remoteyeah", "label": "x", "params": {"feed": "https://evil.test/a.xml"}})  # fmt: skip
    assert bad.status_code == 422 and "remoteyeah.com" in bad.json()["detail"]
    assert client.patch(f"/api/discover/searches/{sid}", json={"params": {"query": ""}}).status_code == 422  # fmt: skip
    assert client.delete(f"/api/discover/searches/{sid}").status_code == 204
    assert client.get("/api/discover/settings").json()["searches"] == []


def test_discover_run_is_local_only(repo):
    settings = Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"})  # fmt: skip
    client = TestClient(create_app(settings, repo_factory=lambda: repo))
    assert client.get("/api/discover/settings").json()["can_run"] is True


def test_discover_boards_collect_only_and_hide_company(repo):
    from jobtracker.core import discovery
    from jobtracker.core.clock import SystemClock
    from tests.fakes import FakeBoards, FakeLLM, posting

    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    discovery.import_companies(repo, [{"ats": "ashby", "slug": "mural", "name": "Mural"}], SystemClock())  # fmt: skip
    boards = FakeBoards({
        ("ashby", "mural"): [
            posting(source="ashby", source_id="mural:1", company="Mural"),
            posting(source="ashby", source_id="mural:2", company="Mural", title="Backend Engineer"),
        ]
    })  # fmt: skip
    llm = FakeLLM()
    client = TestClient(
        create_app(settings, repo_factory=lambda: repo, discovery_factory=lambda: ({}, llm),
                   boards_factory=lambda: boards)
    )  # fmt: skip

    run = client.post("/api/discover/run", json={"score": False}).json()
    assert (run["new"], run["llm_calls"], llm.calls) == (2, 0, [])
    state = client.get("/api/discover/settings").json()
    assert state["companies"] == {
        "total": 1, "enabled": 1, "by_ats": {"ashby": 1, "greenhouse": 0, "lever": 0},
        "with_jobs": 1, "jobs_kept": 2, "last_checked_at": state["companies"]["last_checked_at"], "last_scan_at": None,
    }  # fmt: skip
    page = client.get("/api/discover", params={"source": "ashby"}).json()
    assert page["counts"] == {"total": 2, "hidden": 0, "unscored": 2}
    assert state["unscored"] == 2

    # Score what is waiting without reading the boards again.
    nothing = client.post("/api/discover/run", json={"score": False, "collect": False})
    assert nothing.status_code == 422
    run = client.post("/api/discover/run", json={"collect": False}).json()
    assert (run["fetched"], run["llm_calls"]) == (0, 2)
    assert boards.calls == [("ashby", "mural")]  # only the first run read the board
    assert client.get("/api/discover/progress").json()["kind"] == "score"
    assert client.get("/api/discover/settings").json()["unscored"] == 0

    blocked = client.post("/api/discover/block", json={"company": "Mural"}).json()
    assert blocked["hidden"] == 2 and "Mural" in blocked["rules"]["blocked"]
    assert client.get("/api/discover").json()["postings"] == []
    assert client.post("/api/discover/block", json={"company": "  "}).status_code == 422
