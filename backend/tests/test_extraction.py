from datetime import UTC, datetime

from jobtracker.core.extraction import (
    EXTRACTION_SCHEMA,
    extraction_prompt,
    gate_prompt,
    parse_extraction,
)
from jobtracker.core.models import EventType, Stage
from tests.conftest import TZ, load
from tests.fakes import extraction


def test_parse_valid_output_and_naive_time_uses_tz():
    e = parse_extraction(
        extraction(company="Contoso", event_type="interview_scheduled", stage_implied="interviewing",
                   interview_at="2026-11-05T12:00:00", round=2),
        TZ,
    )  # fmt: skip
    assert e.event_type == EventType.INTERVIEW_SCHEDULED
    assert e.stage_implied == Stage.INTERVIEWING
    assert e.interview_at == datetime(2026, 11, 5, 15, 0, tzinfo=UTC)
    assert e.round == 2


def test_garbage_output_degrades_to_low_confidence():
    e = parse_extraction(
        {"event_type": "party", "confidence": 7, "round": -1, "interview_at": "soon"}, TZ
    )
    assert e.event_type == EventType.OTHER
    assert e.confidence == 0.0
    assert e.round is None and e.interview_at is None


def test_prompts_wrap_email_and_respect_limits():
    m = load("ashby_received.eml")
    system, user = extraction_prompt(m, TZ, datetime(2026, 10, 12, tzinfo=UTC), body_limit=50)
    assert "America/Buenos_Aires" in system and "2026-10-11" in system
    assert user.startswith("<email>") and user.endswith("</email>")
    assert "Our team will review" not in user  # truncated
    _, gate_user = gate_prompt(m)
    assert "Northwind" in gate_user


def test_schema_is_strict():
    assert EXTRACTION_SCHEMA["additionalProperties"] is False
    assert set(EXTRACTION_SCHEMA["required"]) == set(EXTRACTION_SCHEMA["properties"])
    assert "manual_stage_change" not in EXTRACTION_SCHEMA["properties"]["event_type"]["enum"]
