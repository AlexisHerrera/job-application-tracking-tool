import json
from datetime import UTC, datetime, timedelta

from jobtracker.core import details, services
from jobtracker.core.models import Event, EventKind, EventType
from jobtracker.evals import details_eval
from tests.conftest import TZ, load
from tests.fakes import FakeLLM, paste_record
from tests.test_pipeline import FakeSource

RECRUITER = load("recruiter_es.eml", uid=21)  # 2026-10-10, the newer one
INTERVIEW = load("greenhouse_interview_ics.eml", uid=22)


def _app_with_emails(repo, clock, *emails, **fields):
    data = services.ApplicationInput(
        company="Adventure Works", role_title="Backend Python", **fields
    )
    app = services.create_application(repo, clock, data)
    for m in emails:
        repo.add_event(Event(EventKind.EMAIL, EventType.OTHER, m.received_at,
                             application_id=app.id, message_id=m.message_id))  # fmt: skip
    return repo.get_application(app.id)


def test_message_ids_oldest_first_without_manual_events():
    t = datetime(2026, 10, 1, tzinfo=UTC)
    events = [
        Event(EventKind.EMAIL, EventType.OTHER, t + timedelta(days=2), message_id="<b>"),
        Event(EventKind.MANUAL, EventType.MANUAL_STAGE_CHANGE, t),
        Event(EventKind.EMAIL, EventType.OTHER, t + timedelta(days=1), message_id="<a>"),
        Event(EventKind.EMAIL, EventType.OTHER, t + timedelta(days=3), message_id="<a>"),
    ]
    assert details.message_ids(events) == ["<a>", "<b>"]


def test_emails_text_lists_each_email_oldest_first_with_its_header():
    text = details.emails_text([RECRUITER, INTERVIEW], TZ)
    first, second = text.split("--- Email 2 of 2")
    assert first.startswith("--- Email 1 of 2 · 2026-10-06 · From: Contoso Recruiting <no-reply@")
    assert second.startswith(" · 2026-10-10 · From: María López <maria.lopez.rec@gmail.com>")
    assert "Subject: Oportunidad laboral - Backend Python" in second and "Adventure Works" in second


def test_prompt_adds_the_email_rules_and_proposal_drops_the_stage(repo, clock):
    app = _app_with_emails(repo, clock)
    system, user = details.details_prompt("hola", clock.now(), TZ, app)
    assert '"Adventure Works"' in system and "ATS boilerplate" in system and "hola" in user
    raw = {"applications": [paste_record(company="", stack=["Python"], stage="interviewing",
                                         stage_date="2026-10-11")]}  # fmt: skip
    rec = details.proposal(raw, TZ, app)
    assert rec.company == "Adventure Works" and rec.values["stack"] == ["python"]
    assert rec.stage is None and rec.stage_at is None
    assert details.proposal({"applications": []}, TZ, app) is None


# ---------------------------------------------------------------- fill


def _fill(repo, clock, app, response, dry_run=False, emails=(RECRUITER, INTERVIEW)):
    llm = FakeLLM()
    llm.paste_response = {"applications": [response]}
    result = details.fill_application(repo, clock, FakeSource(list(emails)), llm, TZ, app,
                                      dry_run=dry_run)  # fmt: skip
    return result, llm


def test_fill_fills_empty_fields_and_never_overwrites(repo, clock):
    app = _app_with_emails(repo, clock, RECRUITER, location="Remote", notes="Referred by Ana")
    response = paste_record(
        company="Adventure Works", role_title="Senior Backend Python", stack=["Python", "AWS"],
        location="Hybrid, Buenos Aires", seniority="senior", salary_currency="usd",
        notes="Process: 3 interviews.", company_domain="adventure-works.com", stage="screening",
    )  # fmt: skip
    r, llm = _fill(repo, clock, app, response)
    assert (r.emails_read, r.emails_missing, r.error) == (1, 0, None)
    assert {c.field: c.kind for c in r.applied} == {
        "stack": "fill", "seniority": "fill", "salary_currency": "fill", "notes": "append",
        "company_domain": "fill",
    }  # fmt: skip
    assert {c.field for c in r.skipped} == {"role_title", "location"}  # would overwrite
    saved = repo.get_application(app.id)
    assert saved.stack == ["aws", "python"] and saved.seniority == "senior"
    assert saved.location == "Remote" and saved.role_title == "Backend Python"
    assert saved.notes == "Referred by Ana\nProcess: 3 interviews."
    assert saved.current_stage == app.current_stage  # stages are left alone
    assert "adventure-works.com" in repo.company_domains()
    assert llm.calls == ["paste"]


def test_fill_dry_run_saves_nothing(repo, clock):
    app = _app_with_emails(repo, clock, RECRUITER)
    r, _ = _fill(repo, clock, app, paste_record(company="", stack=["python"]), dry_run=True)
    assert [c.field for c in r.applied] == ["stack"]
    assert repo.get_application(app.id).stack == []


def test_fill_without_emails_makes_no_call(repo, clock):
    bare = repo.get_application(services.create_application(
        repo, clock, services.ApplicationInput(company="X", role_title="Y")).id)  # fmt: skip
    r, llm = _fill(repo, clock, bare, paste_record())
    assert r.error == "no emails to read" and llm.calls == []
    gone = _app_with_emails(repo, clock, load("ashby_received.eml"))  # not in the fake mailbox
    r, llm = _fill(repo, clock, gone, paste_record())
    assert r.error == "its emails aren't in Gmail anymore" and llm.calls == []


def test_has_no_details(repo, clock):
    assert details.has_no_details(_app_with_emails(repo, clock))
    assert not details.has_no_details(_app_with_emails(repo, clock, location="Remote"))


# ---------------------------------------------------------------- eval


def test_outcomes():
    o = details_eval.outcome
    assert o(None, None)[0] == "empty_ok"
    assert o(None, "senior") == ("wrong", ["should be empty"])
    assert o("senior", None)[0] == "missed"
    assert o("senior", "Senior")[0] == "correct"
    assert o({"similar": "Hybrid, 3 days/week in Núñez", "min": 85}, "hybrid 3 days/week in Nunez")[0] == "correct"  # fmt: skip
    assert o({"similar": "Remote (LATAM)", "min": 85}, "On-site in Madrid")[0] == "wrong"
    assert o({"items": ["aws", "node.js", "react", "typescript"], "min": 0.8},
             ["aws", "node.js", "react", "typescript", "postgresql"])[0] == "correct"  # fmt: skip
    kind, [why] = o({"items": ["aws", "python"], "min": 0.8}, ["aws", "go"])
    assert kind == "wrong" and "missing ['python'], extra ['go']" in why


def test_collect_snapshot_run(tmp_path, repo, clock):
    app = _app_with_emails(repo, clock, RECRUITER, INTERVIEW, stack=["python", "django"],
                           seniority="senior", location="Remote (LATAM)")  # fmt: skip
    services.create_application(
        repo, clock, services.ApplicationInput(company="NoMail", role_title="SRE")
    )
    source = FakeSource([RECRUITER, INTERVIEW])

    [line] = details_eval.collect(repo, source, tmp_path, TZ)
    name = details_eval.case_name(app)
    assert line == f"{name}: 2 email(s)" and name.startswith("adventure-works-backend-python-")
    assert "Email 2 of 2" in (tmp_path / f"{name}.txt").read_text()
    meta = json.loads((tmp_path / f"{name}.meta.json").read_text())
    assert meta["message_ids"] == [INTERVIEW.message_id, RECRUITER.message_id]

    [line] = details_eval.snapshot(repo, tmp_path)
    assert (
        line == f"{name}: 4/{len(details_eval.FIELDS)} fields filled"
    )  # role, seniority, stack, location
    exp = json.loads((tmp_path / f"{name}.expected.json").read_text())["fields"]
    assert exp["stack"] == {"items": ["django", "python"], "min": 0.8} and exp["salary_min"] is None
    assert details_eval.snapshot(repo, tmp_path)[0].endswith("use --force to replace it)")

    llm = FakeLLM()
    llm.paste_response = {"applications": [paste_record(
        company="Adventure Works", role_title="Backend Python", stack=["python", "django"],
        location="", seniority="senior", salary_min=5000, salary_max=5000, salary_currency="USD",
        salary_period="monthly", stage="interviewing",
    )]}  # fmt: skip
    run = details_eval.run_case(tmp_path, name, meta, llm, TZ, clock.now())
    by = {f.field: f.outcome for f in run.fields}
    assert by["role_title"] == by["seniority"] == by["stack"] == "correct"
    assert by["location"] == "missed"
    assert by["salary_min"] == by["salary_currency"] == "wrong"  # a salary nobody saved
    assert by["job_description"] == "empty_ok"
    actual = json.loads((tmp_path / f"{name}.actual.json").read_text())
    assert actual["salary_min"] == 60000 and actual["stage"] is None

    first = details_eval.save_report(tmp_path, [run], "fake", clock.now())
    second = details_eval.save_report(tmp_path, [run], "fake", clock.now() + timedelta(minutes=1))
    previous = details_eval.previous_report(tmp_path, second)
    assert previous == json.loads(first.read_text())["fields"]
    text = "\n".join(details_eval.render([run], previous))
    assert "missed location" in text.replace("  ", " ") and "wrong fills: 3 · misses: 1" in text


def test_run_case_skips_until_reviewed(tmp_path, clock):
    llm = FakeLLM()
    run = details_eval.run_case(tmp_path, "x", {}, llm, TZ, clock.now())
    assert run.error == "no emails collected"
    (tmp_path / "x.txt").write_text("hola")
    assert (
        "no expectation yet" in details_eval.run_case(tmp_path, "x", {}, llm, TZ, clock.now()).error
    )
    assert llm.calls == []
