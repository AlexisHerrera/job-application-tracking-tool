import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

from jobtracker.evals import paste_eval
from tests.conftest import TZ
from tests.fakes import FakeLLM
from tests.test_paste import AGENCY_POST_RECORD

FIXTURE = Path(__file__).parent / "fixtures" / "paste" / "agency_post_es.txt"


def test_check_field_matchers():
    assert paste_eval.check_field("Núñez", " nunez ") == []
    assert paste_eval.check_field(None, None) == []
    assert paste_eval.check_field(None, "Acme") == ["expected None"]
    assert paste_eval.check_field(["b", "A"], ["a", "b"]) == []
    notes = "Employee (relación de dependencia). Benefit mentions Acme."
    assert paste_eval.check_field({"contains": ["relacion de dependencia", ["CTO", "Acme"]]}, notes) == []  # fmt: skip
    assert paste_eval.check_field({"contains": ["contractor"], "excludes": ["acme"]}, notes) == [
        "missing 'contractor'",
        "should not mention 'acme'",
    ]
    assert paste_eval.check_field({"includes": ["Go", "rust"]}, ["go", "gcp"]) == [
        "missing item 'rust'"
    ]


def _case(tmp_path: Path, expected: dict | None) -> Path:
    path = tmp_path / "2026-10-20-agency.txt"
    shutil.copy(FIXTURE, path)
    if expected is not None:
        path.with_suffix(".expected.json").write_text(json.dumps(expected))
    return path


def test_run_case_passes_and_writes_actual(tmp_path):
    llm = FakeLLM()
    llm.paste_response = {"applications": [AGENCY_POST_RECORD]}
    expected = {"records": [{
        "company": None, "role_title": "Senior Backend Engineer", "salary_min": None,
        "salary_currency": "USD", "stack": {"includes": ["go", "kubernetes"]},
        "location": {"contains": ["2 days", "Palermo"]},
        "notes": {"contains": ["relación de dependencia", "CTO"]},
    }]}  # fmt: skip
    path = _case(tmp_path, expected)
    result = paste_eval.run_case(path, llm, TZ, datetime(2026, 1, 1, tzinfo=UTC))
    assert result.passed, paste_eval.render(result)
    [actual] = json.loads(path.with_suffix(".actual.json").read_text())
    assert actual["company"] is None and actual["role_title"] == "Senior Backend Engineer"


def test_run_case_reports_guessed_company_and_extra_records(tmp_path):
    llm = FakeLLM()
    llm.paste_response = {"applications": [
        {**AGENCY_POST_RECORD, "company": "Acme Coffee"},  # guessed from a benefit: wrong
        {**AGENCY_POST_RECORD, "role_title": "Junior QA"},
    ]}  # fmt: skip
    path = _case(
        tmp_path, {"records": [{"company": None, "role_title": "Senior Backend Engineer"}]}
    )
    result = paste_eval.run_case(path, llm, TZ, datetime(2026, 1, 1, tzinfo=UTC))
    assert not result.passed
    assert [f.field for f in result.fields if f.problems] == ["company"]
    assert result.errors == ["unexpected record: None · Junior QA"]


def test_run_case_without_expectation_is_not_a_pass(tmp_path):
    llm = FakeLLM()
    llm.paste_response = {"applications": [AGENCY_POST_RECORD]}
    result = paste_eval.run_case(_case(tmp_path, None), llm, TZ, datetime(2026, 1, 1, tzinfo=UTC))
    assert not result.passed and "no expectation yet" in paste_eval.render(result)[0]
