"""LLMClient on the Anthropic Messages API with JSON-schema structured outputs."""

from __future__ import annotations

import json
import logging
import random
import time
from collections.abc import Callable

import anthropic

from jobtracker.core.ports import LLMError, LLMRateLimited, LLMRefusal, LLMUsage

log = logging.getLogger(__name__)

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


class AnthropicLLM:
    def __init__(
        self,
        api_key: str,
        model: str,
        effort: str = "low",
        *,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required")
        self.client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=60.0)
        self.model = model
        self.effort = effort
        self.usage = LLMUsage()
        self._sleep = sleep

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
