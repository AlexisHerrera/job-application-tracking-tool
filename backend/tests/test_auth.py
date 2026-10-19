import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from jobtracker.api.app import create_app
from jobtracker.api.auth import HEADER
from jobtracker.settings import ConfigError, Settings
from tests.fakes import MemoryRepo

TEAM = "alexisherrera.cloudflareaccess.com"
AUD = "test-aud-tag"
EMAIL = "alex.candidate@gmail.com"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _settings(**env):
    base = {
        "APP_ENV": "prod",
        "CF_ACCESS_TEAM_DOMAIN": TEAM,
        "CF_ACCESS_AUD": AUD,
        "ALLOWED_EMAIL": EMAIL,
    }
    return Settings.from_env({**base, **env})


def _token(key=KEY, **claims):
    now = int(time.time())
    payload = {
        "aud": [AUD],
        "iss": f"https://{TEAM}",
        "email": EMAIL,
        "iat": now,
        "exp": now + 300,
        **claims,
    }
    return jwt.encode(payload, key, algorithm="RS256", headers={"kid": "k1"})


@pytest.fixture
def client(monkeypatch):
    class FakeJWKClient:
        def __init__(self, *a, **kw):
            pass

        def get_signing_key_from_jwt(self, token):
            return type("K", (), {"key": KEY.public_key()})()

    monkeypatch.setattr("jobtracker.api.auth.jwt.PyJWKClient", FakeJWKClient)
    repo = MemoryRepo()
    return TestClient(create_app(_settings(), repo_factory=lambda: repo))


def test_health_is_public(client):
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {HEADER: "garbage"},
        {HEADER: _token(key=OTHER_KEY)},
        {HEADER: _token(aud=["someone-else"])},
        {HEADER: _token(iss="https://evil.cloudflareaccess.com")},
        {HEADER: _token(exp=int(time.time()) - 120)},
        {HEADER: _token(email="intruder@example.com")},
    ],
    ids=["missing", "garbage", "wrong-key", "wrong-aud", "wrong-iss", "expired", "wrong-email"],
)
def test_rejects_invalid_tokens(client, headers):
    for path in ("/api/me", "/api/applications", "/api/stats"):
        assert client.get(path, headers=headers).status_code == 401


def test_accepts_valid_token(client):
    r = client.get("/api/me", headers={HEADER: _token()})
    assert r.status_code == 200 and r.json() == {"email": EMAIL}


def test_dev_bypass_is_impossible_outside_local():
    with pytest.raises(ConfigError):
        _settings(AUTH_DEV_BYPASS="true")
    with pytest.raises(ConfigError):
        Settings.from_env(
            {"APP_ENV": "local", "AUTH_DEV_BYPASS": "1", "AWS_LAMBDA_FUNCTION_NAME": "api"}
        )
    assert Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "1"}).auth_dev_bypass


def test_prod_requires_access_config():
    with pytest.raises(RuntimeError):
        create_app(Settings.from_env({"APP_ENV": "prod"}), repo_factory=MemoryRepo)
