"""Paste prompt regression: run the real prompt over pasted texts and check approved expectations.

Real texts live in the gitignored eval/paste/ folder: `<name>.txt`, plus `<name>.expected.json`
once you have approved what it should produce. Each run writes `<name>.actual.json` next to it.

    {"records": [{"company": null, "role_title": "Senior Fullstack Engineer",
                  "stack": {"includes": ["node.js", "react"]},
                  "benefits": {"contains": ["OSDE 310", ["3 weeks", "15 days"]]},
                  "notes": {"contains": ["relación de dependencia"], "excludes": ["tapi"]}}]}

A plain value (string, number, null, list) must be equal; strings ignore case, accents and
surrounding spaces. `contains` / `excludes` check substrings the same way (a nested list means
any one of them), `includes` checks list items. `{"similar": "text", "min": 85}` passes when the
fuzzy similarity (0-100) reaches min; `{"items": [...], "min": 0.8}` when the lists overlap that
much (Jaccard). Fields left out are not checked.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from rapidfuzz import fuzz

from jobtracker.core import paste
from jobtracker.core.ports import LLMClient


def record_json(rec: paste.ProposedRecord) -> dict[str, Any]:
    """A parsed record as plain JSON (the shape expectations are written against)."""
    values = {
        k: v.date().isoformat() if isinstance(v, datetime) else v for k, v in rec.values.items()
    }
    return {
        "company": rec.company,
        **values,
        "stage": rec.stage.value if rec.stage else None,
        "stage_date": rec.stage_at.date().isoformat() if rec.stage_at else None,
        "salary_note": rec.salary_note,
        "evidence": rec.evidence,
    }


def _norm(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value.casefold())
    return " ".join("".join(c for c in folded if not unicodedata.combining(c)).split())


def _has(text: str, needle: str | list[str]) -> bool:
    options = needle if isinstance(needle, list) else [needle]
    return any(_norm(o) in _norm(text) for o in options)


def _equal(expected: Any, actual: Any) -> bool:
    if isinstance(expected, str) and isinstance(actual, str):
        return _norm(expected) == _norm(actual)
    if isinstance(expected, list) and isinstance(actual, list):
        return sorted(map(_norm, map(str, expected))) == sorted(map(_norm, map(str, actual)))
    return expected == actual


def check_field(expected: Any, actual: Any) -> list[str]:
    """Problems with one field; empty when it matches."""
    if not isinstance(expected, dict):
        return [] if _equal(expected, actual) else [f"expected {expected!r}"]
    problems = []
    text = actual if isinstance(actual, str) else ""
    items = [_norm(str(a)) for a in actual] if isinstance(actual, list) else []
    for needle in expected.get("contains", []):
        if not _has(text, needle):
            problems.append(f"missing {needle!r}")
    for needle in expected.get("excludes", []):
        if text and _has(text, needle):
            problems.append(f"should not mention {needle!r}")
    for item in expected.get("includes", []):
        if _norm(item) not in items:
            problems.append(f"missing item {item!r}")
    if "similar" in expected:
        score = fuzz.token_set_ratio(_norm(expected["similar"]), _norm(text))
        if score < expected.get("min", 85):
            problems.append(f"similarity {score:.0f} < {expected.get('min', 85)}")
    if "items" in expected:
        want = {_norm(str(i)) for i in expected["items"]}
        overlap = len(want & set(items)) / (len(want | set(items)) or 1)
        if overlap < expected.get("min", 0.8):
            missing, extra = sorted(want - set(items)), sorted(set(items) - want)
            problems.append(f"overlap {overlap:.2f}; missing {missing}, extra {extra}")
    return problems


def expected_value(expected: Any) -> Any:
    """The value a matcher stands for, to tell "should be empty" from "should be filled"."""
    if isinstance(expected, dict):
        return expected.get("similar", expected.get("items", expected.get("contains")))
    return expected


@dataclass
class FieldResult:
    record: int
    field: str
    actual: Any
    problems: list[str]


@dataclass
class CaseResult:
    name: str
    actual: list[dict[str, Any]]
    fields: list[FieldResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)  # record-level: missing or extra records
    has_expectation: bool = True

    @property
    def passed(self) -> bool:
        return self.has_expectation and not self.errors and all(not f.problems for f in self.fields)


def _pair(expected: list[dict], actual: list[dict]) -> list[tuple[int, int | None]]:
    """Pair each expected record with the unused actual record whose role reads closest."""
    free = set(range(len(actual)))
    pairs = []
    for i, exp in enumerate(expected):
        role = str(exp.get("role_title") or "")
        best = max(
            free,
            key=lambda j: fuzz.token_set_ratio(_norm(role), _norm(actual[j]["role_title"] or "")),
            default=None,
        )
        if best is not None:
            free.discard(best)
        pairs.append((i, best))
    return pairs


def compare(name: str, expected: dict | None, actual: list[dict[str, Any]]) -> CaseResult:
    result = CaseResult(name, actual, has_expectation=expected is not None)
    if expected is None:
        return result
    exp_records = expected.get("records", [])
    used = set()
    for i, j in _pair(exp_records, actual):
        if j is None:
            result.errors.append(f"record {i + 1} ({exp_records[i].get('role_title')}) not found")
            continue
        used.add(j)
        for name_, exp in exp_records[i].items():
            got = actual[j].get(name_)
            result.fields.append(FieldResult(i + 1, name_, got, check_field(exp, got)))
    for j in sorted(set(range(len(actual))) - used):
        result.errors.append(
            f"unexpected record: {actual[j]['company']} · {actual[j]['role_title']}"
        )
    return result


def _today(name: str, fallback: datetime) -> datetime:
    """Files are named YYYY-MM-DD-…: relative dates in the text resolve against that day."""
    try:
        return datetime.combine(date.fromisoformat(name[:10]), time(12), tzinfo=UTC)
    except ValueError:
        return fallback


def run_case(path: Path, llm: LLMClient, tz: ZoneInfo, now: datetime) -> CaseResult:
    system, user = paste.paste_prompt(path.read_text(), _today(path.name, now), tz)
    raw = llm.complete_json(
        system=system, user=user, schema=paste.PASTE_SCHEMA, max_tokens=paste.MAX_OUTPUT_TOKENS
    )
    actual = [record_json(r) for r in paste.parse_records(raw, tz)]
    path.with_suffix(".actual.json").write_text(json.dumps(actual, indent=2, ensure_ascii=False))
    expected_path = path.with_suffix(".expected.json")
    expected = json.loads(expected_path.read_text()) if expected_path.is_file() else None
    return compare(path.stem, expected, actual)


def _short(value: Any, limit: int = 140) -> str:
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else f"{text[:limit]}…"


def render(result: CaseResult) -> list[str]:
    if not result.has_expectation:
        return [
            f"? {result.name}: no expectation yet. Review {result.name}.actual.json and save the "
            f"parts you approve as {result.name}.expected.json"
        ]
    lines = [f"{'PASS' if result.passed else 'FAIL'} {result.name}"]
    lines += [f"    ! {e}" for e in result.errors]
    for f in result.fields:
        mark = "ok" if not f.problems else "XX"
        detail = f"  ({'; '.join(f.problems)})" if f.problems else ""
        lines.append(f"    {mark} #{f.record} {f.field} = {_short(f.actual)}{detail}")
    return lines
