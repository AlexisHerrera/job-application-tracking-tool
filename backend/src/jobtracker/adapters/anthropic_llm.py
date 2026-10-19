"""LLMClient on the Anthropic Messages API with JSON-schema structured outputs."""

from __future__ import annotations

import json
import logging

import anthropic

from jobtracker.core.ports import LLMError, LLMRefusal, LLMUsage

log = logging.getLogger(__name__)


class AnthropicLLM:
    def __init__(self, api_key: str, model: str, effort: str = "low"):
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required")
        self.client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=60.0)
        self.model = model
        self.effort = effort
        self.usage = LLMUsage()

    def complete_json(self, *, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        try:
            resp = self.client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={
                    "effort": self.effort,
                    "format": {"type": "json_schema", "schema": schema},
                },
            )
        except anthropic.BadRequestError as err:
            # A request we built is malformed: retrying the same email won't help.
            raise LLMRefusal(f"bad request: {err.type}") from err
        except (
            anthropic.RateLimitError,
            anthropic.APIStatusError,
            anthropic.APIConnectionError,
        ) as err:
            raise LLMError(type(err).__name__) from err

        self.usage.add(LLMUsage(1, resp.usage.input_tokens, resp.usage.output_tokens))
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
