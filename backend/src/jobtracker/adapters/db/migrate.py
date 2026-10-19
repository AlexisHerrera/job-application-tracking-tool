"""Tiny migration runner that respects Aurora DSQL's rules.

Each statement runs in its own transaction (DSQL allows one DDL per transaction and never mixes
DDL with DML), statements are idempotent, and on DSQL `CREATE INDEX` becomes `CREATE INDEX ASYNC`.
"""

from __future__ import annotations

import logging
import re
from importlib import resources

import psycopg

log = logging.getLogger(__name__)

_COMMENT = re.compile(r"--[^\n]*")
_CREATE_INDEX = re.compile(r"^CREATE (UNIQUE )?INDEX (?!ASYNC)", re.IGNORECASE)


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


def migrate(conninfo: str, *, dsql: bool = False) -> list[str]:
    applied: list[str] = []
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version text PRIMARY KEY, applied_at timestamptz NOT NULL)"
        )
        done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for name, sql in migration_files():
            if name in done:
                continue
            for stmt in split_statements(sql):
                with conn.transaction():
                    conn.execute(adapt_for_dsql(stmt) if dsql else stmt)
            with conn.transaction():
                conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (%s, now())",
                    (name,),
                )
            log.info("applied migration %s", name)
            applied.append(name)
    return applied
