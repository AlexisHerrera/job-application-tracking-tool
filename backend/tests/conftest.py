from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from jobtracker.core.clock import FixedClock
from jobtracker.core.email_parse import parse_email
from jobtracker.core.pipeline import Pipeline, PipelineConfig
from tests.fakes import FakeLLM, MemoryRepo

FIXTURES = Path(__file__).parent / "fixtures" / "emails"
TZ = ZoneInfo("America/Buenos_Aires")
ME = "alex.candidate@gmail.com"


def no_postgres() -> None:
    """Skip a Postgres test when the compose `db` isn't up, except in CI (GitHub sets `CI`),
    where a skipped database test must not pass as green."""
    if os.environ.get("CI"):
        pytest.fail("Postgres isn't reachable in CI (TEST_ADMIN_DATABASE_URL)")
    pytest.skip("local Postgres not running (docker compose up db)")


def load(name: str, *, uid: int | None = None, thread: str | None = None):
    return parse_email((FIXTURES / name).read_bytes(), uid=uid, gm_thread_id=thread)


@pytest.fixture(autouse=True)
def no_anthropic_login(monkeypatch, tmp_path):
    """Tests never see the `ant auth login` session of the machine they run on."""
    monkeypatch.setenv("ANTHROPIC_CONFIG_DIR", str(tmp_path / "anthropic-config"))
    monkeypatch.delenv("ANTHROPIC_PROFILE", raising=False)


@pytest.fixture
def clock():
    return FixedClock(datetime(2026, 10, 12, 12, 0, tzinfo=UTC))


@pytest.fixture
def repo():
    return MemoryRepo()


@pytest.fixture
def llm():
    return FakeLLM()


@pytest.fixture
def pipeline(repo, llm, clock):
    return Pipeline(repo, llm, clock, PipelineConfig(tz=TZ, my_addresses={ME}))
