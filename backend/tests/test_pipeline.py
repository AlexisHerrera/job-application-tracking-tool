from datetime import UTC, datetime

from jobtracker.core import services
from jobtracker.core.models import EventType, MatchMethod, Origin, Stage
from jobtracker.core.pipeline import Pipeline, PipelineConfig, run_backfill, run_incremental
from jobtracker.core.ports import LLMError, LLMRefusal, SyncState
from tests.conftest import ME, TZ, load
from tests.fakes import FakeLLM, extraction

RECEIVED = extraction(company="Northwind Labs", role="Senior Backend Engineer",
                      event_type="application_received", stage_implied="applied", confidence=0.95)  # fmt: skip


def test_confirmation_creates_application_flagged_for_review(pipeline, llm, repo):
    llm.extract["Northwind Labs"] = RECEIVED
    out = pipeline.process(load("ashby_received.eml", uid=1, thread="t-nw"))
    assert out.verdict == "job" and out.event.match_method == MatchMethod.CREATED
    [app] = repo.list_applications()
    assert app.company_name == "Northwind Labs" and app.needs_review and app.origin == Origin.EMAIL
    assert app.source_ats == "ashby"
    assert llm.calls == ["extract"]  # allowlisted: no gate call


def test_duplicates_are_skipped(pipeline, llm):
    llm.extract["Northwind Labs"] = RECEIVED
    pipeline.process(load("ashby_received.eml"))
    assert pipeline.process(load("ashby_received.eml")).verdict == "duplicate"
    assert llm.calls == ["extract"]


def test_manual_backfill_application_absorbs_old_email(pipeline, llm, repo, clock):
    app = services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company="Northwind Labs, Inc.", role_title="Sr. Backend Engineer"
        ),
    )
    llm.extract["Northwind Labs"] = RECEIVED
    out = pipeline.process(load("ashby_received.eml"))
    assert out.event.application_id == app.id
    assert len(repo.list_applications()) == 1


def test_noise_never_reaches_llm(pipeline, llm, repo):
    for name in ("linkedin_alert.eml", "newsletter.eml", "personal.eml"):
        assert pipeline.process(load(name)).verdict == "dropped"
    assert llm.calls == []
    assert all(v[1] == "dropped" for v in repo.processed.values())
    assert repo.events == {}  # nothing stored for non-job mail


def test_candidate_goes_through_gate(pipeline, llm, repo):
    llm.gate["Adventure Works"] = True
    llm.extract["Adventure Works"] = extraction(company="Adventure Works", role="Backend Python",
                                                event_type="recruiter_outreach", needs_reply=True, confidence=0.8)  # fmt: skip
    out = pipeline.process(load("recruiter_es.eml"))
    assert llm.calls == ["gate", "extract"]
    assert out.verdict == "job"
    assert out.event.application_id is None  # outreach doesn't auto-create
    assert out.event.needs_reply


def test_gate_no_drops(pipeline, llm):
    assert pipeline.process(load("recruiter_es.eml")).reason == "llm_gate_no"


def test_calendar_overrides_llm_time(pipeline, llm, repo, clock):
    services.create_application(
        repo, clock, services.ApplicationInput(company="Contoso", role_title="Platform Engineer")
    )
    llm.extract["Contoso"] = extraction(company="Contoso", role="Platform Engineer", event_type="interview_invite",
                                        interview_at="2026-11-05T09:00:00-03:00", confidence=0.9)  # fmt: skip
    out = pipeline.process(load("greenhouse_interview_ics.eml"))
    assert out.event.event_type == EventType.INTERVIEW_SCHEDULED
    assert out.event.interview_at == datetime(2026, 11, 5, 15, 0, tzinfo=UTC)
    [app] = repo.list_applications()
    assert (
        app.current_stage == Stage.INTERVIEWING and app.next_interview_at == out.event.interview_at
    )


def test_thread_followups_attach_and_my_reply_clears_needs_reply(pipeline, llm, repo, clock):
    app = services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company="Northwind Labs", role_title="Backend", company_domain="northwind.test"
        ),
    )
    llm.extract["Jane Doe"] = extraction(
        event_type="interview_invite", needs_reply=True, company="Northwind Labs"
    )
    first = pipeline.process(load("company_reply.eml", thread="t-jane"))
    assert first.event.application_id == app.id and first.event.needs_reply
    out = pipeline.process(load("own_reply.eml", thread="t-jane"))
    assert out.verdict == "own_reply"
    assert repo.get_event(first.event.id).replied_at is not None
    assert len(repo.events) == 1  # my own mail is not stored as an event


def test_unassigned_then_manual_assignment_learns_alias(pipeline, llm, repo, clock):
    app = services.create_application(
        repo, clock, services.ApplicationInput(company="Fabrikam", role_title="Backend Engineer")
    )
    llm.extract["Fabrikam"] = extraction(
        company="Fabricam Group", event_type="rejection", confidence=0.4
    )
    out = pipeline.process(load("lever_rejection.eml"))
    assert out.event.application_id is None
    services.assign_event(repo, clock, TZ, out.event.id, app.id)
    assert repo.get_application(app.id).current_stage == Stage.REJECTED
    assert (
        repo.find_company_by_alias(services.AliasKind.DISPLAY_NAME, "fabrikam").id == app.company_id
    )


def test_transient_llm_error_is_retried_later(pipeline, llm, repo):
    llm.fail_with = LLMError("overloaded")
    out = pipeline.process(load("ashby_received.eml"))
    assert out.verdict == "error"
    assert not repo.is_processed("<ashby-received-1@ashbyhq.com>")


def test_refusal_is_recorded_and_skipped(pipeline, llm, repo):
    llm.fail_with = LLMRefusal("refusal")
    assert pipeline.process(load("ashby_received.eml")).reason == "llm_refusal"
    assert repo.is_processed("<ashby-received-1@ashbyhq.com>")


def test_dry_run_writes_nothing(repo, clock):
    llm = FakeLLM(extract={"Northwind Labs": RECEIVED})
    p = Pipeline(repo, llm, clock, PipelineConfig(tz=TZ, my_addresses={ME}), dry_run=True)
    assert p.process(load("ashby_received.eml")).verdict == "job"
    assert repo.apps == {} and repo.events == {} and repo.processed == {}


class FakeSource:
    mailbox = "[Gmail]/All Mail"

    def __init__(self, emails, uidvalidity=1):
        self.emails = emails
        self._uidvalidity = uidvalidity

    def uidvalidity(self):
        return self._uidvalidity

    def last_uid(self):
        return max(e.uid for e in self.emails)

    def fetch_new(self, after_uid):
        return iter([e for e in self.emails if e.uid > after_uid])

    def fetch_range(self, since, until):
        return iter(self.emails)


def test_incremental_first_run_starts_at_now_then_advances(pipeline, llm, repo):
    llm.extract["Northwind Labs"] = RECEIVED
    old = load("personal.eml", uid=10)
    report = run_incremental(pipeline, FakeSource([old]))
    assert report.seen == 0 and repo.get_sync_state("[Gmail]/All Mail").last_uid == 10

    new = [load("linkedin_alert.eml", uid=11), load("ashby_received.eml", uid=12)]
    report = run_incremental(pipeline, FakeSource([old, *new]))
    assert report.seen == 2 and report.created == 1
    assert repo.get_sync_state("[Gmail]/All Mail").last_uid == 12


def test_incremental_stops_at_error_without_advancing(pipeline, llm, repo):
    repo.set_sync_state(SyncState("[Gmail]/All Mail", 1, 10))
    emails = [load("ashby_received.eml", uid=11), load("lever_rejection.eml", uid=12)]
    report = run_incremental(pipeline, FakeSource(emails))  # no scripted extraction -> LLMError
    assert report.errors == 1 and report.seen == 1
    assert repo.get_sync_state("[Gmail]/All Mail").last_uid == 10


def test_uidvalidity_change_resets_checkpoint(pipeline, repo):
    repo.set_sync_state(SyncState("[Gmail]/All Mail", 1, 500))
    run_incremental(pipeline, FakeSource([load("personal.eml", uid=20)], uidvalidity=2))
    state = repo.get_sync_state("[Gmail]/All Mail")
    assert (state.uidvalidity, state.last_uid) == (2, 20)


def test_backfill_is_idempotent(pipeline, llm, repo):
    llm.extract["Northwind Labs"] = RECEIVED
    emails = [load("ashby_received.eml"), load("personal.eml")]
    run_backfill(pipeline, FakeSource(emails), None, None)
    report = run_backfill(pipeline, FakeSource(emails), None, None)
    assert report.counts["duplicate"] == 2
    assert len(repo.list_applications()) == 1
