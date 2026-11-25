"""The Apply area: your experience, the questions application forms ask, and your answers.

Questions come from the forms of postings on Greenhouse, Ashby, Lever and Workable (fetched by
adapters/ats_forms.py), or pasted by hand. Only the ones you write an answer for are kept: the
standard fields (name, CV, links…) and the one-line facts (location, pay, visa…) are not
questions here; the facts have their own list. Everything a form says is untrusted text.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from jobtracker.core.matching import normalize_company
from jobtracker.core.models import new_id
from jobtracker.core.ports import Clock

# (key, label, what goes in it). The first pass over a batch of 21 forms (2026-11-24) set them.
CATEGORIES: list[tuple[str, str, str]] = [
    ("projects", "Impact and projects", "What you built, what was yours, how you knew it worked"),
    ("ai", "AI in how you build", "Your setup, what you hand to agents, tooling you wrote"),
    ("why_us", "Why us", "Depends on the company: answer with the posting in mind"),
    ("job_search", "Your job search", "Why now, what you're looking for"),
    ("interviews", "Interview process", "Live coding, take-homes, how you prepare"),
    ("extra", "Anything else", "Cover letters and free-text extras"),
    ("other", "Uncategorized", "New questions the rules couldn't place"),
]
CATEGORY_KEYS = frozenset(k for k, _, _ in CATEGORIES)
MAX_TEXT = 2000  # a question, as the form wrote it
MAX_ANSWER = 20_000

# Rules for questions the first pass didn't see. Order matters: the first match wins.
_RULE_WORDS: list[tuple[str, list[str]]] = [
    ("job_search", [r"looking for", r"new (opportunit|role|job)", r"career goal", r"next (role|step)",
                    r"ideal (role|job|team)", r"why (are you )?leaving"]),
    ("why_us", [r"\bhave you used\b", r"^why\b", r"\bwhy (do|are|would) you\b",
                r"interested in (this|the|joining|working|us\b|our)", r"interests you",
                r"right (hire|fit|person|candidate)", r"\bqualif", r"drawn to", r"excit"]),
    ("ai", [r"\bAI\b", r"\bLLMs?\b", r"artificial intelligence", r"\bagents?\b", r"copilot",
            r"cursor", r"claude", r"chatgpt"]),
    ("projects", [r"\bbuil[td]\b", r"project", r"proud", r"impact", r"owned", r"ownership",
                  r"system", r"product", r"challeng", r"problem", r"success", r"worked\b",
                  r"contribution", r"shipp", r"\btool"]),
    ("interviews", [r"interview", r"live[- ]coding", r"take[- ]home", r"technical (test|assessment)"]),
    ("extra", [r"cover letter", r"anything else", r"additional information", r"\bshare\b"]),
]  # fmt: skip
_RULES = [(category, re.compile("|".join(words), re.I)) for category, words in _RULE_WORDS]

# Standard fields and one-line facts: never kept as questions.
_NOT_A_QUESTION = re.compile(
    r"^(first|last|full|preferred|legal)?\s*(and last )?name\b|e-?mail|phone|resume|\bcv\b|linkedin|github|"
    r"twitter|portfolio|website|\burl\b|pronoun|\bphoto\b|address|school|degree|field of study|"
    r"salary|compensation|\bpay\b|rate\b|location|located|country|countries|reside|relocat|"
    r"visa|sponsor|authori[sz]ed|legal(ly)? |citizen|english|spanish|language level|proficien|"
    r"hear about|heard about|referr|how did you (find|learn)|notice period|start date|"
    r"years of|consent|acknowledge|privacy|gender|ethnic|race|veteran|disabilit|age range|"
    r"current (company|employer|title)|if other|^other$|longitude|latitude",
    re.I,
)
# Field types (as each ATS names them) that hold free text.
_LONG_TEXT = {"textarea", "longtext", "paragraph", "free_text", "input_file/textarea"}
_SHORT_TEXT = {"input_text", "string", "text"}


@dataclass(slots=True)
class FormField:
    """One field of an application form, as an ATS adapter read it."""

    label: str
    type: str  # the ATS's own type name
    required: bool = False
    group: str = ""  # section, or "demographic" / "compliance"


@dataclass(slots=True)
class FormSource:
    """Where a question was seen: one posting's form, or a paste."""

    url: str  # the posting's URL; "paste:<id>" for one pasted by hand
    company: str = ""
    role_title: str = ""
    ats: str = ""  # greenhouse | ashby | lever | workable | paste
    text: str = ""  # the question as that form wrote it
    seen_at: datetime | None = None


@dataclass(slots=True)
class FormQuestion:
    text: str
    normalized: str
    category: str
    id: uuid.UUID = field(default_factory=new_id)
    answer: str = ""
    style_notes: str = ""  # how you want it answered: length, structure, tone
    answered_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    sources: list[FormSource] = field(default_factory=list)


@dataclass(slots=True)
class Experience:
    """One project or role, in enough detail to answer from and to reread before an interview."""

    title: str
    id: uuid.UUID = field(default_factory=new_id)
    company: str = ""
    period: str = ""  # free text: "2023–2025", "Mar 2024 – now"
    summary: str = ""  # one line
    context: str = ""  # the problem, the team, the constraints
    contribution: str = ""  # what you did yourself
    results: str = ""  # how you knew it worked: numbers, users, what changed
    stack: str = ""
    links: str = ""
    position: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class Fact:
    """A one-line answer you give the same way on every form (location, pay, visa…)."""

    key: str
    label: str
    value: str = ""
    notes: str = ""
    position: int = 0
    updated_at: datetime | None = None


class ApplyRepo(Protocol):
    def list_questions(self) -> list[FormQuestion]: ...
    def get_question(self, question_id: uuid.UUID) -> FormQuestion | None: ...
    def find_question(self, normalized: str) -> FormQuestion | None: ...
    def save_question(self, q: FormQuestion) -> None: ...
    def add_question_source(self, question_id: uuid.UUID, source: FormSource) -> bool: ...
    def delete_question(self, question_id: uuid.UUID) -> None: ...


class ApplyError(ValueError):
    pass


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c)).lower()


def normalize(text: str, company: str = "") -> str:
    """What two wordings of the same question share: lowercase words, with the company's name
    replaced by "company" (so "Why Acme?" and "Why Initech?" are one question)."""
    words = re.sub(r"[^a-z0-9]+", " ", _fold(text)).split()
    full = re.sub(r"[^a-z0-9]+", " ", _fold(company)).split()
    short = normalize_company(company).split() if company else []
    for name in sorted({tuple(full), tuple(short)} - {()}, key=len, reverse=True):
        n, out, i = len(name), [], 0
        while i < len(words):
            if tuple(words[i : i + n]) == name:
                out.append("company")
                i += n
            else:
                out.append(words[i])
                i += 1
        words = out
    return " ".join(words)[:500]


def classify(text: str) -> str:
    for category, rule in _RULES:
        if rule.search(text):
            return category
    return "other"


def is_open_question(f: FormField) -> bool:
    """A question you answer in your own words: free text, not a standard field or a fact."""
    kind = f.type.lower()
    label = f.label.strip()
    if f.group in ("demographic", "compliance") or len(label) < 8:
        return False
    if _NOT_A_QUESTION.search(label) and not re.search(r"cover letter|anything else", label, re.I):
        return False
    if kind in _LONG_TEXT:
        return True
    # Short text boxes are mostly facts; keep the ones the rules can place ("Why Acme?").
    return kind in _SHORT_TEXT and classify(label) != "other" and len(label) >= 12


@dataclass
class CollectResult:
    forms: int = 0
    new_questions: int = 0
    new_sources: int = 0
    skipped: list[str] = field(default_factory=list)  # "<url>: <why>"


def record(
    repo: ApplyRepo,
    clock: Clock,
    text: str,
    source: FormSource,
    category: str | None = None,
) -> tuple[FormQuestion, bool, bool]:
    """Add a question, or one more place it was seen. Returns the question, whether it's new, and
    whether the source is. A question you already have keeps its text, category and answer."""
    text = re.sub(r"\s+", " ", text).strip()[:MAX_TEXT]
    if not text:
        raise ApplyError("A question needs some text")
    if category is not None and category not in CATEGORY_KEYS:
        raise ApplyError(f"Unknown category {category!r}")
    norm = normalize(text, source.company)
    now = clock.now()
    q = repo.find_question(norm)
    created = q is None
    if q is None:
        q = FormQuestion(
            text=text, normalized=norm, category=category or classify(text), created_at=now
        )
        q.updated_at = now
        repo.save_question(q)
    source.text = source.text or text
    source.seen_at = source.seen_at or now
    added = repo.add_question_source(q.id, source)
    return q, created, added


def collect(
    repo: ApplyRepo, clock: Clock, forms: Iterable[tuple[FormSource, list[FormField]]]
) -> CollectResult:
    """Keep the open questions of each form (fetched by the caller)."""
    result = CollectResult()
    for source, fields in forms:
        result.forms += 1
        for f in fields:
            if not is_open_question(f):
                continue
            s = FormSource(
                url=source.url, company=source.company, role_title=source.role_title,
                ats=source.ats, text=f.label,
            )  # fmt: skip
            _, created, added = record(repo, clock, f.label, s)
            result.new_questions += created
            result.new_sources += added
    return result


def update_question(
    repo: ApplyRepo,
    clock: Clock,
    q: FormQuestion,
    *,
    answer: str | None = None,
    style_notes: str | None = None,
    category: str | None = None,
    text: str | None = None,
) -> FormQuestion:
    now = clock.now()
    if category is not None:
        if category not in CATEGORY_KEYS:
            raise ApplyError(f"Unknown category {category!r}")
        q.category = category
    if text is not None:
        text = re.sub(r"\s+", " ", text).strip()[:MAX_TEXT]
        if not text:
            raise ApplyError("A question needs some text")
        q.text = text
    if style_notes is not None:
        q.style_notes = style_notes.strip()[:MAX_TEXT]
    if answer is not None:
        answer = answer.strip()[:MAX_ANSWER]
        if answer != q.answer:
            q.answered_at = now if answer else None
        q.answer = answer
    q.updated_at = now
    repo.save_question(q)
    return q
