"""Database roles for the Lambdas on Aurora DSQL (run as `admin` after migrating).

Each Lambda's IAM role maps to its own login role (`AWS IAM GRANT`) with DML on the app's tables
only: no DDL, no grants. `ALTER DEFAULT PRIVILEGES` gives them tables that later migrations
create. Every step checks first, so re-running is harmless. DSQL only: local Postgres has no
`AWS IAM GRANT`.

DSQL's `public` schema belongs to `pg_database_owner` and refuses grants ("feature not supported
on system entity"), but already gives every role USAGE, so that grant is only issued if a role
lacks it. The default privileges are set for `admin`'s new tables in any schema, without naming
`public`.
"""

from __future__ import annotations

import logging
import re

import psycopg

from jobtracker.adapters.db.migrate import run_statement

log = logging.getLogger(__name__)

_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
_ARN = re.compile(r"^arn:aws:iam::\d{12}:role/[\w+=,.@/-]+$")
PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"


def login_statements(role: str, arn: str, *, exists: bool, mapped: bool) -> list[str]:
    if not _ROLE.match(role):
        raise ValueError(f"bad role name {role!r}")
    if not _ARN.match(arn):
        raise ValueError(f"bad IAM role ARN {arn!r}")
    stmts = []
    if not exists:
        stmts.append(f"CREATE ROLE {role} WITH LOGIN")
    if not mapped:
        stmts.append(f"AWS IAM GRANT {role} TO '{arn}'")
    return stmts


def table_statements(role: str, *, has_usage: bool) -> list[str]:
    if not _ROLE.match(role):
        raise ValueError(f"bad role name {role!r}")
    usage = [] if has_usage else [f"GRANT USAGE ON SCHEMA public TO {role}"]
    return [
        *usage,
        f"GRANT {PRIVILEGES} ON ALL TABLES IN SCHEMA public TO {role}",
        f"ALTER DEFAULT PRIVILEGES GRANT {PRIVILEGES} ON TABLES TO {role}",
    ]


def grant_statements(role: str, arn: str, *, exists: bool, mapped: bool) -> list[str]:
    """Everything for a brand-new role (schema usage comes from PUBLIC on DSQL)."""
    return login_statements(role, arn, exists=exists, mapped=mapped) + table_statements(
        role, has_usage=True
    )


def ensure_app_roles(conn: psycopg.Connection, roles: dict[str, str]) -> list[str]:
    """`roles` = {db role: IAM role ARN}. Returns the statements it ran."""
    ran: list[str] = []
    for role, arn in roles.items():
        exists = (
            conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone()
            is not None
        )
        mapped = (
            conn.execute(
                "SELECT 1 FROM sys.iam_pg_role_mappings WHERE pg_role_name = %s AND arn = %s",
                (role, arn),
            ).fetchone()
            is not None
        )
        for stmt in login_statements(role, arn, exists=exists, mapped=mapped):
            _run(conn, stmt, ran)
        usage = conn.execute(
            "SELECT has_schema_privilege(%s, 'public', 'USAGE') AS ok", (role,)
        ).fetchone()
        for stmt in table_statements(role, has_usage=bool(usage and _ok(usage))):
            _run(conn, stmt, ran)
    return ran


def _ok(row) -> object:
    return row["ok"] if isinstance(row, dict) else row[0]


def _run(conn: psycopg.Connection, stmt: str, ran: list[str]) -> None:
    run_statement(conn, stmt, dsql=True)
    log.info("%s", stmt)
    ran.append(stmt)
