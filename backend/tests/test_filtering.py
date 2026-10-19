import pytest

from jobtracker.core.filtering import FunnelConfig, FunnelStage, Verdict, classify, domain_matches
from tests.conftest import load
from tests.fakes import ATS

CFG = FunnelConfig(ats_domains=set(ATS), company_domains={"northwind.test"})


@pytest.mark.parametrize(
    ("fixture", "verdict", "stage"),
    [
        ("ashby_received.eml", Verdict.PASS, FunnelStage.ALLOWLIST),
        ("greenhouse_interview_ics.eml", Verdict.PASS, FunnelStage.ALLOWLIST),
        ("lever_rejection.eml", Verdict.PASS, FunnelStage.ALLOWLIST),
        ("workable_rejection_es_html.eml", Verdict.PASS, FunnelStage.ALLOWLIST),
        ("company_reply.eml", Verdict.PASS, FunnelStage.ALLOWLIST),
        ("linkedin_easy_apply.eml", Verdict.PASS, FunnelStage.ALLOWLIST),
        ("linkedin_alert.eml", Verdict.DROP, FunnelStage.EXCLUDE),
        ("newsletter.eml", Verdict.DROP, FunnelStage.HEURISTIC),
        ("personal.eml", Verdict.DROP, FunnelStage.HEURISTIC),
        ("recruiter_es.eml", Verdict.CANDIDATE, FunnelStage.HEURISTIC),
    ],
)
def test_funnel(fixture, verdict, stage):
    d = classify(load(fixture), CFG, known_thread=False)
    assert (d.verdict, d.stage) == (verdict, stage), d.reason


def test_known_thread_passes_even_without_signal():
    d = classify(load("personal.eml"), CFG, known_thread=True)
    assert d.verdict == Verdict.PASS and d.stage == FunnelStage.THREAD


def test_alert_subjects_are_dropped_even_in_known_thread():
    d = classify(load("linkedin_alert.eml"), CFG, known_thread=True)
    assert d.verdict == Verdict.DROP


def test_new_company_domain_joins_allowlist():
    cfg = FunnelConfig(ats_domains=set(ATS), company_domains=set())
    assert classify(load("company_reply.eml"), cfg, known_thread=False).verdict != Verdict.PASS
    cfg.company_domains.add("northwind.test")
    assert classify(load("company_reply.eml"), cfg, known_thread=False).verdict == Verdict.PASS


def test_domain_matches_subdomains():
    assert domain_matches("us.greenhouse-mail.io", {"greenhouse-mail.io"}) == "greenhouse-mail.io"
    assert domain_matches("mail.northwind.test", {"northwind.test"}) == "northwind.test"
    assert domain_matches("northwindtest.com", {"northwind.test"}) is None
