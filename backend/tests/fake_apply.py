"""In-memory Apply tables for MemoryRepo (adapters/db/apply_repo.py is the real one)."""

from __future__ import annotations

import copy
import uuid

from jobtracker.core.apply import Experience, Fact, FormQuestion, FormSource


class MemoryApplyMixin:
    def _apply_init(self) -> None:
        self.questions: dict[uuid.UUID, FormQuestion] = {}
        self.question_sources: dict[uuid.UUID, list[FormSource]] = {}
        self.experiences: dict[uuid.UUID, Experience] = {}
        self.facts: dict[str, Fact] = {}

    def _question(self, q: FormQuestion) -> FormQuestion:
        out = copy.copy(q)
        out.sources = [copy.copy(s) for s in self.question_sources.get(q.id, [])]
        return out

    def list_questions(self):
        return [
            self._question(q) for q in sorted(self.questions.values(), key=lambda q: q.created_at)
        ]

    def get_question(self, question_id):
        q = self.questions.get(question_id)
        return self._question(q) if q else None

    def find_question(self, normalized):
        q = next((q for q in self.questions.values() if q.normalized == normalized), None)
        return self._question(q) if q else None

    def save_question(self, q):
        stored = copy.copy(q)
        stored.sources = []
        self.questions[q.id] = stored

    def add_question_source(self, question_id, source):
        sources = self.question_sources.setdefault(question_id, [])
        if any(s.url == source.url for s in sources):
            return False
        sources.append(copy.copy(source))
        return True

    def delete_question(self, question_id):
        self.questions.pop(question_id, None)
        self.question_sources.pop(question_id, None)

    def list_experiences(self):
        return sorted((copy.copy(e) for e in self.experiences.values()),
                      key=lambda e: (e.position, e.created_at))  # fmt: skip

    def get_experience(self, experience_id):
        e = self.experiences.get(experience_id)
        return copy.copy(e) if e else None

    def save_experience(self, e):
        self.experiences[e.id] = copy.copy(e)

    def delete_experience(self, experience_id):
        self.experiences.pop(experience_id, None)

    def list_facts(self):
        return sorted(
            (copy.copy(f) for f in self.facts.values()), key=lambda f: (f.position, f.key)
        )

    def save_fact(self, f):
        self.facts[f.key] = copy.copy(f)

    def delete_fact(self, key):
        self.facts.pop(key, None)
