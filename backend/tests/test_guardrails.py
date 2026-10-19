"""Architecture and DSQL rules, enforced as tests."""

import ast
import re
from pathlib import Path

from jobtracker.adapters.db.migrate import adapt_for_dsql, migration_files, split_statements

CORE = Path(__file__).parents[1] / "src" / "jobtracker" / "core"
FORBIDDEN = {"boto3", "botocore", "anthropic", "psycopg", "fastapi", "mangum", "imaplib"}


def test_core_is_pure():
    for path in CORE.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for name in names:
                assert name.split(".")[0] not in FORBIDDEN, f"{path.name} imports {name}"
                assert not name.startswith("jobtracker.adapters"), f"{path.name} imports {name}"


DSQL_FORBIDDEN = [
    (r"\bTRUNCATE\b", "TRUNCATE"),
    (r"\bTEMP(ORARY)?\s+TABLE\b", "temporary tables"),
    (r"\bCREATE\s+TRIGGER\b", "triggers"),
    (r"\bSERIAL\b|\bBIGSERIAL\b", "serial columns"),
    (r"\w\[\]", "array columns"),
    (r"\bON DELETE CASCADE\b", "cascades"),
    (r"\bLANGUAGE\s+plpgsql\b", "PL/pgSQL"),
]


def test_migrations_are_dsql_compatible():
    for name, sql in migration_files():
        for stmt in split_statements(sql):
            for pattern, what in DSQL_FORBIDDEN:
                assert not re.search(pattern, stmt, re.IGNORECASE), (
                    f"{name}: {what} not supported on DSQL"
                )
            if stmt.upper().startswith("CREATE"):
                assert "IF NOT EXISTS" in stmt.upper(), (
                    f"{name}: DDL must be idempotent: {stmt[:60]}"
                )


def test_dsql_index_rewrite():
    assert (
        adapt_for_dsql("CREATE UNIQUE INDEX IF NOT EXISTS x ON t (a)")
        == "CREATE UNIQUE INDEX ASYNC IF NOT EXISTS x ON t (a)"
    )
    assert (
        adapt_for_dsql("CREATE INDEX IF NOT EXISTS x ON t (a)")
        == "CREATE INDEX ASYNC IF NOT EXISTS x ON t (a)"
    )
    assert adapt_for_dsql("CREATE TABLE t (a int)") == "CREATE TABLE t (a int)"
