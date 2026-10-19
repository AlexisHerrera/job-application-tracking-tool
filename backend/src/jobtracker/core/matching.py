"""Matching cascade: thread -> sender alias -> fuzzy company+role -> unassigned. Plus alias learning."""

from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass

from rapidfuzz import fuzz

from jobtracker.core.filtering import FREEMAIL_DOMAINS, JOB_BOARD_DOMAINS, domain_matches
from jobtracker.core.models import (
    AliasKind,
    Application,
    Company,
    EmailMessage,
    EventType,
    Extraction,
    MatchMethod,
)
from jobtracker.core.ports import Repository
from jobtracker.core.stages import is_active

_SUFFIXES = {
    "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "sa", "srl",
    "sas", "bv", "plc", "labs", "lab", "hq", "ai", "io", "app", "technologies", "technology",
    "software", "group", "the",
}  # fmt: skip

GENERIC_LOCALPARTS = re.compile(
    r"^(no-?reply|do-?not-?reply|notifications?|jobs|careers|talent|recruiting|recruitment|"
    r"hiring|hello|hi|support|team|mail|info|candidates?|applications?|messages?|"
    r"inmail-hit-reply|invitations?)([+.-].*)?$"
)
GENERIC_DISPLAY_NAMES = re.compile(
    r"^(greenhouse|lever|ashby|workable|linkedin|indeed|smartrecruiters|workday|bamboohr|"
    r"jobvite|icims|teamtailor|recruitee|breezy|rippling|gem|goodtime|calendly|no-?reply|"
    r"hiring team|recruiting team|talent team|careers)$",
    re.IGNORECASE,
)
_NAME_NOISE = re.compile(
    r"\b(hiring|recruiting|talent|careers|people|team|equipo|de|via|at|the|acquisition|hr)\b",
    re.IGNORECASE,
)


def normalize_company(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\.(?=[a-z]\b|\s|$)", "", text)  # "S.A." -> "SA", "Inc." -> "Inc"
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    words = [w for w in text.split() if w not in _SUFFIXES]
    return " ".join(words) or text.strip()


def display_name_key(display_name: str) -> str | None:
    """'Sluicebox Hiring Team' -> 'sluicebox'. None when the name is the ATS itself."""
    name = display_name.strip().strip('"')
    if not name or GENERIC_DISPLAY_NAMES.match(name):
        return None
    cleaned = _NAME_NOISE.sub(" ", name)
    key = normalize_company(cleaned)
    return key or None


@dataclass(slots=True)
class MatchResult:
    application_id: uuid.UUID | None
    company_id: uuid.UUID | None
    method: MatchMethod
    score: float = 0.0
    create_application: bool = False


@dataclass(slots=True)
class MatchConfig:
    company_threshold: float = 85.0
    combined_threshold: float = 80.0
    margin: float = 5.0
    create_min_confidence: float = 0.7


def _company_from_sender(
    email: EmailMessage, repo: Repository, ats: dict[str, str]
) -> Company | None:
    domain = email.from_domain
    shared = set(ats) | JOB_BOARD_DOMAINS
    if not domain_matches(domain, shared) and domain not in FREEMAIL_DOMAINS:
        company_domains = repo.company_domains()
        if hit := domain_matches(domain, company_domains):
            company = repo.find_company_by_alias(AliasKind.DOMAIN, hit)
            if company:
                return company
    company = repo.find_company_by_alias(AliasKind.ADDRESS, email.from_address)
    if company:
        return company
    if key := display_name_key(email.from_name):
        return repo.find_company_by_alias(AliasKind.DISPLAY_NAME, key)
    return None


def _pick_by_role(
    apps: list[Application], role: str | None, cfg: MatchConfig
) -> Application | None:
    if len(apps) == 1:
        return apps[0]
    if not role or not apps:
        return None
    scored = sorted(
        ((fuzz.token_set_ratio(role.lower(), a.role_title.lower()), a) for a in apps),
        key=lambda t: t[0],
        reverse=True,
    )
    best, second = scored[0], scored[1] if len(scored) > 1 else (0.0, None)
    if best[0] >= cfg.combined_threshold and best[0] - second[0] >= cfg.margin:
        return best[1]
    return None


def match(
    email: EmailMessage,
    extraction: Extraction,
    repo: Repository,
    thread_app_id: uuid.UUID | None,
    cfg: MatchConfig | None = None,
) -> MatchResult:
    cfg = cfg or MatchConfig()
    ats = repo.ats_domains()

    # 1. Same thread as an already-assigned event.
    if thread_app_id:
        app = repo.get_application(thread_app_id)
        return MatchResult(thread_app_id, app.company_id if app else None, MatchMethod.THREAD, 100)

    apps = repo.list_applications()

    # 2. Sender maps to a known company.
    company = _company_from_sender(email, repo, ats)
    if company:
        mine = [a for a in apps if a.company_id == company.id]
        active = [a for a in mine if is_active(a)]
        chosen = _pick_by_role(active, extraction.role, cfg) or (
            mine[0] if len(mine) == 1 else None
        )
        if chosen:
            return MatchResult(chosen.id, company.id, MatchMethod.ALIAS, 100)
        if _should_create(extraction, cfg) and not _role_exists(mine, extraction.role):
            return MatchResult(None, company.id, MatchMethod.CREATED, create_application=True)
        return MatchResult(None, company.id, MatchMethod.NONE)

    # 3. Fuzzy company (+ role) against active applications.
    if extraction.company:
        target = normalize_company(extraction.company)
        scored: list[tuple[float, float, Application]] = []
        for a in apps:
            c_score = fuzz.ratio(target, normalize_company(a.company_name))
            if c_score < cfg.company_threshold:
                continue
            r_score = (
                fuzz.token_set_ratio(extraction.role.lower(), a.role_title.lower())
                if extraction.role
                else 0.0
            )
            scored.append((c_score, r_score, a))
        active = [t for t in scored if is_active(t[2])] or scored
        if active:
            company_id = active[0][2].company_id
            same_company = {t[2].company_id for t in active}
            if len(same_company) == 1:
                chosen = _pick_by_role([t[2] for t in active], extraction.role, cfg)
                if chosen and extraction.confidence >= 0.5:
                    score = max(t[0] * 0.6 + t[1] * 0.4 for t in active if t[2] is chosen)
                    return MatchResult(chosen.id, company_id, MatchMethod.FUZZY, score)
                if _should_create(extraction, cfg) and not _role_exists(
                    [t[2] for t in active], extraction.role
                ):
                    return MatchResult(
                        None, company_id, MatchMethod.CREATED, create_application=True
                    )
            return MatchResult(
                None, company_id if len(same_company) == 1 else None, MatchMethod.NONE
            )

        existing = repo.find_company_by_name(target)
        if existing:
            if _should_create(extraction, cfg):
                return MatchResult(None, existing.id, MatchMethod.CREATED, create_application=True)
            return MatchResult(None, existing.id, MatchMethod.NONE)

    # 4. Nothing matched: brand-new company from a confirmation email, or unassigned.
    if _should_create(extraction, cfg):
        return MatchResult(None, None, MatchMethod.CREATED, create_application=True)
    return MatchResult(None, None, MatchMethod.NONE)


def _should_create(extraction: Extraction, cfg: MatchConfig) -> bool:
    return (
        extraction.event_type == EventType.APPLICATION_RECEIVED
        and extraction.confidence >= cfg.create_min_confidence
        and bool(extraction.company)
    )


def _role_exists(apps: list[Application], role: str | None) -> bool:
    if not role:
        return bool(apps)
    return any(fuzz.token_set_ratio(role.lower(), a.role_title.lower()) >= 90 for a in apps)


def aliases_to_learn(
    email_from: str, from_name: str, ats_domains: set[str]
) -> list[tuple[AliasKind, str]]:
    """What a manual assignment should teach, without poisoning shared ATS senders."""
    address = email_from.lower()
    local, _, domain = address.partition("@")
    out: list[tuple[AliasKind, str]] = []
    is_ats = domain_matches(domain, ats_domains | JOB_BOARD_DOMAINS) is not None
    if not is_ats and domain and domain not in FREEMAIL_DOMAINS:
        out.append((AliasKind.DOMAIN, domain))
    elif domain in FREEMAIL_DOMAINS or not GENERIC_LOCALPARTS.match(local):
        out.append((AliasKind.ADDRESS, address))
    if is_ats and (key := display_name_key(from_name)):
        out.append((AliasKind.DISPLAY_NAME, key))
    return out
