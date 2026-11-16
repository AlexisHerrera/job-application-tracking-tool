"""How the app authenticates to the Anthropic API, with no API key: Workload Identity Federation
in prod, an `ant auth login` session locally. STS and the SDK client are stubbed: no AWS, no
network. conftest points ANTHROPIC_CONFIG_DIR at an empty folder for every test."""

from __future__ import annotations

import json
import os
from pathlib import Path

import anthropic
import pytest
from anthropic import WorkloadIdentityCredentials

from jobtracker.adapters import anthropic_llm
from jobtracker.adapters.anthropic_llm import AnthropicLLM
from jobtracker.core.ports import LLMError
from jobtracker.settings import ConfigError, Settings

FEDERATION = {
    "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_test",
    "ANTHROPIC_ORGANIZATION_ID": "00000000-0000-0000-0000-000000000000",
    "ANTHROPIC_SERVICE_ACCOUNT_ID": "svac_test",
    "ANTHROPIC_WORKSPACE_ID": "wrkspc_test",
}


def log_in(profile: str = "default") -> None:
    """What `ant auth login` leaves behind, as far as the app cares: the profile's config."""
    configs = Path(os.environ["ANTHROPIC_CONFIG_DIR"]) / "configs"
    configs.mkdir(parents=True, exist_ok=True)
    (configs / f"{profile}.json").write_text(json.dumps({"authentication": {"type": "user_oauth"}}))


class _Client:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


@pytest.fixture
def stub_client(monkeypatch):
    monkeypatch.setattr(anthropic_llm.anthropic, "Anthropic", _Client)
    monkeypatch.setattr(anthropic_llm, "sts_identity_token", lambda region: lambda: "jwt")


# --- prod: federation ---


def test_federation_ids_configure_the_llm():
    s = Settings.from_env({"APP_ENV": "prod", **FEDERATION})
    assert s.uses_federation and s.llm_configured


@pytest.mark.parametrize("missing", ["ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID"])
def test_half_configured_federation_is_an_error(missing):
    env = {k: v for k, v in FEDERATION.items() if k != missing}
    with pytest.raises(ConfigError, match="federation needs"):
        Settings.from_env(env)


def test_federation_wins_over_a_login_and_a_leftover_key(stub_client, monkeypatch):
    log_in()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-old")
    llm = AnthropicLLM.from_settings(Settings.from_env(FEDERATION), "low")
    assert set(llm.client.kwargs) == {"credentials", "max_retries", "timeout"}
    assert isinstance(llm.client.kwargs["credentials"], WorkloadIdentityCredentials)
    assert llm.effort == "low"


def test_sts_token_is_for_the_anthropic_audience(monkeypatch):
    import boto3

    calls: list[dict] = []

    class _Sts:
        def get_web_identity_token(self, **kwargs):
            calls.append(kwargs)
            return {"WebIdentityToken": f"jwt-{len(calls)}"}

    regions = []
    monkeypatch.setattr(
        boto3, "client", lambda name, region_name: regions.append(region_name) or _Sts()
    )
    token = anthropic_llm.sts_identity_token("us-east-1")
    assert [token(), token()] == ["jwt-1", "jwt-2"]  # a fresh one per exchange
    assert regions == ["us-east-1"]
    assert calls[0] == {
        "Audience": ["https://api.anthropic.com"],
        "SigningAlgorithm": "RS256",
        "DurationSeconds": anthropic_llm.STS_TOKEN_SECONDS,
    }


# --- local: `ant auth login` ---


def test_without_a_login_the_llm_isnt_configured(stub_client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-old")  # a key no longer counts
    s = Settings.from_env({})
    assert not s.llm_configured
    with pytest.raises(ValueError, match="ant auth login"):
        AnthropicLLM.from_settings(s, "low")


def test_a_login_configures_the_llm_and_beats_a_leftover_key(stub_client, monkeypatch):
    log_in()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-old")
    s = Settings.from_env({})
    assert s.llm_configured and not s.uses_federation
    llm = AnthropicLLM.from_settings(s, "medium")
    assert llm.client.kwargs["profile"] == "default" and "api_key" not in llm.client.kwargs


def test_anthropic_profile_picks_the_login(stub_client, monkeypatch):
    log_in("work")
    assert anthropic_llm.login_profile() is None  # "default" isn't logged in
    monkeypatch.setenv("ANTHROPIC_PROFILE", "work")
    assert anthropic_llm.login_profile() == "work"


def test_an_expired_login_is_an_llm_error():
    class _Messages:
        def create(self, **kwargs):
            raise anthropic.CredentialsError("refresh token expired")

    from types import SimpleNamespace

    llm = AnthropicLLM(SimpleNamespace(messages=_Messages()), "claude-haiku-5-5")
    with pytest.raises(LLMError, match="ant auth login"):
        llm.complete_json(system="s", user="u", schema={}, max_tokens=10)
