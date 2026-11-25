"""The Apply area's tables (migration 0017), mixed into PostgresRepo."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import psycopg

from jobtracker.core.apply import Experience, Fact, FormQuestion, FormSource

EXPERIENCE_COLUMNS = [
    "id", "title", "company", "period", "summary", "context", "contribution", "results", "stack",
    "links", "position", "created_at", "updated_at",
]  # fmt: skip
QUESTION_COLUMNS = [
    "id", "text", "normalized", "category", "answer", "style_notes", "answered_at", "created_at",
    "updated_at",
]  # fmt: skip


def _upsert(table: str, cols: list[str], key: str) -> str:
    sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in (key, "created_at"))
    return (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(f'%({c})s' for c in cols)})"
        f" ON CONFLICT ({key}) DO UPDATE SET {sets}"
    )


def _source_from(r: dict) -> FormSource:
    return FormSource(
        url=r["url"], company=r["company"], role_title=r["role_title"], ats=r["ats"],
        text=r["text"], seen_at=r["seen_at"],
    )  # fmt: skip


class ApplyRepoMixin:
    conn: psycopg.Connection

    if TYPE_CHECKING:  # PostgresRepo's

        def _all(self, sql: str, params: tuple | dict = ()) -> list[dict]: ...
        def _one(self, sql: str, params: tuple | dict = ()) -> dict | None: ...

    # questions
    def _questions(self, where: str = "", params: tuple = ()) -> list[FormQuestion]:
        rows = self._all(f"SELECT * FROM form_questions {where} ORDER BY created_at, text", params)
        if not rows:
            return []
        ids = [r["id"] for r in rows]
        sources: dict[uuid.UUID, list[FormSource]] = defaultdict(list)
        for r in self._all(
            "SELECT * FROM form_question_sources WHERE question_id = ANY(%s::uuid[]) ORDER BY seen_at",
            (ids,),
        ):
            sources[r["question_id"]].append(_source_from(r))
        return [
            FormQuestion(**{c: r[c] for c in QUESTION_COLUMNS}, sources=sources[r["id"]])
            for r in rows
        ]

    def list_questions(self) -> list[FormQuestion]:
        return self._questions()

    def get_question(self, question_id: uuid.UUID) -> FormQuestion | None:
        found = self._questions("WHERE id = %s", (question_id,))
        return found[0] if found else None

    def find_question(self, normalized: str) -> FormQuestion | None:
        found = self._questions("WHERE normalized = %s", (normalized,))
        return found[0] if found else None

    def save_question(self, q: FormQuestion) -> None:
        row = {c: getattr(q, c) for c in QUESTION_COLUMNS}
        row["created_at"] = row["created_at"] or datetime.now(UTC)
        row["updated_at"] = row["updated_at"] or row["created_at"]
        self.conn.execute(_upsert("form_questions", QUESTION_COLUMNS, "id"), row)

    def add_question_source(self, question_id: uuid.UUID, source: FormSource) -> bool:
        cur = self.conn.execute(
            "INSERT INTO form_question_sources"
            " (question_id, url, company, role_title, ats, text, seen_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (question_id, source.url, source.company, source.role_title, source.ats,
             source.text, source.seen_at or datetime.now(UTC)),
        )  # fmt: skip
        return cur.rowcount > 0

    def delete_question(self, question_id: uuid.UUID) -> None:
        self.conn.execute(
            "DELETE FROM form_question_sources WHERE question_id = %s", (question_id,)
        )
        self.conn.execute("DELETE FROM form_questions WHERE id = %s", (question_id,))

    # experience
    def list_experiences(self) -> list[Experience]:
        rows = self._all("SELECT * FROM experiences ORDER BY position, created_at")
        return [Experience(**{c: r[c] for c in EXPERIENCE_COLUMNS}) for r in rows]

    def get_experience(self, experience_id: uuid.UUID) -> Experience | None:
        r = self._one("SELECT * FROM experiences WHERE id = %s", (experience_id,))
        return Experience(**{c: r[c] for c in EXPERIENCE_COLUMNS}) if r else None

    def save_experience(self, e: Experience) -> None:
        row = {c: getattr(e, c) for c in EXPERIENCE_COLUMNS}
        row["created_at"] = row["created_at"] or datetime.now(UTC)
        row["updated_at"] = row["updated_at"] or row["created_at"]
        self.conn.execute(_upsert("experiences", EXPERIENCE_COLUMNS, "id"), row)

    def delete_experience(self, experience_id: uuid.UUID) -> None:
        self.conn.execute("DELETE FROM experiences WHERE id = %s", (experience_id,))

    # facts
    def list_facts(self) -> list[Fact]:
        rows = self._all("SELECT * FROM apply_facts ORDER BY position, key")
        return [
            Fact(key=r["key"], label=r["label"], value=r["value"], notes=r["notes"],
                 position=r["position"], updated_at=r["updated_at"])
            for r in rows
        ]  # fmt: skip

    def save_fact(self, f: Fact) -> None:
        self.conn.execute(
            "INSERT INTO apply_facts (key, label, value, notes, position, updated_at)"
            " VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (key) DO UPDATE SET"
            " label = EXCLUDED.label, value = EXCLUDED.value, notes = EXCLUDED.notes,"
            " position = EXCLUDED.position, updated_at = EXCLUDED.updated_at",
            (f.key, f.label, f.value, f.notes, f.position, f.updated_at or datetime.now(UTC)),
        )

    def delete_fact(self, key: str) -> None:
        self.conn.execute("DELETE FROM apply_facts WHERE key = %s", (key,))
