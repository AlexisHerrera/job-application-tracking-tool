"""LLMClient on the Anthropic Messages API with JSON-schema structured outputs."""

from __future__ import annotations

import json
import logging
import os
import random
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

import anthropic
from anthropic import WorkloadIdentityCredentials, WorkloadIdentityError

from jobtracker.core.ports import LLMError, LLMRateLimited, LLMRefusal, LLMUsage

if TYPE_CHECKING:
    from jobtracker.settings import Settings

log = logging.getLogger(__name__)

# Workload Identity Federation (prod). The IAM policy only lets the Lambdas ask STS for tokens
# with this audience and at most this lifetime (infra/prod/lambdas.tf).
ANTHROPIC_AUDIENCE = "https://api.anthropic.com"
STS_TOKEN_SECONDS = 300

# The SDK already retries a 429 a few times with short backoffs. When the per-minute token limit
# is spent, those give up within seconds, so wait for the window to reopen and try again.
RATE_LIMIT_WAITS = 4
RATE_LIMIT_DEFAULT_WAIT = 20.0  # seconds, when the response has no usable retry-after
RATE_LIMIT_MAX_WAIT = 60.0


def retry_after(err: anthropic.RateLimitError) -> float:
    try:
        wait = float(err.response.headers.get("retry-after", ""))
    except ValueError:
        wait = RATE_LIMIT_DEFAULT_WAIT
    return min(max(wait, 1.0), RATE_LIMIT_MAX_WAIT) + random.uniform(0, 3)


def sts_identity_token(region: str, duration_s: int = STS_TOKEN_SECONDS) -> Callable[[], str]:
    """A token provider for federation: a fresh STS web identity token for the caller's IAM
    role, for the Anthropic audience. The SDK calls it on every exchange (each token is single
    use) and caches the Anthropic token it gets back. GetWebIdentityToken only exists on
    regional STS endpoints, hence the region."""
    import boto3

    sts = boto3.client("sts", region_name=region)

    def token() -> str:
        resp = sts.get_web_identity_token(
            Audience=[ANTHROPIC_AUDIENCE], SigningAlgorithm="RS256", DurationSeconds=duration_s
        )
        return resp["WebIdentityToken"]

    return token


NOT_LOGGED_IN = "not logged in to Anthropic: run `ant auth login`"


def login_profile() -> str | None:
    """The Anthropic CLI profile this machine is logged in with (`ant auth login`), if any:
    `ANTHROPIC_PROFILE`, else the active one, else `default`. Local only; prod has none."""
    from anthropic import CredentialsFile

    profile = CredentialsFile()
    return profile.profile if profile.config_path.is_file() else None


def make_client(s: Settings) -> anthropic.Anthropic:
    """No API keys anywhere. Prod: Workload Identity Federation, the Lambda's IAM role vouches
    for it. Local: your `ant auth login` session, which the SDK refreshes on its own until it
    expires. Both are explicit, so the SDK ignores an `ANTHROPIC_API_KEY` left in the env."""
    opts = {"max_retries": 3, "timeout": 60.0}
    if s.uses_federation:
        region = os.environ.get("AWS_REGION") or "us-east-1"
        credentials = WorkloadIdentityCredentials(
            identity_token_provider=sts_identity_token(region),
            federation_rule_id=s.anthropic_federation_rule_id,
            organization_id=s.anthropic_organization_id,
            service_account_id=s.anthropic_service_account_id,
            workspace_id=s.anthropic_workspace_id or None,
        )
        return anthropic.Anthropic(credentials=credentials, **opts)
    profile = login_profile()
    if profile is None:
        raise ValueError(NOT_LOGGED_IN)
    return anthropic.Anthropic(profile=profile, **opts)


class AnthropicLLM:
    def __init__(
        self,
        client: anthropic.Anthropic,
        model: str,
        effort: str = "low",
        *,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.client = client
        self.model = model
        self.effort = effort
        self.usage = LLMUsage()
        self._sleep = sleep

    @classmethod
    def from_settings(cls, s: Settings, effort: str) -> AnthropicLLM:
        return cls(make_client(s), s.llm_model, effort)

    def _create(self, *, system: str, user: str, schema: dict, max_tokens: int):
        for attempt in range(RATE_LIMIT_WAITS + 1):
            try:
                return self.client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    # The system prompt is the same for every call in a batch (the criteria, the
                    # extraction rules): cached reads cost a tenth and don't count toward the
                    # input-token rate limit.
                    system=[
                        {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
                    ],
                    messages=[{"role": "user", "content": user}],
                    output_config={
                        "effort": self.effort,
                        "format": {"type": "json_schema", "schema": schema},
                    },
                )
            except (anthropic.CredentialsError, WorkloadIdentityError) as err:
                # Getting a token failed before the request went out: locally, most often an
                # `ant auth login` session that has expired; in prod, a federation exchange.
                raise LLMError(
                    f"Anthropic credentials failed (locally: `ant auth login`): {err}"
                ) from err
            except anthropic.RateLimitError as err:
                if attempt == RATE_LIMIT_WAITS:
                    raise LLMRateLimited(
                        f"rate limited ({err.type or 'rate_limit_error'})"
                    ) from err
                wait = retry_after(err)
                log.info(
                    "anthropic rate limit, waiting %.0fs (%d/%d)",
                    wait,
                    attempt + 1,
                    RATE_LIMIT_WAITS,
                )
                self._sleep(wait)
        raise AssertionError("unreachable")

    def complete_json(self, *, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        try:
            resp = self._create(system=system, user=user, schema=schema, max_tokens=max_tokens)
        except anthropic.BadRequestError as err:
            # A request we built is malformed: retrying the same email won't help. The API's
            # message describes our request (schema, params), never the email content.
            log.error("anthropic rejected the request: %s", err.message)
            raise LLMRefusal(f"bad request: {err.type}") from err
        except anthropic.APIStatusError as err:
            raise LLMError(f"{type(err).__name__} (HTTP {err.status_code})") from err
        except anthropic.APIConnectionError as err:
            raise LLMError(type(err).__name__) from err

        u = resp.usage
        written = u.cache_creation_input_tokens or 0
        self.usage.add(
            LLMUsage(1, u.input_tokens + written, u.output_tokens, u.cache_read_input_tokens or 0)
        )
        if resp.stop_reason == "refusal":
            raise LLMRefusal("refusal")
        if resp.stop_reason == "max_tokens":
            raise LLMRefusal("max_tokens")
        text = next((b.text for b in resp.content if b.type == "text"), None)
        if text is None:
            raise LLMRefusal("no text block")
        try:
            return json.loads(text)
        except json.JSONDecodeError as err:
            raise LLMRefusal("invalid json") from err
