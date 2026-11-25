"""Database connections: a plain URL locally, IAM token auth on Aurora DSQL.

DSQL has no passwords. Each connection signs a short-lived token with the caller's AWS
credentials (the Lambda role, or your SSO profile from the CLI) and sends it as the password. A
token only has to be valid when the connection opens. DSQL closes any connection after 60
minutes: the ingest and discover runs open one per run, and the API keeps one per container
(`SharedConnection`) that it replaces well before that.
"""

from __future__ import annotations

import contextlib
import functools
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row

ADMIN = "admin"  # DSQL's built-in role: DDL and grants. The Lambdas use their own roles.
TOKEN_SECONDS = 900  # only needs to outlive the handshake

log = logging.getLogger(__name__)

# How long the last DSQL connection took to open, for the API's cold-start log line.
last_open_ms: dict[str, float] = {}

TokenSigner = Callable[["DsqlTarget"], str]


@dataclass(frozen=True)
class DsqlTarget:
    endpoint: str  # <cluster id>.dsql.<region>.on.aws
    user: str = ADMIN
    region: str | None = None  # defaults to the one in the endpoint
    profile: str | None = None  # AWS profile for the CLI; None = default chain (Lambda role)

    @property
    def aws_region(self) -> str:
        if self.region:
            return self.region
        parts = self.endpoint.split(".")
        if len(parts) >= 3 and parts[1] == "dsql":
            return parts[2]
        raise ValueError(f"can't tell the region from DSQL endpoint {self.endpoint!r}")


@functools.cache
def _dsql_client(profile: str | None, region: str):
    """One client per process: building a Session and a client costs tens of ms, every request.
    A client is thread-safe and refreshes its credentials itself."""
    import boto3

    return boto3.Session(profile_name=profile, region_name=region).client("dsql")


def sign_token(target: DsqlTarget) -> str:
    """Local SigV4 signing: no network call. Expired credentials still produce a token; the
    connection is what fails then."""
    client = _dsql_client(target.profile, target.aws_region)
    sign = (
        client.generate_db_connect_admin_auth_token
        if target.user == ADMIN
        else client.generate_db_connect_auth_token
    )
    return sign(Hostname=target.endpoint, Region=target.aws_region, ExpiresIn=TOKEN_SECONDS)


def dsql_kwargs(target: DsqlTarget, token: str) -> dict:
    import certifi

    return {
        "host": target.endpoint,
        "port": 5432,
        "dbname": "postgres",  # DSQL has exactly one database
        "user": target.user,
        "password": token,
        # Verify the server certificate against a bundle that includes Amazon's roots, the same
        # on a Mac and in Lambda (the psycopg wheel's own OpenSSL may not find a system store).
        "sslmode": "verify-full",
        "sslrootcert": certifi.where(),
        "connect_timeout": 10,
        "application_name": "jobtracker",
    }


def connect_dsql(
    target: DsqlTarget, *, autocommit: bool = True, signer: TokenSigner = sign_token
) -> psycopg.Connection:
    t0 = time.perf_counter()
    token = signer(target)
    t1 = time.perf_counter()
    conn = psycopg.connect(
        **dsql_kwargs(target, token), autocommit=autocommit, row_factory=dict_row
    )
    last_open_ms.update(dsql_sign=_ms(t0, t1), dsql_connect=_ms(t1, time.perf_counter()))
    return conn


def connect_url(url: str, *, autocommit: bool = True) -> psycopg.Connection:
    return psycopg.connect(url, autocommit=autocommit, row_factory=dict_row)


def _ms(start: float, end: float) -> float:
    return round((end - start) * 1000, 1)


class SharedConnection:
    """One autocommit connection per process, lent to one request at a time (the API in Lambda,
    where a container serves one request at a time). It's replaced when it's older than
    `max_age_s` (DSQL closes connections at 60 minutes), closed or broken, or not idle (a request
    left a transaction open or failed in one); after `ping_after_s` without use it's checked
    with a `SELECT 1` first, since a frozen container's connection may be gone.

    A borrower that finds it lent out (two requests at once: uvicorn's threadpool) gets a
    connection of its own, closed when it's returned. So two requests never share one.
    """

    def __init__(
        self,
        connect: Callable[[], psycopg.Connection],
        *,
        max_age_s: float = 50 * 60,
        ping_after_s: float = 60,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._connect = connect
        self._max_age_s = max_age_s
        self._ping_after_s = ping_after_s
        self._clock = clock
        self._lock = threading.Lock()
        self._conn: psycopg.Connection | None = None
        self._opened_at = self._used_at = 0.0

    def acquire(self) -> psycopg.Connection:
        # A plain Lock, not an RLock: FastAPI may run a dependency's teardown (`release`) on
        # another threadpool thread than its setup.
        if not self._lock.acquire(blocking=False):
            return self._connect()
        try:
            if self._conn is None or not self._usable(self._conn):
                self._discard()
                self._conn = self._connect()
                self._opened_at = self._clock()
            return self._conn
        except BaseException:
            self._lock.release()
            raise

    def release(self, conn: psycopg.Connection) -> None:
        if conn is not self._conn:
            conn.close()  # the extra one of a concurrent request
            return
        try:
            if not _idle(conn):
                self._discard()
            self._used_at = self._clock()
        finally:
            self._lock.release()

    def _usable(self, conn: psycopg.Connection) -> bool:
        now = self._clock()
        if now - self._opened_at >= self._max_age_s or not _idle(conn):
            return False
        if now - self._used_at < self._ping_after_s:
            return True
        try:
            conn.execute("SELECT 1")
            return True
        except psycopg.Error as err:
            log.info("shared DSQL connection is gone (%s), reconnecting", type(err).__name__)
            return False

    def _discard(self) -> None:
        conn, self._conn = self._conn, None
        if conn is not None:
            with contextlib.suppress(Exception):  # already broken: nothing to give back
                conn.close()


def _idle(conn: psycopg.Connection) -> bool:
    return (
        not conn.closed
        and not conn.broken
        and conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
    )


def is_occ_conflict(err: BaseException) -> bool:
    """DSQL's optimistic concurrency answers (SQLSTATE 40001: OC000 data, OC001 schema)."""
    return isinstance(err, psycopg.errors.SerializationFailure)
