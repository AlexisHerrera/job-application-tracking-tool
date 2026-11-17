"""`jobtracker db copy-to-dsql` logic, Postgres → Postgres. Two throwaway databases on the
compose server (never the real `jobtracker` one); skipped when Postgres isn't running."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import psycopg
import pytest

from jobtracker.adapters.db.connect import connect_url
from jobtracker.adapters.db.copy import NOT_COPIED, TABLES, CopyError, copy_all
from jobtracker.adapters.db.migrate import migrate
from jobtracker.adapters.db.repo import PostgresRepo
from jobtracker.core import services
from jobtracker.core.ports import SyncState
from tests.conftest import no_postgres
from tests.test_postgres import ADMIN_URL

SRC, DST = "jobtracker_copy_src", "jobtracker_copy_dst"


@pytest.fixture(scope="module")
def urls():
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=2)
    except psycopg.OperationalError:
        no_postgres()
    base = ADMIN_URL.rsplit("/", 1)[0]
    with admin:
        for db in (SRC, DST):
            admin.execute(f"DROP DATABASE IF EXISTS {db} WITH (FORCE)")
            admin.execute(f"CREATE DATABASE {db}")
    src, dst = f"{base}/{SRC}", f"{base}/{DST}"
    migrate(src)
    migrate(dst)
    yield src, dst
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        for db in (SRC, DST):
            admin.execute(f"DROP DATABASE IF EXISTS {db} WITH (FORCE)")


def _seed(url: str, clock) -> uuid.UUID:
    repo = PostgresRepo.connect(url)
    try:
        app = services.create_application(
            repo,
            clock,
            services.ApplicationInput(
                company="Acme", role_title="Backend", stack=["python", "postgres"]
            ),
        )
        for i in range(7):
            repo.record_processed(f"<m{i}@x>", 100 + i, "dropped", "heuristic", "")
        repo.set_sync_state(SyncState("[Gmail]/All Mail", 9, 106))
        repo.set_oauth("google_calendar", {"refresh_token": "local-only"})
        return app.id
    finally:
        repo.close()


def test_copy_everything_but_the_oauth_login(urls, clock):
    src, dst = urls
    app_id = _seed(src, clock)
    with connect_url(src) as s, connect_url(dst) as d:
        report = copy_all(s, d, max_rows=3)  # small batches: several per table
        by = {t.table: t for t in report.tables}
        assert by["processed_messages"].source_rows == 7
        assert by["processed_messages"].batches == 3
        assert report.mismatched == []
        assert report.max_processed_uid == 106
        assert [(r["mailbox"], r["last_uid"]) for r in report.mail_sync_state] == [
            ("[Gmail]/All Mail", 106)
        ]
        assert d.execute("SELECT count(*) AS n FROM oauth_credentials").fetchone()["n"] == 0
        stack = d.execute("SELECT stack FROM applications WHERE id = %s", (app_id,)).fetchone()
        assert stack["stack"] == ["python", "postgres"]  # jsonb survives

        # Re-running adds nothing; overwrite brings local edits across.
        again = copy_all(s, d)
        assert sum(t.written for t in again.tables) == 0
        s.execute("UPDATE mail_sync_state SET last_uid = 200")
        assert copy_all(s, d).mail_sync_state[0]["last_uid"] == 106
        assert copy_all(s, d, overwrite=True).mail_sync_state[0]["last_uid"] == 200


def test_source_is_read_only(urls):
    src, dst = urls
    with connect_url(src) as s, connect_url(dst) as d:
        copy_all(s, d, dry_run=True)
        assert s.read_only is True
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction), s.transaction():
            s.execute("DELETE FROM companies")


def test_refuses_mismatched_migrations(urls):
    src, dst = urls
    with connect_url(src) as s, connect_url(dst) as d:
        d.execute(
            "INSERT INTO schema_migrations VALUES ('9999_future.sql', %s)", (datetime.now(UTC),)
        )
        try:
            with pytest.raises(CopyError, match="migrations differ"):
                copy_all(s, d)
        finally:
            d.execute("DELETE FROM schema_migrations WHERE version = '9999_future.sql'")


def test_every_table_is_covered(urls):
    """A new migration's table must be added to TABLES (or to NOT_COPIED on purpose)."""
    src, _ = urls
    with connect_url(src) as s:
        rows = s.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        ).fetchall()
    assert {r["table_name"] for r in rows} == {t for t, _ in TABLES} | NOT_COPIED


def test_only_discovery_leaves_the_applications_alone(urls, clock):
    from jobtracker.adapters.db.copy import DISCOVERY_TABLES

    src, dst = urls
    app_id = _seed(src, clock)
    repo = PostgresRepo.connect(src)
    try:
        repo.set_discovery_setting("criteria", "Lives in Buenos Aires")
    finally:
        repo.close()
    with connect_url(src) as s, connect_url(dst) as d:
        report = copy_all(s, d, only=DISCOVERY_TABLES)
        assert {t.table for t in report.tables} == DISCOVERY_TABLES
        assert d.execute("SELECT count(*) AS n FROM applications WHERE id = %s", (app_id,)).fetchone()["n"] == 0  # fmt: skip
        row = d.execute("SELECT value FROM discovery_settings WHERE key = 'criteria'").fetchone()
        assert row["value"] == "Lives in Buenos Aires"
