"""Repository + pipeline against a real Postgres (docker compose `db`). Skipped when unreachable.

Uses a throwaway `jobtracker_test` database so local data is never touched.
"""

import os

import psycopg
import pytest

from jobtracker.adapters.db.migrate import migrate
from jobtracker.adapters.db.repo import PostgresRepo
from jobtracker.core import services, stats
from jobtracker.core.models import AliasKind, MatchMethod, Stage
from jobtracker.core.pipeline import Pipeline, PipelineConfig
from tests.conftest import ME, TZ, load
from tests.fakes import FakeLLM, extraction

ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL", "postgresql://jobtracker:jobtracker@localhost:5433/jobtracker"
)
TEST_DB = "jobtracker_test"


@pytest.fixture(scope="module")
def test_url():
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=2)
    except psycopg.OperationalError:
        pytest.skip("local Postgres not running (docker compose up db)")
    with admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB}")
        admin.execute(f"CREATE DATABASE {TEST_DB}")
    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{TEST_DB}"
    assert migrate(url) == ["0001_init.sql", "0002_seed_ats.sql"]
    assert migrate(url) == []  # idempotent
    yield url
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")


@pytest.fixture
def pg(test_url):
    repo = PostgresRepo.connect(test_url)
    for table in ("interview_notes", "events", "applications", "company_aliases", "companies",
                  "processed_messages", "mail_sync_state"):  # fmt: skip
        repo.conn.execute(f"DELETE FROM {table}")
    yield repo
    repo.close()


def test_end_to_end_flow(pg, clock):
    llm = FakeLLM(
        extract={
            "Northwind Labs": extraction(company="Northwind Labs", role="Senior Backend Engineer",
                                         event_type="application_received", confidence=0.95),
            "Contoso": extraction(company="Contoso", role="Platform Engineer", event_type="interview_invite"),
            "Fabrikam": extraction(company="Fabricam Group", event_type="rejection", confidence=0.4),
        }
    )  # fmt: skip
    pipe = Pipeline(pg, llm, clock, PipelineConfig(tz=TZ, my_addresses={ME}))
    with pg.transaction():
        contoso = services.create_application(
            pg, clock, services.ApplicationInput(company="Contoso", role_title="Platform Engineer")
        )
        fabrikam = services.create_application(
            pg, clock, services.ApplicationInput(company="Fabrikam", role_title="Backend Engineer")
        )

    outcomes = {}
    for name in (
        "ashby_received.eml",
        "greenhouse_interview_ics.eml",
        "lever_rejection.eml",
        "linkedin_alert.eml",
    ):
        with pg.transaction():
            outcomes[name] = pipe.process(load(name, thread=f"t-{name}"))

    assert outcomes["ashby_received.eml"].event.match_method == MatchMethod.CREATED
    assert outcomes["linkedin_alert.eml"].verdict == "dropped"
    assert pg.get_application(contoso.id).current_stage == Stage.INTERVIEWING
    assert pg.get_application(contoso.id).next_interview_at is not None
    assert pg.is_processed("<alert-1@linkedin.com>")

    # Re-processing is a no-op.
    with pg.transaction():
        assert pipe.process(load("ashby_received.eml")).verdict == "duplicate"

    # Unassigned rejection -> manual assignment -> alias learned -> stage updated.
    [unassigned] = pg.list_unassigned()
    with pg.transaction():
        services.assign_event(pg, clock, TZ, unassigned.id, fabrikam.id)
    assert pg.get_application(fabrikam.id).current_stage == Stage.REJECTED
    assert pg.find_company_by_alias(AliasKind.DISPLAY_NAME, "fabrikam").id == fabrikam.company_id

    s = stats.summary(pg.list_applications(), pg.list_all_events(), clock.now(), 14, 7)
    assert s["total"] == 3 and s["needs_review"] == 1


def test_thread_lookup_and_replied(pg, clock):
    llm = FakeLLM(extract={"Jane Doe": extraction(event_type="interview_invite", needs_reply=True)})
    pipe = Pipeline(pg, llm, clock, PipelineConfig(tz=TZ, my_addresses={ME}))
    with pg.transaction():
        services.create_application(
            pg,
            clock,
            services.ApplicationInput(
                company="Northwind", role_title="SWE", company_domain="northwind.test"
            ),
        )
        first = pipe.process(load("company_reply.eml", thread="t-1"))
    assert pg.thread_lookup("t-1", []).application_id == first.event.application_id
    assert pg.thread_lookup(None, ["<jane-1@northwind.test>"]).known
    assert not pg.thread_lookup("t-unknown", []).known
    with pg.transaction():
        pipe.process(load("own_reply.eml", thread="t-1"))
    assert pg.get_event(first.event.id).replied_at is not None


def test_transaction_rolls_back(pg, clock):
    with pytest.raises(RuntimeError), pg.transaction():
        services.create_application(
            pg, clock, services.ApplicationInput(company="Ghost", role_title="SWE")
        )
        raise RuntimeError("boom")
    assert pg.list_applications() == []


def test_notes_roundtrip(pg, clock):
    from jobtracker.core.models import InterviewNote

    with pg.transaction():
        app = services.create_application(
            pg, clock, services.ApplicationInput(company="N", role_title="SWE")
        )
        note = InterviewNote(application_id=app.id, questions=["q1"], topics_to_study=["sql"], self_rating=4,
                             created_at=clock.now(), updated_at=clock.now())  # fmt: skip
        pg.save_note(note)
        note.self_rating = 2
        pg.save_note(note)
    [saved] = pg.list_notes(app.id)
    assert saved.self_rating == 2 and saved.questions == ["q1"] and saved.topics_to_study == ["sql"]
