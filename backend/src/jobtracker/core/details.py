"""Fill an application's details (stack, location, salary…) from the emails already assigned to it.

The emails are re-read from the mailbox (only snippets are stored), joined into one text and
read by the paste prompt scoped to the application. Only empty fields get filled (stack and notes
get added to); a value you already have is never overwritten, the would-be change is reported.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from jobtracker.core import paste, services
from jobtracker.core.email_parse import clean_body
from jobtracker.core.models import AliasKind, Application, EmailMessage, Event
from jobtracker.core.ports import Clock, LLMClient, MailSource, Repository

MAX_EMAIL_CHARS = 8_000  # a pasted job post fits; long legal footers get cut

EMAILS_NOTE = """

The text is every email of this application, oldest first (ATS confirmations, recruiter \
messages, interview invites, rejections). Take details from the job post or the recruiter's \
words; ignore ATS boilerplate, legal notices (EEO, privacy), signatures and footers. When emails \
disagree, the most recent one wins. Leave stage "": the user tracks stages separately."""


def message_ids(events: list[Event]) -> list[str]:
    """The application's emails, oldest first (manual stage changes have no message)."""
    ordered = sorted((e for e in events if e.message_id), key=lambda e: e.occurred_at)
    return list(dict.fromkeys(e.message_id for e in ordered if e.message_id))


def emails_text(emails: list[EmailMessage], tz: ZoneInfo) -> str:
    parts = []
    emails = sorted(emails, key=lambda m: m.received_at)
    for i, m in enumerate(emails, 1):
        sender = f"{m.from_name} <{m.from_address}>" if m.from_name else m.from_address
        when = m.received_at.astimezone(tz).date().isoformat()
        parts.append(
            f"--- Email {i} of {len(emails)} · {when} · From: {sender}\n"
            f"Subject: {m.subject}\n\n{clean_body(m.text, MAX_EMAIL_CHARS)}"
        )
    return "\n\n".join(parts)[: paste.MAX_PASTE_CHARS]


def details_prompt(text: str, now: datetime, tz: ZoneInfo, app: Application) -> tuple[str, str]:
    system, user = paste.paste_prompt(text, now, tz, app)
    return system + EMAILS_NOTE, user


def proposal(raw: dict, tz: ZoneInfo, app: Application) -> paste.ProposedRecord | None:
    """The one record for this application, without a stage (stages are tracked by hand)."""
    records = paste.parse_records(raw, tz, app.company_name)
    if not records:
        return None
    rec = records[0]
    rec.stage, rec.stage_at = None, None
    return rec


def has_no_details(app: Application) -> bool:
    """None of the fields an email could fill is set yet."""
    return not (
        app.stack
        or app.location
        or app.seniority
        or app.job_description
        or app.salary_min is not None
        or app.benefits
    )


@dataclass
class FillResult:
    app: Application
    emails_read: int = 0
    emails_missing: int = 0
    applied: list[paste.FieldChange] = field(default_factory=list)
    skipped: list[paste.FieldChange] = field(default_factory=list)  # would overwrite a value
    salary_note: str | None = None
    error: str | None = None


def fill_application(
    repo: Repository,
    clock: Clock,
    source: MailSource,
    llm: LLMClient,
    tz: ZoneInfo,
    app: Application,
    dry_run: bool = False,
) -> FillResult:
    """Read the application's emails and fill its empty fields. The caller owns the transaction."""
    result = FillResult(app)
    ids = message_ids(repo.list_events(app.id))
    emails = list(source.fetch_by_message_ids(ids)) if ids else []
    result.emails_read, result.emails_missing = len(emails), len(ids) - len(emails)
    if not emails:
        result.error = "no emails to read" if not ids else "its emails aren't in Gmail anymore"
        return result
    system, user = details_prompt(emails_text(emails, tz), clock.now(), tz, app)
    raw = llm.complete_json(
        system=system, user=user, schema=paste.PASTE_SCHEMA, max_tokens=paste.MAX_OUTPUT_TOKENS
    )
    rec = proposal(raw, tz, app)
    if rec is None:
        return result
    result.salary_note = rec.salary_note
    domains = {al.value for al in repo.list_aliases(app.company_id) if al.kind == AliasKind.DOMAIN}
    for change in paste.diff(app, rec, domains, has_plan=bool(repo.list_steps(app.id))):
        (result.skipped if change.overwrites else result.applied).append(change)
    if result.applied and not dry_run:
        patch = {c.field: c.proposed for c in result.applied}
        result.app = services.update_fields(repo, clock, app.id, patch, learned_from="email")
    return result
