"""Phase 3 adapters without AWS: DSQL connection settings, the migration runner's DSQL mode, DB
roles, SSM secrets, and the scan button invoking the ingest Lambda. Everything is stubbed."""

from __future__ import annotations

import io
import json

import psycopg
import pytest
from botocore.exceptions import ClientError, ReadTimeoutError
from fastapi.testclient import TestClient

from jobtracker.adapters import ssm_secrets
from jobtracker.adapters.db.connect import DsqlTarget, dsql_kwargs, is_occ_conflict
from jobtracker.adapters.db.dsql_roles import ensure_app_roles, grant_statements
from jobtracker.adapters.db.migrate import MigrationError, run_statement
from jobtracker.adapters.lambda_ingest import (
    IngestBusy,
    IngestFailed,
    IngestStillRunning,
    LambdaIngest,
)
from jobtracker.api.app import create_app
from jobtracker.settings import Settings
from tests.fakes import MemoryRepo

ENDPOINT = "abcdefghijklmnopqrstuvwxyz.dsql.us-east-1.on.aws"
ARN = "arn:aws:iam::630773215521:role/jobtracker-api-lambda"
FEDERATION_ENV = {
    "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_test",
    "ANTHROPIC_ORGANIZATION_ID": "00000000-0000-0000-0000-000000000000",
    "ANTHROPIC_SERVICE_ACCOUNT_ID": "svac_test",
}


# --- DSQL connection ---


def test_region_comes_from_the_endpoint():
    assert DsqlTarget(ENDPOINT).aws_region == "us-east-1"
    assert DsqlTarget(ENDPOINT, region="eu-west-1").aws_region == "eu-west-1"
    with pytest.raises(ValueError):
        _ = DsqlTarget("localhost").aws_region


def test_dsql_kwargs_use_the_token_and_verify_tls():
    kw = dsql_kwargs(DsqlTarget(ENDPOINT, "jobtracker_api"), "TOKEN")
    assert kw["password"] == "TOKEN" and kw["user"] == "jobtracker_api"
    assert kw["dbname"] == "postgres" and kw["host"] == ENDPOINT
    assert kw["sslmode"] == "verify-full" and kw["sslrootcert"].endswith(".pem")


def test_settings_pick_dsql_when_configured(monkeypatch):
    from jobtracker.adapters.db import repo as repo_mod

    seen = {}
    monkeypatch.setattr(repo_mod, "connect_dsql", lambda target: seen.setdefault("t", target))
    s = Settings.from_env({"APP_ENV": "prod", "DSQL_ENDPOINT": ENDPOINT, "DSQL_USER": "x_app"})
    repo_mod.PostgresRepo.open(s)
    assert seen["t"] == DsqlTarget(ENDPOINT, "x_app")


def test_occ_conflicts_are_recognised():
    assert is_occ_conflict(psycopg.errors.SerializationFailure("OC000"))
    assert not is_occ_conflict(psycopg.errors.UniqueViolation("dup"))


# --- migration runner on DSQL (fake connection) ---


class _Col:
    def __init__(self, name):
        self.name = name


class _Cursor:
    def __init__(self, rows, cols):
        self._rows = rows
        self.description = [_Col(c) for c in cols] if cols else None

    def fetchone(self):
        return self._rows[0] if self._rows else None


class _Tx:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeDsql:
    """Answers like DSQL: CREATE INDEX ASYNC returns a job id; wait_for_job returns `job_ok`."""

    def __init__(self, job_ok=True, conflicts=0, roles=(), mapped=(), job_id="job1"):
        self.sql: list[str] = []
        self.job_id = job_id
        self.public_usage = True
        self.job_ok = job_ok
        self.conflicts = conflicts
        self.roles, self.mapped = set(roles), set(mapped)

    def transaction(self):
        return _Tx()

    def execute(self, sql, params=()):
        self.sql.append(sql)
        if self.conflicts:
            self.conflicts -= 1
            raise psycopg.errors.SerializationFailure("schema has been updated (OC001)")
        if "INDEX ASYNC" in sql:
            return _Cursor([{"job_id": self.job_id}], ["job_id"])
        if "wait_for_job" in sql:
            return _Cursor([{"succeeded": self.job_ok}], ["succeeded"])
        if "FROM sys.jobs" in sql:
            return _Cursor([{"status": "failed", "details": "dup"}], ["status", "details"])
        if "FROM pg_roles" in sql:
            return _Cursor([{"x": 1}] if params[0] in self.roles else [], ["x"])
        if "iam_pg_role_mappings" in sql:
            return _Cursor([{"x": 1}] if params in self.mapped else [], ["x"])
        if "has_schema_privilege" in sql:  # DSQL: PUBLIC has USAGE on public
            return _Cursor([{"ok": self.public_usage}], ["ok"])
        return _Cursor([], [])


def test_dsql_index_build_is_awaited():
    conn = FakeDsql()
    run_statement(conn, "CREATE INDEX IF NOT EXISTS i ON t (a)", dsql=True)
    assert conn.sql == [
        "CREATE INDEX ASYNC IF NOT EXISTS i ON t (a)",
        "CALL sys.wait_for_job('job1')",  # a procedure, as DSQL showed on the first migrate
    ]


def test_odd_job_id_is_refused():
    with pytest.raises(MigrationError, match="unexpected job id"):
        run_statement(
            FakeDsql(job_id="x'); DROP TABLE t; --"), "CREATE INDEX i ON t (a)", dsql=True
        )


def test_failed_index_build_stops_the_migration():
    with pytest.raises(MigrationError, match="INVALID index"):
        run_statement(
            FakeDsql(job_ok=False), "CREATE UNIQUE INDEX IF NOT EXISTS i ON t (a)", dsql=True
        )


def test_occ_conflict_is_retried_on_dsql_only(monkeypatch):
    monkeypatch.setattr("jobtracker.adapters.db.migrate.time.sleep", lambda _s: None)
    conn = FakeDsql(conflicts=2)
    run_statement(conn, "CREATE TABLE IF NOT EXISTS t (a int)", dsql=True)
    assert conn.sql.count("CREATE TABLE IF NOT EXISTS t (a int)") == 3
    with pytest.raises(psycopg.errors.SerializationFailure):
        run_statement(FakeDsql(conflicts=1), "CREATE TABLE IF NOT EXISTS t (a int)", dsql=False)


def test_roles_are_created_once():
    stmts = grant_statements("jobtracker_api", ARN, exists=False, mapped=False)
    assert stmts[:2] == [
        "CREATE ROLE jobtracker_api WITH LOGIN",
        f"AWS IAM GRANT jobtracker_api TO '{ARN}'",
    ]
    assert any(s.startswith("ALTER DEFAULT PRIVILEGES") for s in stmts)
    # DSQL refuses grants on its `public` schema ("system entity"): never issued when PUBLIC
    # already has USAGE, and default privileges don't name the schema.
    assert not any("ON SCHEMA public" in s or "IN SCHEMA public GRANT" in s for s in stmts)
    conn = FakeDsql(roles={"jobtracker_api"}, mapped={("jobtracker_api", ARN)})
    ran = ensure_app_roles(conn, {"jobtracker_api": ARN})
    assert not any(s.startswith(("CREATE ROLE", "AWS IAM GRANT")) for s in ran)
    assert ran == [
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobtracker_api",
        "ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobtracker_api",
    ]
    no_usage = FakeDsql(roles={"jobtracker_api"}, mapped={("jobtracker_api", ARN)})
    no_usage.public_usage = False
    assert ensure_app_roles(no_usage, {"jobtracker_api": ARN})[0].startswith("GRANT USAGE")
    with pytest.raises(ValueError):
        grant_statements("x; DROP TABLE y", ARN, exists=False, mapped=False)
    with pytest.raises(ValueError):
        grant_statements("ok", "arn:aws:iam::1:role/x'; --", exists=False, mapped=False)


# --- SSM secrets ---


class FakeSsm:
    def __init__(self, params):
        self.params = params
        self.calls = []
        self.put = []

    def get_parameters(self, Names, WithDecryption):
        self.calls.append(Names)
        assert WithDecryption
        return {
            "Parameters": [{"Name": n, "Value": self.params[n]} for n in Names if n in self.params],
            "InvalidParameters": [n for n in Names if n not in self.params],
        }

    def put_parameter(self, **kw):
        self.put.append(kw)


def test_secrets_load_into_the_environment():
    ssm = FakeSsm({"/p/GOOGLE_SERVICE_ACCOUNT_KEY": "key-1"})
    env = {
        "SSM_PARAMETER_PREFIX": "/p/",
        "SSM_SECRETS": "GOOGLE_SERVICE_ACCOUNT_KEY, GMAIL_APP_PASSWORD",
    }
    missing = ssm_secrets.load_into_env(env, client=ssm)
    assert env["GOOGLE_SERVICE_ACCOUNT_KEY"] == "key-1" and "GMAIL_APP_PASSWORD" not in env
    assert missing == ["GMAIL_APP_PASSWORD"]
    assert ssm_secrets.load_into_env({}, client=ssm) == [] and len(ssm.calls) == 1


def test_secrets_are_pushed_as_securestrings():
    ssm = FakeSsm({})
    assert ssm_secrets.push(ssm, "/p/", {"GMAIL_APP_PASSWORD": "pw"}) == ["/p/GMAIL_APP_PASSWORD"]
    assert ssm.put[0]["Type"] == "SecureString" and ssm.put[0]["KeyId"] == "alias/aws/ssm"
    assert ssm.put[0]["Overwrite"] is True


# --- scan button → ingest Lambda ---


class FakeLambda:
    def __init__(self, result=None, error=None, function_error=None):
        self.result, self.error, self.function_error = result, error, function_error
        self.calls = []

    def invoke(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        resp = {"Payload": io.BytesIO(json.dumps(self.result).encode()), "StatusCode": 200}
        if self.function_error:
            resp["FunctionError"] = self.function_error
        return resp


def test_lambda_ingest_maps_outcomes():
    ok = FakeLambda({"seen": 2, "job": 1})
    assert LambdaIngest("ingest", client=ok)() == {"seen": 2, "job": 1}
    assert ok.calls[0]["InvocationType"] == "RequestResponse"
    assert json.loads(ok.calls[0]["Payload"]) == {"trigger": "scan"}
    with pytest.raises(IngestBusy):  # another run holds the lease
        LambdaIngest("ingest", client=FakeLambda({"trigger": "scan", "busy": True}))()
    throttled = ClientError({"Error": {"Code": "TooManyRequestsException"}}, "Invoke")
    with pytest.raises(IngestFailed, match="throttling"):
        LambdaIngest("ingest", client=FakeLambda(error=throttled))()
    with pytest.raises(IngestStillRunning):
        LambdaIngest("ingest", client=FakeLambda(error=ReadTimeoutError(endpoint_url="x")))()
    failed = FakeLambda({"errorMessage": "boom"}, function_error="Unhandled")
    with pytest.raises(IngestFailed, match="boom"):
        LambdaIngest("ingest", client=failed)()


def _prod_client(remote):
    """The API with the scan wired to a (fake) ingest Lambda, as in prod. Auth is bypassed
    here; test_prod_api_without_jwt_is_401 covers the real verifier."""
    settings = Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "true"})
    return TestClient(create_app(settings, repo_factory=MemoryRepo, remote_scan=remote))


def test_prod_scan_invokes_the_ingest_lambda():
    report = {"seen": 3, "job": 1, "created": 1, "unassigned": 0, "errors": 0,
              "started_fresh": False, "llm_calls": 2, "counts": {"job": 1}, "calendar": None}  # fmt: skip
    client = _prod_client(lambda: report)
    assert client.get("/api/scan").json()["available"] is True
    body = client.post("/api/scan", json={}).json()
    assert body == {"seen": 3, "job": 1, "created": 1, "unassigned": 0, "errors": 0,
                    "started_fresh": False, "llm_calls": 2, "running": False}  # fmt: skip


@pytest.mark.parametrize(
    ("error", "status"), [(IngestBusy(), 409), (IngestFailed("imap down"), 502)]
)
def test_prod_scan_errors(error, status):
    def remote():
        raise error

    r = _prod_client(remote).post("/api/scan", json={})
    assert r.status_code == status


def test_prod_scan_still_running():
    def remote():
        raise IngestStillRunning()

    r = _prod_client(remote).post("/api/scan", json={})
    assert r.status_code == 200 and r.json()["running"] is True


def test_prod_api_without_jwt_is_401():
    settings = Settings.from_env(
        {"APP_ENV": "prod", "ALLOWED_EMAIL": "me@example.com",
         "COGNITO_USER_POOL_ID": "us-east-1_Test", "COGNITO_CLIENT_ID": "client"}
    )  # fmt: skip
    client = TestClient(create_app(settings, repo_factory=MemoryRepo, remote_scan=lambda: {}))
    assert client.post("/api/scan", json={}).status_code == 401
    assert client.get("/api/applications").status_code == 401


# --- Discover buttons → discover Lambda ---


def test_lambda_discover_starts_an_async_run():
    from jobtracker.adapters.lambda_discover import DiscoverStartFailed, LambdaDiscover

    fake = FakeLambda()
    fake.invoke = lambda **kw: fake.calls.append(kw) or {"StatusCode": 202}
    LambdaDiscover("discover", client=fake)({"action": "run", "score": True})
    assert fake.calls[0]["InvocationType"] == "Event"
    assert json.loads(fake.calls[0]["Payload"]) == {"trigger": "page", "action": "run", "score": True}  # fmt: skip
    throttled = ClientError({"Error": {"Code": "TooManyRequestsException"}}, "Invoke")
    with pytest.raises(DiscoverStartFailed, match="throttling"):
        LambdaDiscover("discover", client=FakeLambda(error=throttled))({})


def test_prod_discover_buttons_start_the_lambda_and_follow_its_progress():
    from datetime import UTC, datetime

    from jobtracker.core import discovery, discovery_progress

    repo, started = MemoryRepo(), []
    settings = Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "true"})
    client = TestClient(
        create_app(settings, repo_factory=lambda: repo, remote_discover=started.append)
    )
    assert client.get("/api/discover/settings").json()["can_run"] is True
    assert client.get("/api/discover/progress").json() == {"running": False}

    r = client.post("/api/discover/run", json={"score": False})
    assert r.status_code == 202 and started == [{"action": "run", "score": False, "collect": True}]
    progress = client.get("/api/discover/progress").json()
    assert progress["running"] is True and progress["kind"] == "run"
    assert client.post("/api/discover/run", json={}).status_code == 409  # one at a time
    assert client.post("/api/discover/rescore", json={}).status_code == 409

    now = datetime.now(UTC)  # the Lambda finishes and writes its last report
    done = discovery.Progress("run", now, phase="done", new=4, finished_at=now)
    discovery_progress.save(repo, done, now)
    assert client.get("/api/discover/progress").json()["running"] is False
    r = client.post("/api/discover/rescore", json={"include_hidden": True})
    assert r.status_code == 202 and started[-1] == {"action": "rescore", "include_hidden": True}


def test_occ_conflict_becomes_409():
    settings = Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "true"})

    class Conflicting(MemoryRepo):
        def list_applications(self):
            raise psycopg.errors.SerializationFailure("change conflicts (OC000)")

    client = TestClient(create_app(settings, repo_factory=Conflicting))
    r = client.get("/api/applications")
    assert r.status_code == 409 and "Try again" in r.json()["detail"]


# --- Lambda handlers ---


def test_ingest_refuses_to_run_without_secrets(monkeypatch):
    from jobtracker.lambdas import handlers
    from jobtracker.settings import ConfigError

    monkeypatch.setattr(handlers, "_secrets_loaded", True)
    for k in ("GMAIL_ADDRESS", "GMAIL_APP_PASSWORD", "ANTHROPIC_API_KEY", *FEDERATION_ENV):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("APP_ENV", "prod")
    with pytest.raises(ConfigError, match="push-secrets"):
        handlers.ingest({"trigger": "schedule"}, None)


class _LeaseRepo:
    def __init__(self, free=True):
        self.free, self.calls = free, []

    def acquire_lease(self, name, holder, seconds):
        self.calls.append(("acquire", name, holder, seconds))
        return self.free

    def release_lease(self, name, holder):
        self.calls.append(("release", name, holder))

    def close(self):
        self.calls.append(("close",))


class _Context:
    aws_request_id = "req-1"

    def get_remaining_time_in_millis(self):
        return 600_000


@pytest.fixture
def ingest_env(monkeypatch):
    from jobtracker.lambdas import handlers

    monkeypatch.setattr(handlers, "_secrets_loaded", True)
    monkeypatch.setenv("APP_ENV", "prod")
    monkeypatch.setenv("GMAIL_ADDRESS", "me@example.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "not-a-real-password")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    for k, v in FEDERATION_ENV.items():  # like prod: no key, federation
        monkeypatch.setenv(k, v)

    def use(repo):
        monkeypatch.setattr("jobtracker.adapters.db.repo.PostgresRepo.open", lambda _s: repo)

    return handlers, use


def test_ingest_skips_without_reading_mail_when_the_lease_is_taken(ingest_env, monkeypatch):
    handlers, use = ingest_env
    repo = _LeaseRepo(free=False)
    use(repo)

    def no_imap(*_a, **_k):
        raise AssertionError("must not connect to Gmail")

    monkeypatch.setattr("jobtracker.adapters.imap_gmail.GmailImapSource", no_imap)
    assert handlers.ingest({"trigger": "scan"}, _Context()) == {"trigger": "scan", "busy": True}
    # The lease outlives the invocation's remaining time by a minute.
    assert repo.calls == [("acquire", "ingest", "req-1", 660.0), ("close",)]


def test_ingest_releases_the_lease_when_gmail_fails(ingest_env, monkeypatch):
    handlers, use = ingest_env
    repo = _LeaseRepo()
    use(repo)

    def imap_down(*_a, **_k):
        raise OSError("imap down")

    monkeypatch.setattr("jobtracker.adapters.imap_gmail.GmailImapSource", imap_down)
    with pytest.raises(OSError):
        handlers.ingest({"trigger": "schedule"}, _Context())
    assert [c[0] for c in repo.calls] == ["acquire", "release", "close"]


class _DiscoverRepo(MemoryRepo):
    """The in-memory repo with the lease calls the discover handler makes."""

    def __init__(self, free=True):
        super().__init__()
        self.free, self.lease_calls = free, []

    def acquire_lease(self, name, holder, seconds):
        self.lease_calls.append(("acquire", name))
        return self.free

    def release_lease(self, name, holder):
        self.lease_calls.append(("release", name))

    def close(self):
        self.lease_calls.append(("close",))


def test_discover_takes_its_own_lease_and_runs(ingest_env, monkeypatch):
    from jobtracker.core.models import DiscoverySearch
    from tests.fakes import FakeLLM, FakeSource, posting

    handlers, use = ingest_env
    busy = _DiscoverRepo(free=False)
    use(busy)
    assert handlers.discover({}, _Context()) == {"action": "run", "trigger": "schedule", "busy": True}  # fmt: skip
    assert busy.lease_calls == [("acquire", "discover"), ("close",)]

    repo = _DiscoverRepo()
    repo.save_search(DiscoverySearch("workable", "w", {"query": "engineer"}))
    use(repo)
    monkeypatch.setattr("jobtracker.adapters.job_sources.discovery_sources", lambda: {"workable": FakeSource([posting()])})  # fmt: skip
    monkeypatch.setattr("jobtracker.adapters.ats_boards.AtsBoards", lambda: None)
    monkeypatch.setattr("jobtracker.adapters.anthropic_llm.AnthropicLLM.from_settings", lambda *_a: FakeLLM())  # fmt: skip
    out = handlers.discover({"trigger": "page", "action": "run"}, _Context())
    assert (out["trigger"], out["new"], out["llm_calls"]) == ("page", 1, 1)
    assert repo.get_discovery_setting("progress")["phase"] == "done"
    assert [c[0] for c in repo.lease_calls] == ["acquire", "release", "close"]


def test_discover_digest_needs_no_lease(ingest_env, monkeypatch):
    handlers, use = ingest_env
    repo = _DiscoverRepo()
    use(repo)
    sent = []
    monkeypatch.setattr("jobtracker.adapters.smtp_mail.GmailSmtpMailer.send", lambda self, *a: sent.append(a))  # fmt: skip
    out = handlers.discover({"action": "digest"}, _Context())
    assert out == {"action": "digest", "sent": False, "postings": 0, "reason": "nothing new to send"}  # fmt: skip
    assert sent == [] and repo.lease_calls == [("close",)]
