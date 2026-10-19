"""Recruiting agencies: one recruiter, many companies. Senders never identify the company."""

from jobtracker.core import services
from jobtracker.core.filtering import FunnelConfig, FunnelStage, Verdict, classify
from jobtracker.core.matching import aliases_to_learn
from jobtracker.core.models import EventType, MatchMethod, Origin
from tests.conftest import TZ, load
from tests.fakes import AGENCIES, ATS, extraction

TAKEHOME = extraction(
    company="Northwind", role="Staff Fullstack Developer", event_type="assessment", confidence=0.85
)
PRACTICE = extraction(company="Contoso", role="Product Engineer", event_type="interview_scheduled", confidence=0.8,
                      summary="Practice session: system design")  # fmt: skip


def test_agency_people_pass_but_their_notifications_dont():
    cfg = FunnelConfig(set(ATS), set(), agency_domains=set(AGENCIES))
    d = classify(load("agency_takehome.eml"), cfg, known_thread=False)
    assert (d.verdict, d.stage, d.reason) == (
        Verdict.PASS,
        FunnelStage.ALLOWLIST,
        "agency:talentbridge.test",
    )
    assert (
        classify(load("agency_notification.eml"), cfg, known_thread=False).verdict != Verdict.PASS
    )


def test_agency_assessment_creates_application_for_review(pipeline, llm, repo):
    llm.extract["Northwind - Staff"] = TAKEHOME
    out = pipeline.process(load("agency_takehome.eml"))
    assert out.event.match_method == MatchMethod.CREATED
    [app] = repo.list_applications()
    assert (app.company_name, app.needs_review, app.origin) == ("Northwind", True, Origin.EMAIL)
    assert (app.source_ats, app.source_channel) == ("talentbridge", "recruiter")
    assert repo.aliases == []  # nothing learned from the agency sender
    assert llm.calls == ["extract"]  # no gate: agency person is allowlisted


def test_same_recruiter_two_companies_never_cross_match(pipeline, llm, repo):
    llm.extract["Northwind - Staff"] = TAKEHOME
    llm.extract["Contoso - Product"] = PRACTICE
    a = pipeline.process(load("agency_takehome.eml"))
    b = pipeline.process(load("agency_practice.eml"))
    assert a.event.application_id != b.event.application_id
    names = sorted(x.company_name for x in repo.list_applications())
    assert names == ["Contoso", "Northwind"]
    assert b.event.event_type == EventType.INTERVIEW_SCHEDULED


def test_manual_assignment_of_agency_mail_learns_nothing(pipeline, llm, repo, clock):
    app = services.create_application(
        repo, clock, services.ApplicationInput(company="Initech", role_title="SWE")
    )
    llm.extract["Northwind - Staff"] = extraction(company=None, event_type="other", confidence=0.3)
    out = pipeline.process(load("agency_takehome.eml"))
    assert out.event.application_id is None
    services.assign_event(repo, clock, TZ, out.event.id, app.id)
    assert repo.aliases == []
    assert aliases_to_learn("rafa@talentbridge.test", "Rafa", set(ATS), set(AGENCIES)) == []


def test_reprocess_dropped_reruns_only_dropped(pipeline, llm, repo):
    assert pipeline.process(load("recruiter_es.eml")).reason == "llm_gate_no"
    assert pipeline.process(load("recruiter_es.eml")).verdict == "duplicate"
    pipeline.reprocess_dropped = True
    llm.gate["Adventure Works"] = True
    llm.extract["Adventure Works"] = extraction(
        company="Adventure Works", event_type="recruiter_outreach"
    )
    assert pipeline.process(load("recruiter_es.eml")).verdict == "job"
    assert (
        pipeline.process(load("recruiter_es.eml")).verdict == "duplicate"
    )  # job mail is never redone


def test_agency_named_as_company_is_dropped(pipeline, llm, repo):
    llm.extract["Northwind - Staff"] = extraction(
        company="TalentBridge", event_type="interview_scheduled", confidence=0.9
    )
    out = pipeline.process(load("agency_takehome.eml"))
    assert out.event.application_id is None  # unassigned, not a bogus "TalentBridge" application
    assert repo.list_applications() == []


def test_auto_create_rematches_earlier_orphans(pipeline, llm, repo):
    llm.gate["Adventure Works"] = True
    llm.extract["Adventure Works"] = extraction(company="Adventure Works", role="Backend Python",
                                                event_type="recruiter_outreach", confidence=0.8)  # fmt: skip
    early = pipeline.process(load("recruiter_es.eml"))
    assert early.event.application_id is None
    llm.extract["Northwind - Staff"] = extraction(company="Adventure Works", role="Backend Python",
                                                  event_type="assessment", confidence=0.9)  # fmt: skip
    later = pipeline.process(load("agency_takehome.eml"))
    assert repo.get_event(early.event.id).application_id == later.event.application_id


def test_agency_name_variants_and_ats_display_names(pipeline, llm, repo):
    from jobtracker.core.matching import aliases_to_learn

    llm.extract["Northwind - Staff"] = extraction(
        company="TalentBridge Agency", event_type="assessment", confidence=0.9
    )
    assert pipeline.process(load("agency_takehome.eml")).event.application_id is None
    assert aliases_to_learn("info@hiringroom.com", "HiringRoom", {"hiringroom.com"}) == []


def test_unknown_role_is_filled_by_later_email_only_once(pipeline, llm, repo):
    llm.extract["Northwind - Staff"] = extraction(
        company="Northwind", role=None, event_type="assessment", confidence=0.9
    )
    first = pipeline.process(load("agency_takehome.eml"))
    assert repo.get_application(first.event.application_id).role_title == "(unknown role)"
    llm.extract["Contoso - Product"] = extraction(
        company="Northwind", role="Staff Engineer", event_type="interview_invite"
    )
    pipeline.process(load("agency_practice.eml"))
    assert repo.get_application(first.event.application_id).role_title == "Staff Engineer"
