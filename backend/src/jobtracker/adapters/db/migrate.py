"""Tiny migration runner that respects Aurora DSQL's rules.

Each statement runs in its own transaction (DSQL allows one DDL per transaction and never mixes
DDL with DML), statements are idempotent, and on DSQL `CREATE INDEX` becomes `CREATE INDEX ASYNC`.
An async index build returns a job id; the runner waits for it (`sys.wait_for_job`) so the next
statement, and the app's `ON CONFLICT` clauses, see a valid index.
"""

from __future__ import annotations

import logging
import re
import time
from importlib import resources

import psycopg

from jobtracker.adapters.db.connect import connect_url, is_occ_conflict

log = logging.getLogger(__name__)

_COMMENT = re.compile(r"--[^\n]*")
_CREATE_INDEX = re.compile(r"^CREATE (UNIQUE )?INDEX (?!ASYNC)", re.IGNORECASE)
OCC_RETRIES = 5


class MigrationError(RuntimeError):
    pass


def split_statements(sql: str) -> list[str]:
    # Our migrations never put ';' inside string literals, so a plain split is enough.
    body = _COMMENT.sub("", sql)
    return [s.strip() for s in body.split(";") if s.strip()]


def adapt_for_dsql(statement: str) -> str:
    return _CREATE_INDEX.sub(lambda m: f"CREATE {m.group(1) or ''}INDEX ASYNC ", statement)


def migration_files() -> list[tuple[str, str]]:
    root = resources.files("jobtracker.adapters.db") / "migrations"
    files = sorted((p.name, p.read_text()) for p in root.iterdir() if p.name.endswith(".sql"))
    return files


def run_statement(conn: psycopg.Connection, stmt: str, *, dsql: bool) -> None:
    """One statement in its own transaction. On DSQL, retried on OCC conflicts (a DDL bumps the
    catalog version, so the next statement can see OC001; every statement is idempotent) and an
    index build is awaited."""
    sql = adapt_for_dsql(stmt) if dsql else stmt
    for attempt in range(OCC_RETRIES):
        try:
            with conn.transaction():
                cur = conn.execute(sql)
                job_id = _job_id(cur) if dsql else None
            if job_id:
                _wait_for_job(conn, job_id, sql)
            return
        except psycopg.Error as err:
            if not (dsql and is_occ_conflict(err)) or attempt == OCC_RETRIES - 1:
                raise
            log.info("OCC conflict, retrying: %s", sql[:60])
            time.sleep(0.2 * 2**attempt)


def _job_id(cur: psycopg.Cursor) -> str | None:
    """`CREATE INDEX ASYNC` returns one row with a `job_id`. With IF NOT EXISTS and an existing
    index there's no job (no result set)."""
    if cur.description is None or cur.description[0].name != "job_id":
        return None
    row = cur.fetchone()
    if row is None:
        return None
    return row["job_id"] if isinstance(row, dict) else row[0]


_JOB_ID = re.compile(r"^[a-z0-9]{1,64}$")


def _wait_for_job(conn: psycopg.Connection, job_id: str, sql: str) -> None:
    """`sys.wait_for_job` is a procedure: `CALL` it, and it answers one row, `succeeded`. The id
    comes from DSQL itself; it's checked anyway because it goes into the statement as a literal."""
    if not _JOB_ID.match(job_id):
        raise MigrationError(f"unexpected job id from DSQL: {job_id!r}")
    row = conn.execute(f"CALL sys.wait_for_job('{job_id}')").fetchone()
    ok = _first(row) if row else False
    if not ok:
        detail = conn.execute(
            "SELECT status, details FROM sys.jobs WHERE job_id = %s", (job_id,)
        ).fetchone()
        raise MigrationError(
            f"index build {job_id} failed ({detail}); drop the INVALID index and re-run: {sql[:80]}"
        )


def migrate_connection(conn: psycopg.Connection, *, dsql: bool = False) -> list[str]:
    """Apply pending migrations on an autocommit connection."""
    applied: list[str] = []
    run_statement(
        conn,
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " version text PRIMARY KEY, applied_at timestamptz NOT NULL)",
        dsql=dsql,
    )
    done = {_first(r) for r in conn.execute("SELECT version FROM schema_migrations")}
    for name, sql in migration_files():
        if name in done:
            continue
        for stmt in split_statements(sql):
            run_statement(conn, stmt, dsql=dsql)
        with conn.transaction():
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (%s, now())",
                (name,),
            )
        log.info("applied migration %s", name)
        applied.append(name)
    return applied


def migrate(conninfo: str) -> list[str]:
    """Local Postgres by URL."""
    with connect_url(conninfo) as conn:
        return migrate_connection(conn)


def _first(row) -> object:
    return next(iter(row.values())) if isinstance(row, dict) else row[0]
