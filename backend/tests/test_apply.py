from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from jobtracker.adapters.ats_forms import AtsForms, form_target, parse_lever
from jobtracker.api.app import create_app
from jobtracker.core import apply
from jobtracker.core.apply import FormField, FormSource
from jobtracker.core.clock import FixedClock
from jobtracker.core.ports import SourceError
from jobtracker.settings import Settings

NOW = datetime(2026, 11, 24, 12, tzinfo=UTC)


@pytest.fixture
def client(repo):
    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    return TestClient(create_app(settings, repo_factory=lambda: repo))


@pytest.mark.parametrize(
    ("label", "kind", "expected"),
    [
        ("What's the most impactful thing you've built?", "LongText", "projects"),
        (
            "What products or features are you proudest of building? Name one or two you'd want"
            " to walk us through in an interview",
            "LongText",
            "projects",
        ),
        (
            "Briefly describe a challenge you're proud of - we're particularly interested in"
            " ambiguity",
            "LongText",
            "projects",
        ),
        ("How has AI changed the way you build?", "LongText", "ai"),
        ("Why Acme?", "LongText", "why_us"),
        ("Why do you want to work at Acme?", "String", "why_us"),
        ("Have you used Acme - even in a side project?", "LongText", "why_us"),
        ("Why are you looking for a new opportunity now?", "LongText", "job_search"),
        ("Do you have experience with live coding interviews?", "LongText", "interviews"),
        ("Add a Cover Letter or anything else you'd like to share", "LongText", "extra"),
        ("Record a 1-minute loom video about something you're excited about", "LongText", "extra"),
        ("How have you used SQL and databases in your work?", "LongText", "stack"),
        (
            "Can you share an example of an issue you debugged and its root cause?",
            "LongText",
            "stack",
        ),
        (
            "What would your former colleagues say is your greatest strength?",
            "LongText",
            "how_you_work",
        ),
        (
            "How would you rank your priorities in deciding where you want to work next?",
            "LongText",
            "job_search",
        ),
        (
            "If you joined Acme, what would you hope to accomplish in your first 90 days?",
            "LongText",
            "why_us",
        ),
        (
            "Describe a technically challenging project. We're interested in the technical details.",
            "LongText",
            "projects",
        ),
    ],
)
def test_open_questions_and_their_category(label, kind, expected):
    assert apply.is_open_question(FormField(label, kind))
    assert apply.classify(label, "Acme") == expected


def test_have_you_used_is_about_the_company_only_when_it_names_it():
    assert apply.classify("Have you used Acme in a side project?", "Acme") == "why_us"
    assert apply.classify("Have you used Postgres?", "Acme") == "stack"


@pytest.mark.parametrize(
    ("label", "kind", "group"),
    [
        ("Full Name", "String", ""),
        ("Resume/CV", "input_file/textarea", ""),
        ("LinkedIn Profile", "String", ""),
        ("What is your monthly salary expectation? (USD Dollars)", "text", ""),
        ("Will you now or in the future require visa sponsorship?", "Boolean", ""),
        ("What's your English level?", "radio", ""),
        ("Current location", "text", ""),
        ("How did you hear about us?", "String", ""),
        ("What gender do you identify as?", "textarea", "demographic"),
        ("Portfolio, GitHub, or Personal Site", "String", ""),
        ("Are you open to travel?", "Boolean", ""),
    ],
)
def test_standard_fields_and_facts_are_not_questions(label, kind, group):
    assert not apply.is_open_question(FormField(label, kind, group=group))


def test_normalize_replaces_the_company_name():
    assert apply.normalize("Why Acme?", "Acme") == apply.normalize("Why Initech?", "Initech")
    assert apply.normalize("Why Acme Corp, and why now?", "Acme Corp") == "why company and why now"
    assert apply.normalize("What’s  your  STACK?") == "what s your stack"


def test_collect_merges_the_same_question_across_forms(repo):
    clock = FixedClock(NOW)
    forms = [
        (FormSource(url="https://a/1", company="Acme", ats="ashby"),
         [FormField("Why Acme?", "LongText"), FormField("Email", "Email")]),
        (FormSource(url="https://b/2", company="Initech", ats="ashby"),
         [FormField("Why Initech?", "LongText", True)]),
    ]  # fmt: skip
    out = apply.collect(repo, clock, forms)
    assert (out.forms, out.new_questions, out.new_sources) == (2, 1, 2)
    [q] = repo.list_questions()
    assert q.text == "Why Acme?" and q.category == "why_us"
    assert [s.text for s in q.sources] == ["Why Acme?", "Why Initech?"]
    again = apply.collect(repo, clock, forms)  # the same forms add nothing
    assert (again.new_questions, again.new_sources) == (0, 0)


def test_update_question_sets_answered_at(repo):
    clock = FixedClock(NOW)
    q, _, _ = apply.record(repo, clock, "Why Acme?", FormSource(url="paste:1", company="Acme"))
    apply.update_question(repo, clock, q, answer="  Because…  ", style_notes="2 sentences")
    stored = repo.get_question(q.id)
    assert stored.answer == "Because…" and stored.answered_at == NOW
    apply.update_question(repo, clock, stored, answer="")
    assert repo.get_question(q.id).answered_at is None
    with pytest.raises(apply.ApplyError):
        apply.update_question(repo, clock, stored, category="nope")


def test_form_target_from_urls_and_board_keys():
    assert form_target("https://job-boards.greenhouse.io/acme/jobs/1234567") == (
        "greenhouse", "acme", "1234567",
    )  # fmt: skip
    assert form_target("https://careers.initech.test/x?gh_jid=1", "greenhouse", "initech:1") == (
        "greenhouse", "initech", "1",
    )  # fmt: skip
    uid = "00000000-0000-4000-8000-000000000001"
    assert form_target(f"https://jobs.ashbyhq.com/acme/{uid}") == ("ashby", "acme", uid)
    assert form_target(f"https://jobs.lever.co/initech/{uid}/apply") == ("lever", "initech", uid)
    assert form_target("https://jobs.workable.com/view/AbCdEf123456/remote-dev") == (
        "workable", "AbCdEf123456", "",
    )  # fmt: skip
    assert form_target("https://example.test/jobs/1") == ("", "", "")


def test_parse_lever_form():
    page = """
    <li class="application-question resume"><div class="application-label">Resume/CV </div>
      <input type="file" name="resume"></li>
    <li class="application-question custom-question"><div class="application-label full-width text">
      <div class="text">Why us?<span class="required">✱</span></div></div>
      <textarea name="cards[abc][field0]" required></textarea></li>
    <textarea class="card-field-input" name="comments"></textarea>
    """
    fields = parse_lever(page)
    assert [(f.label, f.type) for f in fields] == [
        ("Resume/CV", "file"), ("Why us?", "textarea"), ("Additional information", "textarea"),
    ]  # fmt: skip
    assert fields[1].required and fields[1].group == "custom"


def _forms(handler) -> AtsForms:
    return AtsForms(httpx.Client(transport=httpx.MockTransport(handler)))


def test_fetch_greenhouse_and_closed_postings():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/1"):
            return httpx.Response(200, json={"questions": [
                {"label": "Why <b>us</b>?", "required": True, "fields": [{"type": "textarea"}]},
            ]})  # fmt: skip
        return httpx.Response(404)

    forms = _forms(handler)
    [f] = forms.fetch_form("greenhouse", "acme", "1")
    assert (f.label, f.type, f.required) == ("Why us?", "textarea", True)
    with pytest.raises(SourceError) as err:
        forms.fetch_form("greenhouse", "acme", "2")
    assert err.value.gone


def test_fetch_ashby_and_workable():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "jobs.ashbyhq.com":
            return httpx.Response(200, json={"data": {"jobPosting": {"applicationForm": {"sections": [
                {"title": "Questions", "fieldEntries": [
                    {"field": {"title": "Why Acme?", "type": "LongText"}, "isRequired": True}]},
            ]}}}})  # fmt: skip
        return httpx.Response(200, json=[{"name": "Details", "fields": [
            {"label": "Education", "fields": [{"label": "School", "type": "text"}]},
            {"label": "Tell us about a project", "type": "paragraph", "required": True},
        ]}])  # fmt: skip

    forms = _forms(handler)
    assert [f.label for f in forms.fetch_form("ashby", "acme", "x")] == ["Why Acme?"]
    fields = forms.fetch_form("workable", "abc123", "")
    assert [(f.label, f.group) for f in fields] == [
        ("School", "Education"), ("Tell us about a project", "Details"),
    ]  # fmt: skip


def test_questions_api(client):
    r = client.post("/api/apply/questions", json={"text": "Why Acme?", "company": "Acme"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created"] and body["question"]["category"] == "why_us"
    qid = body["question"]["id"]
    # The same question for another company is the same row.
    again = client.post("/api/apply/questions", json={"text": "Why Initech?", "company": "Initech"})
    assert not again.json()["created"] and len(again.json()["question"]["sources"]) == 2
    r = client.patch(f"/api/apply/questions/{qid}", json={"answer": "Because", "category": "extra"})
    assert r.json()["answer"] == "Because" and r.json()["category"] == "extra"
    assert client.patch(f"/api/apply/questions/{qid}", json={"category": "x"}).status_code == 422
    listed = client.get("/api/apply/questions").json()
    assert listed["categories"][0]["key"] == "projects"
    assert len(listed["questions"]) == 1
    assert client.delete(f"/api/apply/questions/{qid}").status_code == 204
    assert client.get("/api/apply/questions").json()["questions"] == []


def test_experiences_api(client):
    r = client.post(
        "/api/apply/experiences", json={"title": "Job tracker", "results": "Saves 1h/day"}
    )
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    second = client.post("/api/apply/experiences", json={"title": "Second"}).json()
    assert second["position"] == 1
    r = client.patch(f"/api/apply/experiences/{eid}", json={"contribution": " All of it "})
    assert r.json()["contribution"] == "All of it"
    assert [e["title"] for e in client.get("/api/apply/experiences").json()] == ["Job tracker", "Second"]  # fmt: skip
    assert client.delete(f"/api/apply/experiences/{eid}").status_code == 204
    assert client.patch(f"/api/apply/experiences/{eid}", json={"title": "x"}).status_code == 404


def test_facts_api(client):
    r = client.post("/api/apply/facts", json={"label": "Pay expectation, monthly (USD)"})
    assert r.json()["key"] == "pay_expectation_monthly_usd"
    dup = client.post("/api/apply/facts", json={"label": "Pay expectation, monthly (USD)"}).json()
    assert dup["key"] == "pay_expectation_monthly_usd_2"
    r = client.patch("/api/apply/facts/pay_expectation_monthly_usd", json={"value": " 5000 "})
    assert r.json()["value"] == "5000"
    assert client.patch("/api/apply/facts/nope", json={"value": "x"}).status_code == 404
    assert client.delete(f"/api/apply/facts/{dup['key']}").status_code == 204
    assert [f["key"] for f in client.get("/api/apply/facts").json()] == ["pay_expectation_monthly_usd"]  # fmt: skip
