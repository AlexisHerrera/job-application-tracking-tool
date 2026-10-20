from datetime import UTC, datetime
from pathlib import Path

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


def test_drops_records_without_company_or_role_and_bad_values():
    recs = _records(
        paste_record(company="", role_title=""),
        paste_record(company="X", salary_min=-5, stage="hired", applied_at="soon"),
    )
    assert len(recs) == 1
    r = recs[0]
    assert r.values["salary_min"] is None and r.stage is None and r.values["applied_at"] is None


def test_keeps_a_position_whose_company_is_not_named():
    # An agency post names the role but not the employer: still a record, company unknown.
    [r] = _records(paste_record(company=" ", role_title="Senior Fullstack Engineer",
                                salary_currency="usd"))  # fmt: skip
    assert r.company is None
    assert r.values["role_title"] == "Senior Fullstack Engineer"
    assert r.values["salary_currency"] == "USD" and r.values["salary_min"] is None
    # ...unless the caller knows which application it is about.
    [scoped] = paste.parse_records(
        {"applications": [paste_record(company="", role_title="SWE")]}, TZ, "Northwind"
    )
    assert scoped.company == "Northwind"


def test_agency_goes_to_notes_never_to_company():
    [r] = _records(paste_record(company="", role_title="SRE", agency="Talentia",
                                notes="Employee (relación de dependencia)."))  # fmt: skip
    assert r.company is None
    assert (
        r.values["notes"] == "Via recruiting agency Talentia. Employee (relación de dependencia)."
    )
    [named] = _records(paste_record(company="", role_title="SRE", agency="Talentia",
                                    notes="Talentia's director interviews first."))  # fmt: skip
    assert named.values["notes"] == "Talentia's director interviews first."


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

    # No company: never guess an existing application from the role alone.
    [no_company] = _records(paste_record(company="", role_title="Backend Engineer"))
    options, default = paste.propose(no_company, apps, {})
    assert [o.application_id for o in options] == [None] and default == 0
    assert options[0].label == "Create new: (company?) · Backend Engineer"


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


def test_empty_strings_and_zero_mean_unknown():
    [r] = _records(paste_record(company="Northwind", role_title="", salary_min=0, salary_max=0,
                                stage="", seniority="", salary_period="", applied_at=""))  # fmt: skip
    assert r.values["role_title"] is None and r.values["salary_min"] is None
    assert r.stage is None and r.values["seniority"] is None and r.values["applied_at"] is None


def test_scoped_paste_without_company_uses_target(setup):
    client, _repo, llm = setup
    app = client.post(
        "/api/applications", json={"company": "Pasito", "role_title": "Fullstack engineer UI"}
    ).json()
    llm.paste_response = {"applications": [paste_record(company="", stage="rejected",
                                                        notes="Feedback: couldn't go deep on implementation")]}  # fmt: skip
    body = client.post(
        "/api/paste",
        json={"text": "Sorry for late feedback. It's a no.", "application_id": app["id"]},
    ).json()
    [rec] = body["records"]
    assert rec["company"] == "Pasito"
    opt = rec["options"][0]
    assert opt["stage_change"]["proposed"] == "rejected" and opt["stage_change"]["kind"] == "change"
    assert opt["changes"][0]["field"] == "notes"


FIXTURES = Path(__file__).parent / "fixtures" / "paste"

# What the prompt should make of the synthetic agency post (scripted: tests never call the LLM).
AGENCY_POST_RECORD = paste_record(
    company="",
    role_title="Senior Backend Engineer",
    source_channel="recruiter",
    seniority="senior",
    stack=["go", "kubernetes", "postgresql", "gcp"],
    location="Hybrid, 2 days/week at the office in Palermo, Buenos Aires",
    salary_currency="USD",
    benefits="Paid in USD; Swiss Medical SMG30; 4 weeks vacation",
    job_description="Buscamos un Senior Backend Engineer con experiencia en Go y Kubernetes…",
    notes="Employee (relación de dependencia); paid in USD, amount not given. Process: 1) recruiter "
    "call (30 min) 2) technical interview (1 h) 3) CTO interview. A benefit names Acme Coffee.",
)


def test_agency_post_without_company_is_offered_as_new(setup):
    client, _repo, llm = setup
    client.post("/api/applications", json={"company": "Northwind", "role_title": "Senior Backend Engineer"})  # fmt: skip
    llm.paste_response = {"applications": [AGENCY_POST_RECORD]}
    text = (FIXTURES / "agency_post_es.txt").read_text()
    r = client.post("/api/paste", json={"text": text})
    assert r.status_code == 200, r.text
    [rec] = r.json()["records"]
    assert rec["company"] is None
    # Same role as an existing application, but no company: only "create new".
    [option] = rec["options"]
    assert option["application_id"] is None and rec["default_option"] == 0
    proposed = {c["field"]: c["proposed"] for c in option["changes"]}
    assert proposed["role_title"] == "Senior Backend Engineer"
    assert proposed["salary_currency"] == "USD" and "salary_min" not in proposed
    assert proposed["source_channel"] == "recruiter"


def test_prompt_covers_agency_posts():
    system, user = paste.paste_prompt("hola", datetime(2026, 10, 20, 15, tzinfo=UTC), TZ)
    assert "2026-10-20" in system and user == "<pasted>\nhola\n</pasted>"
    for rule in ("recruiting agency", "never infer the company", "relación de dependencia",
                 "sueldo en dólares", "interview process", "verbatim"):  # fmt: skip
        assert rule in system
