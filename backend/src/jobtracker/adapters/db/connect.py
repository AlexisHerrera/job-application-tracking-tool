"""Database connections: a plain URL locally, IAM token auth on Aurora DSQL.

DSQL has no passwords. Each connection signs a short-lived token with the caller's AWS
credentials (the Lambda role, or your SSO profile from the CLI) and sends it as the password. A
token only has to be valid when the connection opens; DSQL closes any connection after 60
minutes, so we open one per request / run and never pool across invocations.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row

ADMIN = "admin"  # DSQL's built-in role: DDL and grants. The Lambdas use their own roles.
TOKEN_SECONDS = 900  # only needs to outlive the handshake

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


def sign_token(target: DsqlTarget) -> str:
    """Local SigV4 signing: no network call. Expired credentials still produce a token; the
    connection is what fails then."""
    import boto3

    session = boto3.Session(profile_name=target.profile, region_name=target.aws_region)
    client = session.client("dsql")
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
    return psycopg.connect(
        **dsql_kwargs(target, signer(target)), autocommit=autocommit, row_factory=dict_row
    )


def connect_url(url: str, *, autocommit: bool = True) -> psycopg.Connection:
    return psycopg.connect(url, autocommit=autocommit, row_factory=dict_row)


def is_occ_conflict(err: BaseException) -> bool:
    """DSQL's optimistic concurrency answers (SQLSTATE 40001: OC000 data, OC001 schema)."""
    return isinstance(err, psycopg.errors.SerializationFailure)
