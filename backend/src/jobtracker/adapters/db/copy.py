"""Copy the local Postgres data into Aurora DSQL (or any migrated Postgres).

- The source is read in one REPEATABLE READ, READ ONLY transaction: a consistent snapshot, and
  the local database can't be modified by this code.
- Tables go in foreign-key order, in batches well under DSQL's per-transaction limits (3,000
  modified rows, 10 MiB). Each batch is its own transaction, retried on OCC conflicts.
- `ON CONFLICT DO NOTHING` by default, so re-running only adds what's missing; `overwrite`
  updates existing rows from the source instead.
- `processed_messages` and `mail_sync_state` are copied, so the ingest Lambda continues after the
  last UID the local app processed and never re-reads (or re-pays for) old mail.
- `oauth_credentials` is never copied: prod reads the calendar through the service account only,
  and the local OAuth refresh token stays on this machine. `schema_migrations` belongs to each
  database's own migration run.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from jobtracker.adapters.db.connect import is_occ_conflict

log = logging.getLogger(__name__)

# (table, primary key columns), parents before children.
TABLES: list[tuple[str, tuple[str, ...]]] = [
    ("companies", ("id",)),
    ("company_aliases", ("id",)),
    ("ats_providers", ("domain",)),
    ("campaigns", ("id",)),
    ("applications", ("id",)),
    ("events", ("id",)),
    ("interviews", ("id",)),
    ("interview_notes", ("id",)),
    ("process_steps", ("id",)),
    ("study_reports", ("id",)),
    ("processed_messages", ("message_id",)),
    ("mail_sync_state", ("mailbox",)),
    ("calendar_sync_state", ("calendar_id",)),
    ("discovery_searches", ("id",)),
    ("discovery_settings", ("key",)),
    ("discovery_companies", ("id",)),
    ("job_postings", ("id",)),
    ("discovery_runs", ("id",)),
]
# `--only discovery`: what the Discover page needs, for moving discovery to AWS (round 5) once
# the rest already lives there. job_postings.application_id may then name a local application
# that prod doesn't have: the page shows it as not linked.
DISCOVERY_TABLES = frozenset(
    {"discovery_searches", "discovery_settings", "discovery_companies", "job_postings",
     "discovery_runs"}
)  # fmt: skip
NOT_COPIED = {"oauth_credentials", "schema_migrations", "ingest_lease"}  # local-only or runtime

MAX_ROWS = 500  # DSQL allows 3,000; the docs advise a few hundred per transaction
MAX_BYTES = 4 * 1024 * 1024  # DSQL allows 10 MiB per transaction
RETRIES = 5


class CopyError(RuntimeError):
    pass


@dataclass
class TableResult:
    table: str
    source_rows: int = 0
    written: int = 0  # rows inserted (or updated with overwrite)
    target_rows: int = 0
    batches: int = 0


@dataclass
class CopyReport:
    tables: list[TableResult] = field(default_factory=list)
    mail_sync_state: list[dict] = field(default_factory=list)
    max_processed_uid: int | None = None

    @property
    def mismatched(self) -> list[str]:
        return [t.table for t in self.tables if t.target_rows < t.source_rows]


def _tables(conn: psycopg.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT table_name FROM information_schema.tables"
        " WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    ).fetchall()
    return {r["table_name"] for r in rows}


def _columns(conn: psycopg.Connection, table: str) -> list[tuple[str, str]]:
    rows = conn.execute(
        "SELECT column_name, data_type FROM information_schema.columns"
        " WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position",
        (table,),
    ).fetchall()
    return [(r["column_name"], r["data_type"]) for r in rows]


def _versions(conn: psycopg.Connection) -> set[str]:
    return {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}


def check_schemas(source: psycopg.Connection, target: psycopg.Connection) -> None:
    """Both databases must be on the same migrations, and every source table must be known here
    (a table added by a future migration has to be added to TABLES, or it would be skipped)."""
    src, dst = _versions(source), _versions(target)
    if src != dst:
        raise CopyError(
            f"migrations differ: only in source {sorted(src - dst)}, "
            f"only in target {sorted(dst - src)}. Run `jobtracker db migrate` on both first."
        )
    unknown = _tables(source) - {t for t, _ in TABLES} - NOT_COPIED
    if unknown:
        raise CopyError(f"tables not covered by the copy: {sorted(unknown)}")


def _insert_sql(table: str, cols: list[str], pk: tuple[str, ...], overwrite: bool) -> sql.SQL:
    ident = sql.Identifier
    base = sql.SQL("INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) ").format(
        ident(table),
        sql.SQL(", ").join(map(ident, cols)),
        sql.SQL(", ").join(sql.Placeholder() * len(cols)),
        sql.SQL(", ").join(map(ident, pk)),
    )
    rest = [c for c in cols if c not in pk]
    if overwrite and rest:
        sets = sql.SQL(", ").join(
            sql.SQL("{} = EXCLUDED.{}").format(ident(c), ident(c)) for c in rest
        )
        return base + sql.SQL("DO UPDATE SET ") + sets
    return base + sql.SQL("DO NOTHING")


def _size(row: tuple) -> int:
    return sum(len(str(v)) for v in row if v is not None) + 16 * len(row)


def _batches(rows: list[tuple], max_rows: int, max_bytes: int):
    batch: list[tuple] = []
    size = 0
    for row in rows:
        n = _size(row)
        if batch and (len(batch) >= max_rows or size + n > max_bytes):
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += n
    if batch:
        yield batch


def _write_batch(target: psycopg.Connection, stmt: sql.SQL, batch: list[tuple]) -> int:
    for attempt in range(RETRIES):
        try:
            with target.transaction(), target.cursor() as cur:
                cur.executemany(stmt, batch, returning=False)
                return cur.rowcount if cur.rowcount >= 0 else 0
        except psycopg.Error as err:
            if not is_occ_conflict(err) or attempt == RETRIES - 1:
                raise
            time.sleep(0.2 * 2**attempt)
    return 0


def copy_all(
    source: psycopg.Connection,
    target: psycopg.Connection,
    *,
    overwrite: bool = False,
    dry_run: bool = False,
    max_rows: int = MAX_ROWS,
    max_bytes: int = MAX_BYTES,
    only: frozenset[str] | None = None,
    progress: Callable[[str], None] = log.info,
) -> CopyReport:
    """`source` and `target` are autocommit connections with dict rows. `only` limits the copy
    to those tables."""
    check_schemas(source, target)
    report = CopyReport()
    source.read_only = True
    source.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
    with source.transaction():  # one snapshot for every table
        for table, pk in TABLES:
            if only is not None and table not in only:
                continue
            res = TableResult(table)
            report.tables.append(res)
            src_cols = _columns(source, table)
            dst_cols = {c for c, _ in _columns(target, table)}
            cols = [c for c, _ in src_cols if c in dst_cols]
            json_cols = {c for c, t in src_cols if t in {"json", "jsonb"}}
            order = sql.SQL(", ").join(map(sql.Identifier, pk))
            rows = source.execute(
                sql.SQL("SELECT {} FROM {} ORDER BY {}").format(
                    sql.SQL(", ").join(map(sql.Identifier, cols)), sql.Identifier(table), order
                )
            ).fetchall()
            res.source_rows = len(rows)
            values = [
                tuple(Jsonb(r[c]) if c in json_cols and r[c] is not None else r[c] for c in cols)
                for r in rows
            ]
            if not dry_run and values:
                stmt = _insert_sql(table, cols, pk, overwrite)
                for batch in _batches(values, max_rows, max_bytes):
                    res.written += _write_batch(target, stmt, batch)
                    res.batches += 1
            res.target_rows = _count(target, table)
            progress(
                f"{table}: {res.source_rows} rows, {res.written} written in {res.batches} "
                f"batches, {res.target_rows} in target"
            )
    report.mail_sync_state = target.execute(
        "SELECT mailbox, uidvalidity, last_uid, updated_at FROM mail_sync_state"
    ).fetchall()
    r = target.execute("SELECT max(uid) AS uid FROM processed_messages").fetchone()
    report.max_processed_uid = r["uid"] if r else None
    return report


def _count(conn: psycopg.Connection, table: str) -> int:
    r = conn.execute(sql.SQL("SELECT count(*) AS n FROM {}").format(sql.Identifier(table)))
    return r.fetchone()["n"]
