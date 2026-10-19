"""Use cases shared by the API, the CLI and the pipeline. Callers own the transaction."""

from __future__ import annotations

import csv
import io
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from jobtracker.core.extraction import parse_extraction
from jobtracker.core.filtering import FREEMAIL_DOMAINS, JOB_BOARD_DOMAINS, domain_matches
from jobtracker.core.matching import aliases_to_learn, match, normalize_company
from jobtracker.core.models import (
    AliasKind,
    Application,
    Company,
    CompanyAlias,
    EmailMessage,
    Event,
    EventKind,
    EventType,
    Extraction,
    MatchMethod,
    Origin,
    Stage,
)
from jobtracker.core.ports import Clock, Repository
from jobtracker.core.stages import apply_projection, project


class NotFound(Exception):
    pass


class InvalidInput(ValueError):
    pass


def get_or_create_company(
    repo: Repository, clock: Clock, name: str, domain: str | None = None
) -> Company:
    name = name.strip()
    if not name:
        raise InvalidInput("company name is required")
    normalized = normalize_company(name)
    company = repo.find_company_by_name(normalized)
    if company is None:
        company = Company(name=name, normalized_name=normalized, created_at=clock.now())
        repo.add_company(company)
    if domain:
        add_company_domain(repo, company, domain, "application")
    return company


def add_company_domain(repo: Repository, company: Company, domain: str, learned_from: str) -> bool:
    domain = domain.strip().lower().removeprefix("www.")
    shared = set(repo.ats_domains()) | JOB_BOARD_DOMAINS
    if not domain or domain in FREEMAIL_DOMAINS or domain_matches(domain, shared):
        return False
    return repo.add_alias(CompanyAlias(company.id, AliasKind.DOMAIN, domain, learned_from))


def _domain_from_url(url: str | None) -> str | None:
    if not url:
        return None
    host = (urlparse(url if "//" in url else f"https://{url}").hostname or "").lower()
    return host.removeprefix("www.") or None


@dataclass(slots=True)
class ApplicationInput:
    company: str
    role_title: str
    job_url: str | None = None
    company_domain: str | None = None
    job_description: str | None = None
    source_ats: str | None = None
    source_channel: str | None = None
    seniority: str | None = None
    stack: list[str] = field(default_factory=list)
    location: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_currency: str | None = None
    benefits: str | None = None
    applied_at: datetime | None = None
    stage: Stage | None = None  # historical imports: where the process ended up
    stage_at: datetime | None = None
    notes: str | None = None


def guess_ats(url: str | None, ats_domains: dict[str, str]) -> str | None:
    host = _domain_from_url(url)
    if not host:
        return None
    hit = domain_matches(host, set(ats_domains))
    return ats_domains[hit] if hit else None


def create_application(
    repo: Repository, clock: Clock, data: ApplicationInput, origin: Origin = Origin.MANUAL
) -> Application:
    if not data.role_title.strip():
        raise InvalidInput("role title is required")
    company = get_or_create_company(repo, clock, data.company, data.company_domain)
    ats = repo.ats_domains()
    if data.job_url and not data.company_domain:
        # A careers page on the company's own domain teaches the allowlist too.
        add_company_domain(repo, company, _domain_from_url(data.job_url) or "", "application")
    now = clock.now()
    app = Application(
        company_id=company.id,
        company_name=company.name,
        role_title=data.role_title.strip(),
        job_url=data.job_url,
        job_description=data.job_description,
        source_ats=data.source_ats or guess_ats(data.job_url, ats),
        source_channel=data.source_channel,
        seniority=data.seniority,
        stack=[s.strip() for s in data.stack if s.strip()],
        location=data.location,
        salary_min=data.salary_min,
        salary_max=data.salary_max,
        salary_currency=(data.salary_currency or "").upper() or None,
        benefits=data.benefits,
        applied_at=data.applied_at or now,
        origin=origin,
        notes=data.notes,
        created_at=now,
        updated_at=now,
    )
    repo.add_application(app)
    if data.salary_min and data.salary_max and data.salary_min > data.salary_max:
        raise InvalidInput("salary min is greater than salary max")
    if data.stage and data.stage != Stage.APPLIED:
        change_stage(
            repo, clock, app.id, data.stage, at=data.stage_at or app.applied_at, note="imported"
        )
    return app


def create_application_from_email(
    repo: Repository,
    clock: Clock,
    extraction: Extraction,
    email: EmailMessage,
    company_id: uuid.UUID | None,
) -> Application:
    ats = repo.ats_domains()
    if company_id:
        company = repo.get_company(company_id)
        if company is None:
            raise NotFound(str(company_id))
    else:
        company = get_or_create_company(repo, clock, extraction.company or "Unknown")
    for kind, value in aliases_to_learn(email.from_address, email.from_name, set(ats)):
        repo.add_alias(CompanyAlias(company.id, kind, value, "auto_create"))
    hit = domain_matches(email.from_domain, set(ats))
    now = clock.now()
    app = Application(
        company_id=company.id,
        company_name=company.name,
        role_title=extraction.role or "(unknown role)",
        source_ats=ats[hit] if hit else ("linkedin" if "linkedin" in email.from_domain else None),
        source_channel="linkedin" if "linkedin" in email.from_domain else None,
        applied_at=email.received_at,
        origin=Origin.EMAIL,
        needs_review=True,
        created_at=now,
        updated_at=now,
    )
    repo.add_application(app)
    return app


def recompute(repo: Repository, clock: Clock, app_id: uuid.UUID) -> Application:
    app = repo.get_application(app_id)
    if app is None:
        raise NotFound(str(app_id))
    apply_projection(app, project(app, repo.list_events(app_id), clock.now()))
    app.updated_at = clock.now()
    repo.update_application(app)
    return app


def change_stage(
    repo: Repository,
    clock: Clock,
    app_id: uuid.UUID,
    stage: Stage,
    at: datetime | None = None,
    round_: int | None = None,
    note: str | None = None,
) -> Event:
    if repo.get_application(app_id) is None:
        raise NotFound(str(app_id))
    event = Event(
        kind=EventKind.MANUAL,
        event_type=EventType.MANUAL_STAGE_CHANGE,
        occurred_at=at or clock.now(),
        application_id=app_id,
        stage_implied=stage,
        round=round_,
        summary=note,
        match_method=MatchMethod.MANUAL,
        assigned_by="manual",
        created_at=clock.now(),
    )
    repo.add_event(event)
    recompute(repo, clock, app_id)
    return event


def assign_event(
    repo: Repository, clock: Clock, tz: ZoneInfo, event_id: uuid.UUID, app_id: uuid.UUID
) -> Event:
    event = repo.get_event(event_id)
    app = repo.get_application(app_id)
    if event is None or app is None:
        raise NotFound(str(event_id if event is None else app_id))
    previous = event.application_id
    event.application_id = app_id
    event.company_hint_id = app.company_id
    event.match_method = MatchMethod.MANUAL
    event.assigned_by = "manual"
    event.dismissed = False
    repo.update_event(event)
    if event.from_address:
        for kind, value in aliases_to_learn(
            event.from_address, event.from_name or "", set(repo.ats_domains())
        ):
            repo.add_alias(CompanyAlias(app.company_id, kind, value, "manual_assignment"))
    recompute(repo, clock, app_id)
    if previous and previous != app_id:
        recompute(repo, clock, previous)
    rematch_unassigned(repo, clock, tz)
    return event


def dismiss_event(repo: Repository, event_id: uuid.UUID) -> Event:
    event = repo.get_event(event_id)
    if event is None:
        raise NotFound(str(event_id))
    event.dismissed = True
    repo.update_event(event)
    return event


def _email_stub(event: Event) -> EmailMessage:
    return EmailMessage(
        message_id=event.message_id or "",
        from_address=event.from_address or "",
        from_name=event.from_name or "",
        subject=event.subject or "",
        received_at=event.occurred_at,
        text="",
        gm_thread_id=event.gm_thread_id,
        in_reply_to=event.in_reply_to,
        references=event.references,
    )


def rematch_unassigned(repo: Repository, clock: Clock, tz: ZoneInfo) -> int:
    """Re-run matching on the inbox, e.g. after an assignment taught a new alias. Never creates."""
    assigned = 0
    touched: set[uuid.UUID] = set()
    for event in repo.list_unassigned():
        if event.dismissed or event.kind != EventKind.EMAIL:
            continue
        stub = _email_stub(event)
        thread = repo.thread_lookup(
            event.gm_thread_id, [event.in_reply_to or "", *event.references]
        )
        extraction = parse_extraction(event.extraction or {}, tz)
        result = match(stub, extraction, repo, thread.application_id)
        if result.application_id:
            event.application_id = result.application_id
            event.company_hint_id = result.company_id
            event.match_method = result.method
            event.assigned_by = "auto"
            repo.update_event(event)
            touched.add(result.application_id)
            assigned += 1
    for app_id in touched:
        recompute(repo, clock, app_id)
    return assigned


def create_application_from_event(
    repo: Repository, clock: Clock, tz: ZoneInfo, event_id: uuid.UUID, data: ApplicationInput
) -> Application:
    event = repo.get_event(event_id)
    if event is None:
        raise NotFound(str(event_id))
    data.applied_at = data.applied_at or event.occurred_at
    app = create_application(repo, clock, data)
    assign_event(repo, clock, tz, event_id, app.id)
    return app


def delete_application(repo: Repository, clock: Clock, app_id: uuid.UUID) -> None:
    """Email events go back to the inbox; manual events and notes are removed with the app."""
    if repo.get_application(app_id) is None:
        raise NotFound(str(app_id))
    for event in repo.list_events(app_id):
        if event.kind == EventKind.EMAIL:
            event.application_id = None
            event.match_method = MatchMethod.NONE
            event.assigned_by = None
            repo.update_event(event)
    for note in repo.list_notes(app_id):
        repo.delete_note(note.id)
    repo.delete_application(app_id)


def mark_reviewed(repo: Repository, clock: Clock, app_id: uuid.UUID) -> Application:
    app = repo.get_application(app_id)
    if app is None:
        raise NotFound(str(app_id))
    app.needs_review = False
    app.updated_at = clock.now()
    repo.update_application(app)
    return app


CSV_COLUMNS = [
    "company", "role", "job_url", "company_domain", "source_ats", "source_channel",
    "applied_at", "stage", "seniority", "stack", "location", "notes",
]  # fmt: skip


def _parse_date(value: str, tz: ZoneInfo) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    for parser in (datetime.fromisoformat, lambda v: datetime.strptime(v, "%d/%m/%Y")):
        try:
            parsed = parser(value)
        except ValueError:
            continue
        if isinstance(parsed, datetime) and parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=tz)
        return parsed.astimezone(UTC)
    raise InvalidInput(f"unrecognized date {value!r} (use YYYY-MM-DD or DD/MM/YYYY)")


def parse_csv(text: str, tz: ZoneInfo) -> list[ApplicationInput]:
    reader = csv.DictReader(io.StringIO(text.strip()))
    if not reader.fieldnames or not {"company", "role"} <= {
        f.strip().lower() for f in reader.fieldnames
    }:
        raise InvalidInput(
            f"CSV needs at least 'company' and 'role' columns; supported: {', '.join(CSV_COLUMNS)}"
        )
    rows: list[ApplicationInput] = []
    for i, row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        try:
            stage = Stage(row["stage"].lower()) if row.get("stage") else None
        except ValueError as err:
            raise InvalidInput(f"line {i}: unknown stage {row['stage']!r}") from err
        if not row.get("company") or not row.get("role"):
            raise InvalidInput(f"line {i}: company and role are required")
        rows.append(
            ApplicationInput(
                company=row["company"],
                role_title=row["role"],
                job_url=row.get("job_url") or None,
                company_domain=row.get("company_domain") or None,
                source_ats=row.get("source_ats") or None,
                source_channel=row.get("source_channel") or None,
                applied_at=_parse_date(row.get("applied_at", ""), tz),
                stage=stage,
                seniority=row.get("seniority") or None,
                stack=[s for s in row.get("stack", "").replace(",", ";").split(";") if s.strip()],
                location=row.get("location") or None,
                notes=row.get("notes") or None,
            )
        )
    return rows


def day_start(d: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, time.min, tzinfo=tz).astimezone(UTC)
