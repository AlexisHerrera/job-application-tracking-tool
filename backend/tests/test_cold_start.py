"""The API Lambda's cold start and per-request cost: one DSQL connection per container (reused,
replaced when old, broken or dirty), one boto3 client for the IAM tokens, the setup done at
init for the `api` handler only, and its timing line. Everything is stubbed: no AWS, no DSQL."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading

import psycopg
import pytest

from jobtracker.adapters.db import connect
from jobtracker.adapters.db.connect import DsqlTarget, SharedConnection
from jobtracker.settings import Settings

ENDPOINT = "abcdefghijklmnopqrstuvwxyz.dsql.us-east-1.on.aws"
IDLE = psycopg.pq.TransactionStatus.IDLE
INTRANS = psycopg.pq.TransactionStatus.INTRANS


class _Info:
    transaction_status = IDLE


class FakeConn:
    def __init__(self, n: int):
        self.n, self.closed, self.broken, self.info = n, False, False, _Info()
        self.executed: list[str] = []
        self.fail_ping = False

    def execute(self, sql, *_a):
        if self.fail_ping:
            self.broken = True
            raise psycopg.OperationalError("server closed the connection unexpectedly")
        self.executed.append(sql)

    def close(self):
        self.closed = True


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def pool():
    opened: list[FakeConn] = []

    def open_conn():
        opened.append(FakeConn(len(opened) + 1))
        return opened[-1]

    clock = Clock()
    return SharedConnection(open_conn, max_age_s=3000, ping_after_s=60, clock=clock), opened, clock


def _borrow(shared):
    conn = shared.acquire()
    shared.release(conn)
    return conn


# --- SharedConnection ---


def test_one_connection_is_reused_across_requests(pool):
    shared, opened, clock = pool
    first = _borrow(shared)
    clock.t += 5
    assert _borrow(shared) is first and _borrow(shared) is first
    assert len(opened) == 1 and not first.closed
    assert first.executed == []  # used seconds ago: no ping


def test_reconnects_before_dsql_closes_an_old_connection(pool):
    shared, opened, clock = pool
    first = _borrow(shared)
    clock.t += 2999
    assert _borrow(shared) is first
    clock.t += 1  # 3000 s after it opened
    second = _borrow(shared)
    assert second is not first and first.closed and len(opened) == 2
    clock.t += 30
    assert _borrow(shared) is second  # the age counts from the new one


@pytest.mark.parametrize("damage", ["closed", "broken", "in_transaction"])
def test_reconnects_when_the_connection_is_unusable(pool, damage):
    shared, opened, _clock = pool
    conn = shared.acquire()
    if damage == "in_transaction":
        conn.info = type("I", (), {"transaction_status": INTRANS})()
    else:
        setattr(conn, damage, True)
    shared.release(conn)  # a dirty one is dropped right away
    assert conn.closed
    fresh = _borrow(shared)
    assert fresh is not conn and len(opened) == 2


def test_a_connection_broken_while_lent_is_replaced(pool):
    shared, opened, _clock = pool
    conn = _borrow(shared)
    conn.broken = True  # e.g. the server dropped it between two requests
    assert _borrow(shared) is not conn and len(opened) == 2


def test_after_a_quiet_spell_it_pings_and_reconnects_if_gone(pool):
    shared, opened, clock = pool
    conn = _borrow(shared)
    clock.t += 120
    assert _borrow(shared) is conn and conn.executed == ["SELECT 1"]
    clock.t += 120
    conn.fail_ping = True  # the frozen container's connection is gone
    fresh = _borrow(shared)
    assert fresh is not conn and conn.closed and len(opened) == 2


def test_concurrent_requests_never_share_the_connection(pool):
    shared, opened, _clock = pool
    a = shared.acquire()
    b = shared.acquire()  # while `a` is lent out
    assert a is not b and len(opened) == 2
    shared.release(b)
    assert b.closed and not a.closed  # the extra one is closed, the shared one kept
    shared.release(a)
    assert _borrow(shared) is a


def test_release_may_come_from_another_thread(pool):
    """FastAPI can run a dependency's teardown on another threadpool thread than its setup."""
    shared, opened, _clock = pool
    conn = shared.acquire()
    t = threading.Thread(target=shared.release, args=(conn,))
    t.start()
    t.join()
    assert _borrow(shared) is conn and len(opened) == 1


def test_a_failed_connect_frees_the_slot():
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise psycopg.OperationalError("timeout")
        return FakeConn(len(calls))

    shared = SharedConnection(flaky)
    with pytest.raises(psycopg.OperationalError):
        shared.acquire()
    conn = shared.acquire()  # not stuck behind the failed one, and not a one-off
    shared.release(conn)
    assert _borrow(shared) is conn


# --- the repo factory the API uses ---


def test_api_repos_on_dsql_share_one_connection(monkeypatch):
    from jobtracker.adapters.db import repo as repo_mod

    opened = []
    monkeypatch.setattr(
        repo_mod, "connect_dsql", lambda target: opened.append(FakeConn(len(opened))) or opened[-1]
    )
    s = Settings.from_env({"APP_ENV": "prod", "DSQL_ENDPOINT": ENDPOINT, "DSQL_USER": "x_api"})
    make = repo_mod.PostgresRepo.factory(s)
    one = make()
    one.close()
    two = make()
    two.close()
    assert one.conn is two.conn and len(opened) == 1 and not opened[0].closed
    assert opened[0].prepare_threshold is None


def test_api_repos_locally_open_their_own(monkeypatch):
    from jobtracker.adapters.db import repo as repo_mod

    opened = []
    monkeypatch.setattr(
        repo_mod, "connect_url", lambda url: opened.append(FakeConn(len(opened))) or opened[-1]
    )
    make = repo_mod.PostgresRepo.factory(Settings.from_env({"APP_ENV": "local"}))
    one = make()
    one.close()
    two = make()
    assert one.conn is not two.conn and opened[0].closed


# --- IAM token signing ---


def test_token_signing_reuses_one_boto3_client(monkeypatch):
    import boto3

    sessions = []

    class FakeClient:
        def generate_db_connect_auth_token(self, **kw):
            return f"token-{kw['Hostname']}"

        generate_db_connect_admin_auth_token = generate_db_connect_auth_token

    class FakeSession:
        def __init__(self, **kw):
            sessions.append(kw)

        def client(self, name):
            assert name == "dsql"
            return FakeClient()

    monkeypatch.setattr(boto3, "Session", FakeSession)
    connect._dsql_client.cache_clear()
    try:
        target = DsqlTarget(ENDPOINT, "jobtracker_api")
        assert connect.sign_token(target) == f"token-{ENDPOINT}"
        connect.sign_token(target)
        connect.sign_token(DsqlTarget(ENDPOINT))  # admin: same client
        assert sessions == [{"profile_name": None, "region_name": "us-east-1"}]
    finally:
        connect._dsql_client.cache_clear()


def test_connect_dsql_records_its_timings(monkeypatch):
    monkeypatch.setattr(connect.psycopg, "connect", lambda **kw: FakeConn(1))
    connect.last_open_ms.clear()
    connect.connect_dsql(DsqlTarget(ENDPOINT), signer=lambda _t: "TOKEN")
    assert set(connect.last_open_ms) == {"dsql_sign", "dsql_connect"}


# --- the Lambda module ---


def _import_handlers(handler: str, **env) -> subprocess.CompletedProcess:
    code = (
        "import logging, sys; logging.basicConfig(level=logging.INFO);"
        "import jobtracker.lambdas.handlers as h;"
        "heavy = [m for m in ('jobtracker.api.app', 'fastapi', 'mangum') if m in sys.modules];"
        "print('heavy=' + ','.join(heavy)); print('ready=' + str(h._api_handler is not None))"
    )
    keep = ("PATH", "HOME", "SYSTEMROOT", "TMPDIR", "VIRTUAL_ENV")
    clean = {k: v for k, v in os.environ.items() if k in keep}
    return subprocess.run(
        [sys.executable, "-c", code],
        env={**clean, "_HANDLER": handler, **env},
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )


@pytest.mark.parametrize("name", ["ingest", "discover"])
def test_ingest_and_discover_do_not_import_the_api(name):
    out = _import_handlers(f"jobtracker.lambdas.handlers.{name}").stdout
    assert "heavy=\n" in out and "ready=False" in out


def test_the_api_function_builds_the_app_at_init():
    out = _import_handlers(
        "jobtracker.lambdas.handlers.api",
        APP_ENV="local",
        AUTH_DEV_BYPASS="true",
        DATABASE_URL="postgresql://nobody@127.0.0.1:1/none?connect_timeout=1",
    )
    assert "ready=True" in out.stdout
    # No database here: that's only a warning, the first request connects.
    assert "no DSQL connection yet" in out.stderr and "api cold start: imports=" in out.stderr


def test_cold_start_prefetches_the_keys_opens_the_connection_and_logs_it(monkeypatch, caplog):
    import jwt

    from jobtracker.adapters.db import repo as repo_mod
    from jobtracker.lambdas import handlers

    fetched, opened = [], []

    class FakeJWKClient:
        def __init__(self, url, *a, **kw):
            self.url = url

        def get_jwk_set(self, refresh=False):
            fetched.append(self.url)

    def fake_connect(target):
        connect.last_open_ms.update(dsql_sign=1.0, dsql_connect=2.0)
        opened.append(FakeConn(len(opened)))
        return opened[-1]

    monkeypatch.setattr(jwt, "PyJWKClient", FakeJWKClient)
    monkeypatch.setattr(repo_mod, "connect_dsql", fake_connect)
    monkeypatch.setattr(handlers, "_secrets_loaded", True)
    for k, v in {
        "APP_ENV": "prod",
        "DSQL_ENDPOINT": ENDPOINT,
        "DSQL_USER": "jobtracker_api",
        "COGNITO_USER_POOL_ID": "us-east-1_test",
        "COGNITO_CLIENT_ID": "client",
        "ALLOWED_EMAIL": "me@example.com",
    }.items():
        monkeypatch.setenv(k, v)
    with caplog.at_level(logging.INFO, logger="jobtracker.lambdas.handlers"):
        handler = handlers._build_api()
    line = next(r.getMessage() for r in caplog.records if "api cold start" in r.getMessage())
    for phase in ("imports", "ssm", "create_app", "jwks", "db", "dsql_sign", "dsql_connect"):
        assert f" {phase}=" in line
    assert fetched == ["https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test/.well-known/jwks.json"]  # fmt: skip
    # The first request gets the connection opened at init.
    repo = handler.app.state.make_repo()
    repo.close()
    assert repo.conn is opened[0] and len(opened) == 1
