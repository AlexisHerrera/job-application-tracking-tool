from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from jobtracker.api.app import create_app
from jobtracker.core import paste, services
from jobtracker.core.models import Stage
from jobtracker.settings import Settings
from tests.conftest import TZ
from tests.fakes import FakeLLM, MemoryRepo, paste_record


def _records(*recs):
    return paste.parse_records({"applications": list(recs)}, TZ)


def test_normalizes_salary_dates_and_stack():
    [r] = _records(paste_record(company="Northwind", role_title="SWE", salary_min=5000, salary_max=4000,
                                salary_period="monthly", salary_currency="usd", stack=["Python", " aws ", "python"],
                                applied_at="2026-09-03", stage="interviewing", stage_date="2026-09-20"))  # fmt: skip
    assert (r.values["salary_min"], r.values["salary_max"]) == (48000, 60000)  # swapped + x12
    assert r.salary_note == "converted from monthly to yearly (x12)"
    assert r.values["salary_currency"] == "USD"
    assert r.values["stack"] == ["aws", "python"]
    assert r.values["applied_at"].date().isoformat() == "2026-09-03"
    assert r.stage == Stage.INTERVIEWING and r.stage_at.date().isoformat() == "2026-09-20"


def test_drops_records_without_company_and_bad_values():
    recs = _records(
        paste_record(company=""),
        paste_record(company="X", salary_min=-5, stage="hired", applied_at="soon"),
    )
    assert len(recs) == 1
    r = recs[0]
    assert r.values["salary_min"] is None and r.stage is None and r.values["applied_at"] is None


def _app(repo, clock, **kw):
    data = services.ApplicationInput(
        **{"company": "Northwind", "role_title": "Backend Engineer", **kw}
    )
    return repo.get_application(services.create_application(repo, clock, data).id)


def test_diff_marks_fill_change_append(repo, clock):
    app = _app(
        repo,
        clock,
        location="Remote",
        stack=["python"],
        notes="Talked to Jane",
        salary_currency="USD",
    )
    [r] = _records(paste_record(company="Northwind", role_title="Backend Engineer", location="Buenos Aires",
                                stack=["python", "aws"], notes="Next: system design", salary_min=90000,
                                salary_max=110000, salary_currency="usd", company_domain="northwind.com"))  # fmt: skip
    changes = {c.field: c for c in paste.diff(app, r, set())}
    assert changes["location"].kind == "change" and changes["location"].current == "Remote"
    assert changes["stack"].kind == "append" and changes["stack"].proposed == ["aws", "python"]
    assert changes["notes"].kind == "append" and changes["notes"].proposed.startswith(
        "Talked to Jane\n"
    )
    assert changes["salary_min"].kind == "fill"
    assert changes["company_domain"].kind == "fill"
    assert "salary_currency" not in changes  # same value, different case
    assert "role_title" not in changes


def test_propose_prefers_strong_match_else_new(repo, clock):
    app = _app(repo, clock)
    apps = repo.list_applications()
    [same] = _records(
        paste_record(company="Northwind Inc", role_title="Backend Engineer", stage="rejected")
    )
    options, default = paste.propose(same, apps, {})
    assert options[default].application_id == app.id
    assert options[default].stage_change.kind == "change"
    assert options[-1].application_id is None  # "create new" is always offered

    [other_role] = _records(paste_record(company="Northwind", role_title="Data Scientist"))
    options, default = paste.propose(other_role, apps, {})
    assert options[default].application_id is None

    [unknown] = _records(paste_record(company="Contoso", role_title="SRE", stage="screening"))
    options, default = paste.propose(unknown, apps, {})
    assert len(options) == 1 and options[0].stage_change.proposed == Stage.SCREENING


# ---------------------------------------------------------------- API


@pytest.fixture
def setup():
    repo = MemoryRepo()
    llm = FakeLLM()
    settings = Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "true"})
    client = TestClient(create_app(settings, repo_factory=lambda: repo, llm_factory=lambda: llm))
    return client, repo, llm


def test_paste_endpoint_proposes_without_writing(setup):
    client, repo, llm = setup
    existing = client.post("/api/applications", json={"company": "Northwind", "role_title": "Backend Engineer",
                                                       "location": "Remote"}).json()  # fmt: skip
    llm.paste_response = {"applications": [
        paste_record(company="Northwind", role_title="Backend Engineer", location="Hybrid BA",
                     salary_min=100000, salary_max=120000, salary_currency="USD", stage="interviewing"),
        paste_record(company="Contoso", role_title="SRE", applied_at="2026-10-01"),
    ]}  # fmt: skip
    before = (len(repo.apps), len(repo.events), len(repo.aliases))
    r = client.post("/api/paste", json={"text": "notes from slack and email ..."})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (len(repo.apps), len(repo.events), len(repo.aliases)) == before

    nw, contoso = body["records"]
    chosen = nw["options"][nw["default_option"]]
    assert chosen["application_id"] == existing["id"]
    kinds = {c["field"]: c["kind"] for c in chosen["changes"]}
    assert kinds["location"] == "change" and kinds["salary_min"] == "fill"
    assert chosen["stage_change"] == {
        "current": "applied",
        "proposed": "interviewing",
        "at": None,
        "kind": "change",
    }
    assert contoso["options"][contoso["default_option"]]["application_id"] is None


def test_paste_scoped_to_application(setup):
    client, _repo, llm = setup
    app = client.post(
        "/api/applications", json={"company": "Northwind", "role_title": "SWE"}
    ).json()
    llm.paste_response = {
        "applications": [paste_record(company="Northwind Labs", benefits="Equity, 30 days PTO")]
    }
    body = client.post("/api/paste", json={"text": "x", "application_id": app["id"]}).json()
    [rec] = body["records"]
    assert [o["application_id"] for o in rec["options"]] == [app["id"]]
    assert rec["options"][0]["changes"][0]["field"] == "benefits"


def test_paste_limits_and_errors(setup):
    client, _repo, llm = setup
    assert (
        client.post("/api/paste", json={"text": "x" * (paste.MAX_PASTE_CHARS + 1)}).status_code
        == 422
    )
    from jobtracker.core.ports import LLMError

    llm.fail_with = LLMError("overloaded")
    assert client.post("/api/paste", json={"text": "hello"}).status_code == 502


def test_patch_applies_salary_and_domain(setup):
    client, repo, _llm = setup
    app = client.post(
        "/api/applications", json={"company": "Northwind", "role_title": "SWE"}
    ).json()
    r = client.patch(f"/api/applications/{app['id']}",
                     json={"salary_min": 90000, "salary_max": 100000, "salary_currency": "usd",
                           "benefits": "Equity", "company_domain": "northwind.com"})  # fmt: skip
    assert r.status_code == 200, r.text
    assert (r.json()["salary_min"], r.json()["salary_currency"]) == (90000, "USD")
    assert "northwind.com" in repo.company_domains()
    bad = client.patch(f"/api/applications/{app['id']}", json={"salary_min": 200000})
    assert bad.status_code == 422


def test_create_with_stage_at(setup):
    client, repo, _ = setup
    r = client.post("/api/applications", json={"company": "C", "role_title": "SRE", "stage": "rejected",
                                               "stage_at": "2026-09-20T12:00:00-03:00"})  # fmt: skip
    [ev] = repo.list_events(services.uuid.UUID(r.json()["id"]))
    assert ev.occurred_at == datetime(2026, 9, 20, 15, 0, tzinfo=UTC)
