"""Repository + pipeline against a real Postgres (docker compose `db`). Skipped when unreachable.

Uses a throwaway `jobtracker_test` database so local data is never touched.
"""

import os

import psycopg
import pytest

from jobtracker.adapters.db.migrate import migrate, migration_files
from jobtracker.adapters.db.repo import PostgresRepo
from jobtracker.core import services, stats
from jobtracker.core.models import AliasKind, MatchMethod, Stage, StepKind, StepLink
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
    assert migrate(url) == [name for name, _ in migration_files()]
    assert migrate(url) == []  # idempotent
    yield url
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")


@pytest.fixture
def pg(test_url):
    repo = PostgresRepo.connect(test_url)
    for table in ("process_steps", "interview_notes", "interviews", "calendar_sync_state", "events", "applications", "company_aliases", "companies",
                  "processed_messages", "mail_sync_state", "oauth_credentials", "ingest_lease"):  # fmt: skip
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


def test_steps_roundtrip(pg, clock):
    with pg.transaction():
        app = services.create_application(
            pg, clock, services.ApplicationInput(company="Tapi", role_title="SRE")
        )
        _, b = services.add_steps(pg, clock, app.id, [{"name": "Recruiter"}, {"name": "Challenge"}])
        services.update_step(pg, clock, b.id, {"position": 0, "done_at": clock.now()})
    steps = pg.list_steps(app.id)
    assert [(s.name, s.kind, s.position) for s in steps] == [
        ("Challenge", StepKind.TAKE_HOME, 0),
        ("Recruiter", StepKind.INTERVIEW, 1),
    ]
    assert steps[0].done_at == clock.now() and steps[0].link == StepLink.AUTO
    with pg.transaction():
        services.delete_application(pg, clock, app.id)
    assert pg.list_steps(app.id) == []


def test_calendar_sync_roundtrip(pg, clock):
    from datetime import timedelta

    from jobtracker.core.models import CalendarItem, InterviewNote, InterviewStatus
    from tests.fakes import FakeCalendar

    with pg.transaction():
        app = services.create_application(
            pg, clock,
            services.ApplicationInput(company="Northwind", role_title="SWE", company_domain="northwind.test"),
        )  # fmt: skip
    start = clock.now() + timedelta(days=1)
    item = CalendarItem("ev1", "confirmed", "Interview", start, start + timedelta(hours=1),
                        attendees=[ME, "jane@northwind.test"])  # fmt: skip
    cal = FakeCalendar([item], [CalendarItem("ev1", "cancelled")])
    services.sync_calendar(pg, clock, cal, clock.now() - timedelta(days=30), {ME})
    [iv] = pg.list_interviews(app.id)
    assert iv.attendees == [ME, "jane@northwind.test"]
    assert pg.get_interview_by_calendar_event("primary", "ev1").id == iv.id
    assert pg.get_calendar_sync("primary") == "token-1" and pg.last_calendar_sync_at()
    pg.save_note(InterviewNote(application_id=app.id, interview_id=iv.id, body="went ok",
                               created_at=clock.now(), updated_at=clock.now()))  # fmt: skip
    assert pg.list_notes(app.id)[0].interview_id == iv.id

    services.sync_calendar(pg, clock, cal, clock.now(), {ME})
    assert pg.get_interview(iv.id).status == InterviewStatus.CANCELLED
    assert pg.list_unassigned_interviews() == []

    # Switching to the service account: "primary" becomes the calendar's address.
    moved_ids = {i.id for i in pg.list_interviews() if i.calendar_id == cal.calendar_id}
    assert pg.rename_calendar(cal.calendar_id, "me@example.com") == len(moved_ids) > 0
    assert {i.id for i in pg.list_interviews() if i.calendar_id == "me@example.com"} == moved_ids
    assert pg.get_calendar_sync(cal.calendar_id) is None

    pg.set_oauth("google_calendar", {"refresh_token": "r"})
    assert pg.get_oauth("google_calendar") == {"refresh_token": "r"}
    pg.delete_oauth("google_calendar")
    assert pg.get_oauth("google_calendar") is None


def test_scan_bookkeeping(pg, test_url):
    from jobtracker.core.ports import SyncState

    assert pg.max_processed_uid() is None and pg.last_sync_at() is None
    pg.record_processed("<a@x>", 41, "dropped", "heuristic", "")
    pg.record_processed("<b@x>", 7, "job", "llm", "")
    assert pg.max_processed_uid() == 41
    pg.set_sync_state(SyncState("[Gmail]/All Mail", 1, 41))
    assert pg.last_sync_at() is not None
    # One scan at a time: a second connection can't take the lock until the first closes.
    other = PostgresRepo.connect(test_url)
    try:
        assert pg.try_ingest_lock() and not other.try_ingest_lock()
        pg.conn.execute("SELECT pg_advisory_unlock_all()")
        assert other.try_ingest_lock()
    finally:
        other.close()


def test_ingest_lease(pg, test_url):
    """What the ingest Lambda uses in DSQL instead of the advisory lock."""
    other = PostgresRepo.connect(test_url)
    try:
        assert pg.acquire_lease("ingest", "run-a", 60)
        assert not other.acquire_lease("ingest", "run-b", 60)  # held
        assert pg.acquire_lease("ingest", "run-a", 60)  # the holder may renew
        other.release_lease("ingest", "run-b")  # not b's to release
        assert not other.acquire_lease("ingest", "run-b", 60)
        pg.release_lease("ingest", "run-a")
        assert other.acquire_lease("ingest", "run-b", 60)
        # A lease left by a crashed run expires on its own.
        pg.conn.execute("UPDATE ingest_lease SET expires_at = now() - interval '1 second'")
        assert pg.acquire_lease("ingest", "run-c", 60)
        other.release_lease("ingest", "run-b")  # expired and taken over: stays c's
        assert not other.acquire_lease("ingest", "run-b", 60)
    finally:
        other.close()
