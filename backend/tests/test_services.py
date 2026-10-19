import pytest

from jobtracker.core import services
from jobtracker.core.models import AliasKind, Stage
from tests.conftest import TZ


def test_create_application_learns_domain_but_not_ats(repo, clock):
    services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company="Northwind", role_title="SWE", job_url="https://jobs.ashbyhq.com/northwind/1"
        ),
    )
    assert repo.company_domains() == set()
    services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company="Northwind", role_title="SRE", job_url="https://careers.northwind.test/sre"
        ),
    )
    assert repo.company_domains() == {"careers.northwind.test"}
    assert len(repo.companies) == 1


def test_job_board_urls_are_not_company_domains(repo, clock):
    services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company="Tailspin", role_title="SWE", job_url="https://www.linkedin.com/jobs/view/1"
        ),
    )
    assert repo.company_domains() == set()


def test_guess_ats_from_url(repo, clock):
    a = services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company="X", role_title="SWE", job_url="https://jobs.lever.co/x/1"
        ),
    )
    assert a.source_ats == "lever"


def test_csv_import_with_historical_stage(repo, clock):
    rows = services.parse_csv(
        "company,role,applied_at,stage,stack,company_domain\n"
        "Northwind,Backend,2026-08-01,rejected,python;aws,northwind.test\n"
        "Contoso,Platform,15/09/2026,,go,\n",
        TZ,
    )
    for r in rows:
        services.create_application(repo, clock, r, services.Origin.IMPORT)
    apps = {a.company_name: a for a in repo.list_applications()}
    assert apps["Northwind"].current_stage == Stage.REJECTED
    assert apps["Northwind"].stack == ["python", "aws"]
    assert apps["Contoso"].applied_at.date().isoformat() == "2026-09-15"
    assert repo.find_company_by_alias(AliasKind.DOMAIN, "northwind.test")


@pytest.mark.parametrize(
    "bad",
    ["name,title\nx,y", "company,role,stage\nX,Y,hired", "company,role,applied_at\nX,Y,yesterday"],
)
def test_csv_errors_are_readable(bad):
    with pytest.raises(services.InvalidInput):
        services.parse_csv(bad, TZ)


def test_delete_application_returns_email_events_to_inbox(repo, clock, pipeline, llm):
    from tests.conftest import load
    from tests.fakes import extraction

    llm.extract["Northwind Labs"] = extraction(
        company="Northwind Labs", role="SWE", event_type="application_received"
    )
    out = pipeline.process(load("ashby_received.eml"))
    app_id = out.event.application_id
    services.change_stage(repo, clock, app_id, Stage.WITHDRAWN)
    services.delete_application(repo, clock, app_id)
    assert repo.list_applications() == []
    [ev] = repo.list_unassigned()
    assert ev.id == out.event.id


def test_create_application_from_event(repo, clock, pipeline, llm):
    from tests.conftest import load
    from tests.fakes import extraction

    llm.gate["Adventure Works"] = True
    llm.extract["Adventure Works"] = extraction(
        company="Adventure Works", event_type="recruiter_outreach"
    )
    out = pipeline.process(load("recruiter_es.eml"))
    app = services.create_application_from_event(
        repo,
        clock,
        TZ,
        out.event.id,
        services.ApplicationInput(company="Adventure Works", role_title="Backend Python"),
    )
    assert repo.get_event(out.event.id).application_id == app.id
    assert repo.get_application(app.id).current_stage == Stage.SCREENING
    assert repo.find_company_by_alias(AliasKind.ADDRESS, "maria.lopez.rec@gmail.com")
