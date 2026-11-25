import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from jobtracker.api.app import create_app
from jobtracker.api.auth import HEADER
from jobtracker.settings import ConfigError, Settings
from tests.fakes import MemoryRepo

POOL = "us-east-1_TestPool"
ISSUER = f"https://cognito-idp.us-east-1.amazonaws.com/{POOL}"
CLIENT = "test-client-id"
DOMAIN = "https://jobtracker-test.auth.us-east-1.amazoncognito.com"
APP_URL = "https://jobs.example.dev"
EMAIL = "alex.candidate@gmail.com"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _settings(**env):
    base = {
        "APP_ENV": "prod",
        "COGNITO_USER_POOL_ID": POOL,
        "COGNITO_CLIENT_ID": CLIENT,
        "COGNITO_DOMAIN": DOMAIN,
        "APP_URL": APP_URL,
        "ALLOWED_EMAIL": EMAIL,
    }
    return Settings.from_env({**base, **env})


def _token(key=KEY, **claims):
    now = int(time.time())
    payload = {
        "sub": "0c1d2e3f-user",
        "aud": CLIENT,
        "iss": ISSUER,
        "token_use": "id",
        "email": EMAIL,
        "email_verified": True,
        "iat": now,
        "exp": now + 300,
        **claims,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, key, algorithm="RS256", headers={"kid": "k1"})


@pytest.fixture
def jwks_urls(monkeypatch):
    urls = []

    class FakeJWKClient:
        def __init__(self, url, *a, **kw):
            urls.append(url)

        def get_signing_key_from_jwt(self, token):
            return type("K", (), {"key": KEY.public_key()})()

    monkeypatch.setattr("jobtracker.api.auth.jwt.PyJWKClient", FakeJWKClient)
    return urls


@pytest.fixture
def client(jwks_urls):
    repo = MemoryRepo()
    return TestClient(create_app(_settings(), repo_factory=lambda: repo))


def test_health_is_public(client):
    assert client.get("/api/health").status_code == 200


def test_keys_come_from_the_user_pool(client, jwks_urls):
    assert jwks_urls == [f"{ISSUER}/.well-known/jwks.json"]


def test_auth_config_is_public_and_tells_the_spa_how_to_sign_in(client):
    r = client.get("/api/auth/config")
    assert r.status_code == 200
    assert r.json() == {
        "mode": "cognito",
        "authority": ISSUER,
        "client_id": CLIENT,
        "domain": DOMAIN,
        "app_url": APP_URL,
    }


def test_auth_config_locally_says_there_is_no_login():
    client = TestClient(
        create_app(
            Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "true"}),
            repo_factory=MemoryRepo,
        )
    )
    assert client.get("/api/auth/config").json() == {"mode": "none"}


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {HEADER: "garbage"},
        {HEADER: _token(key=OTHER_KEY)},
        {HEADER: _token(aud="someone-elses-client")},
        {HEADER: _token(iss="https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other")},
        {HEADER: _token(exp=int(time.time()) - 120)},
        {HEADER: _token(token_use="access")},
        {HEADER: _token(email="intruder@example.com")},
        {HEADER: _token(email_verified=False)},
        {HEADER: _token(email_verified=None)},
        {HEADER: _token(sub=None)},
        {"Authorization": f"Bearer {_token()}"},
    ],
    ids=[
        "missing",
        "garbage",
        "wrong-key",
        "wrong-client",
        "wrong-pool",
        "expired",
        "access-token",
        "wrong-email",
        "unverified-email",
        "no-email-verified",
        "no-sub",
        "authorization-header",
    ],
)
def test_rejects_invalid_tokens(client, headers):
    for path in ("/api/me", "/api/applications", "/api/stats", "/api/shell"):
        assert client.get(path, headers=headers).status_code == 401


def test_accepts_valid_token(client):
    r = client.get("/api/me", headers={HEADER: _token()})
    assert r.status_code == 200 and r.json() == {"email": EMAIL}


def test_email_match_ignores_case(client):
    r = client.get("/api/me", headers={HEADER: _token(email=EMAIL.upper())})
    assert r.status_code == 200


def test_dev_bypass_is_impossible_outside_local():
    with pytest.raises(ConfigError):
        _settings(AUTH_DEV_BYPASS="true")
    with pytest.raises(ConfigError):
        Settings.from_env(
            {"APP_ENV": "local", "AUTH_DEV_BYPASS": "1", "AWS_LAMBDA_FUNCTION_NAME": "api"}
        )
    assert Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "1"}).auth_dev_bypass


@pytest.mark.parametrize("missing", ["COGNITO_USER_POOL_ID", "COGNITO_CLIENT_ID", "ALLOWED_EMAIL"])
def test_prod_requires_cognito_config(missing, jwks_urls):
    with pytest.raises(RuntimeError):
        create_app(_settings(**{missing: ""}), repo_factory=MemoryRepo)
