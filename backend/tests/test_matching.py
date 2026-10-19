from jobtracker.core import services
from jobtracker.core.extraction import parse_extraction
from jobtracker.core.matching import aliases_to_learn, display_name_key, match, normalize_company
from jobtracker.core.models import AliasKind, MatchMethod
from tests.conftest import TZ, load
from tests.fakes import ATS, extraction


def _x(**kw):
    return parse_extraction(extraction(**kw), TZ)


def _add(repo, clock, company, role, domain=None):
    return services.create_application(
        repo,
        clock,
        services.ApplicationInput(company=company, role_title=role, company_domain=domain),
    )


def test_normalize_company():
    assert normalize_company("Northwind Labs, Inc.") == "northwind"
    assert normalize_company("Sluicebox AI") == "sluicebox"
    assert normalize_company("Ñandú Tech S.A.") == "nandu tech"


def test_display_name_key():
    assert display_name_key("Northwind Hiring Team") == "northwind"
    assert display_name_key("Greenhouse") is None
    assert display_name_key("") is None


def test_thread_match_wins(repo, clock):
    app = _add(repo, clock, "Northwind Labs", "Senior Backend Engineer")
    r = match(load("lever_rejection.eml"), _x(company="Fabrikam"), repo, app.id)
    assert r.method == MatchMethod.THREAD and r.application_id == app.id


def test_company_domain_with_single_active_application(repo, clock):
    app = _add(repo, clock, "Northwind Labs", "Senior Backend Engineer", domain="northwind.test")
    r = match(load("company_reply.eml"), _x(), repo, None)
    assert (r.method, r.application_id) == (MatchMethod.ALIAS, app.id)


def test_company_domain_with_two_applications_uses_role(repo, clock):
    _add(repo, clock, "Northwind Labs", "Data Engineer", domain="northwind.test")
    backend = _add(repo, clock, "Northwind Labs", "Senior Backend Engineer")
    r = match(load("company_reply.eml"), _x(role="Senior Backend Engineer"), repo, None)
    assert r.application_id == backend.id
    unclear = match(load("company_reply.eml"), _x(role=None), repo, None)
    assert unclear.application_id is None and unclear.company_id == backend.company_id


def test_generic_ats_sender_fuzzy_matches_company_and_role(repo, clock):
    app = _add(repo, clock, "Fabrikam Inc", "Backend Engineer")
    r = match(
        load("lever_rejection.eml"),
        _x(company="Fabrikam", role="Backend Engineer (Remote)"),
        repo,
        None,
    )
    assert (r.method, r.application_id) == (MatchMethod.FUZZY, app.id)


def test_fuzzy_needs_confidence(repo, clock):
    _add(repo, clock, "Fabrikam", "Backend Engineer")
    r = match(
        load("lever_rejection.eml"),
        _x(company="Fabrikam", role="Backend Engineer", confidence=0.2),
        repo,
        None,
    )
    assert r.application_id is None


def test_confirmation_from_unknown_company_creates(repo, clock):
    r = match(load("ashby_received.eml"),
              _x(company="Northwind Labs", role="Senior Backend Engineer", event_type="application_received"),
              repo, None)  # fmt: skip
    assert r.create_application and r.method == MatchMethod.CREATED


def test_confirmation_for_existing_application_does_not_duplicate(repo, clock):
    app = _add(repo, clock, "Northwind Labs", "Senior Backend Engineer")
    r = match(load("ashby_received.eml"),
              _x(company="Northwind Labs", role="Senior Backend Engineer", event_type="application_received"),
              repo, None)  # fmt: skip
    assert r.application_id == app.id and not r.create_application


def test_low_confidence_unknown_goes_unassigned(repo):
    r = match(load("lever_rejection.eml"), _x(company="Nobody", confidence=0.3), repo, None)
    assert r.application_id is None and r.method == MatchMethod.NONE


def test_alias_learning_never_poisons_shared_ats_senders():
    ats = set(ATS)
    assert aliases_to_learn("no-reply@ashbyhq.com", "Northwind Hiring Team", ats) == [
        (AliasKind.DISPLAY_NAME, "northwind")
    ]
    assert aliases_to_learn("northwind@ashbyhq.com", "Ashby", ats) == [
        (AliasKind.ADDRESS, "northwind@ashbyhq.com")
    ]
    assert aliases_to_learn("jane@northwind.test", "Jane Doe", ats) == [
        (AliasKind.DOMAIN, "northwind.test")
    ]
    assert aliases_to_learn("maria.lopez.rec@gmail.com", "María", ats) == [
        (AliasKind.ADDRESS, "maria.lopez.rec@gmail.com")
    ]
    assert aliases_to_learn("jobs-noreply@linkedin.com", "LinkedIn", ats) == []
