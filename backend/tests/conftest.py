from __future__ import annotations

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


def load(name: str, *, uid: int | None = None, thread: str | None = None):
    return parse_email((FIXTURES / name).read_bytes(), uid=uid, gm_thread_id=thread)


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
