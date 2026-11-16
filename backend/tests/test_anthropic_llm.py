"""The Anthropic adapter with a stubbed SDK client: no network, no API calls."""

from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from jobtracker.adapters import anthropic_llm
from jobtracker.adapters.anthropic_llm import AnthropicLLM
from jobtracker.core.ports import LLMError, LLMRateLimited


def rate_limit(retry_after: str | None = "7") -> anthropic.RateLimitError:
    headers = {"retry-after": retry_after} if retry_after is not None else {}
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx2.Response(429, headers=headers, request=request)
    return anthropic.RateLimitError("rate limited", response=response, body=None)


def ok(text='{"a": 1}', cached=0, written=0):
    return SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=20,
            cache_read_input_tokens=cached,
            cache_creation_input_tokens=written,
        ),
    )


class StubMessages:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.requests: list[dict] = []

    def create(self, **kwargs):
        self.requests.append(kwargs)
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


def make(outcomes):
    waits: list[float] = []
    stub = StubMessages(outcomes)
    llm = AnthropicLLM(SimpleNamespace(messages=stub), "claude-haiku-5-5", sleep=waits.append)
    return llm, stub, waits


@pytest.fixture(autouse=True)
def no_jitter(monkeypatch):
    monkeypatch.setattr(anthropic_llm.random, "uniform", lambda a, b: 0.0)


def call(llm):
    return llm.complete_json(system="rules", user="posting", schema={}, max_tokens=100)


def test_system_prompt_is_cached_and_usage_counts_cache_reads():
    llm, stub, _ = make([ok(cached=900, written=0), ok(cached=0, written=900)])
    assert call(llm) == {"a": 1}
    call(llm)
    system = stub.requests[0]["system"]
    assert system == [{"type": "text", "text": "rules", "cache_control": {"type": "ephemeral"}}]
    assert llm.usage.calls == 2 and llm.usage.cached_tokens == 900
    assert llm.usage.input_tokens == 100 + 100 + 900  # cache writes are billed input


def test_rate_limit_waits_for_retry_after_then_succeeds():
    llm, stub, waits = make([rate_limit("7"), rate_limit(None), ok()])
    assert call(llm) == {"a": 1}
    assert waits == [7.0, anthropic_llm.RATE_LIMIT_DEFAULT_WAIT]
    assert len(stub.requests) == 3


def test_rate_limit_wait_is_capped():
    llm, _, waits = make([rate_limit("600"), ok()])
    call(llm)
    assert waits == [anthropic_llm.RATE_LIMIT_MAX_WAIT]


def test_rate_limit_gives_up_after_the_waits():
    n = anthropic_llm.RATE_LIMIT_WAITS
    llm, stub, waits = make([rate_limit() for _ in range(n + 1)])
    with pytest.raises(LLMRateLimited) as info:
        call(llm)
    assert isinstance(info.value, LLMError) and "rate limited" in str(info.value)
    assert len(waits) == n and len(stub.requests) == n + 1
