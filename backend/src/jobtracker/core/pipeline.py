"""One email end-to-end: dedupe -> funnel -> LLM gate -> extraction -> calendar -> match -> store."""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from zoneinfo import ZoneInfo

from jobtracker.core import extraction as ex
from jobtracker.core import services
from jobtracker.core.calendar import first_interview
from jobtracker.core.email_parse import snippet
from jobtracker.core.filtering import FunnelConfig, FunnelStage, Verdict, classify
from jobtracker.core.matching import MatchConfig, company_similarity, match, normalize_company
from jobtracker.core.models import (
    EmailMessage,
    Event,
    EventKind,
    EventType,
    Extraction,
    MatchMethod,
)
from jobtracker.core.ports import (
    Clock,
    LLMClient,
    LLMError,
    LLMRefusal,
    MailSource,
    Repository,
    SyncState,
)

log = logging.getLogger(__name__)


@dataclass(slots=True)
class PipelineConfig:
    tz: ZoneInfo
    my_addresses: set[str]
    body_limit: int = 4000
    gate_body_limit: int = 1500
    min_job_confidence: float = 0.3
    match: MatchConfig = field(default_factory=MatchConfig)


@dataclass(slots=True)
class Outcome:
    verdict: str  # duplicate | own_reply | dropped | job | error
    stage: str = ""
    reason: str = ""
    event: Event | None = None


@dataclass(slots=True)
class Pipeline:
    repo: Repository
    llm: LLMClient | None
    clock: Clock
    cfg: PipelineConfig
    dry_run: bool = False
    reprocess_dropped: bool = False  # re-run mail the funnel dropped earlier (after prompt tuning)

    def process(self, email: EmailMessage) -> Outcome:
        repo = self.repo
        verdict = repo.processed_verdict(email.message_id)
        if verdict and not (self.reprocess_dropped and verdict == "dropped"):
            return Outcome("duplicate")

        thread = repo.thread_lookup(
            email.gm_thread_id, [email.in_reply_to or "", *email.references]
        )

        if email.from_address in self.cfg.my_addresses:
            if thread.known and email.gm_thread_id and not self.dry_run:
                repo.mark_thread_replied(email.gm_thread_id, email.received_at)
            return self._record(
                email, Outcome("own_reply", reason="thread" if thread.known else "")
            )

        funnel = FunnelConfig(
            set(repo.ats_domains()),
            repo.company_domains(),
            agency_domains=set(repo.agency_domains()),
        )
        decision = classify(email, funnel, known_thread=thread.known)
        if decision.verdict == Verdict.DROP:
            return self._record(email, Outcome("dropped", decision.stage, decision.reason))

        if self.llm is None:
            return self._record(email, Outcome("error", "llm", "llm_not_configured"), persist=False)

        try:
            if decision.verdict == Verdict.CANDIDATE:
                system, user = ex.gate_prompt(email, self.cfg.gate_body_limit)
                gate = self.llm.complete_json(
                    system=system, user=user, schema=ex.GATE_SCHEMA, max_tokens=1024
                )
                if not gate.get("is_job_process"):
                    return self._record(email, Outcome("dropped", FunnelStage.LLM, "llm_gate_no"))
            system, user = ex.extraction_prompt(
                email, self.cfg.tz, self.clock.now(), self.cfg.body_limit
            )
            raw = self.llm.complete_json(
                system=system, user=user, schema=ex.EXTRACTION_SCHEMA, max_tokens=2048
            )
        except LLMRefusal:
            log.warning("llm refused uid=%s; recorded and skipped", email.uid)
            return self._record(email, Outcome("dropped", FunnelStage.LLM, "llm_refusal"))
        except LLMError as err:
            # Not recorded as processed, so the next run retries it.
            log.warning("llm failed for uid=%s: %s", email.uid, type(err).__name__)
            return Outcome("error", "llm", type(err).__name__)

        extraction = ex.parse_extraction(raw, self.cfg.tz)
        self._drop_agency_company(extraction)
        if (
            not extraction.is_job_related
            and extraction.confidence >= self.cfg.min_job_confidence
            and decision.stage != FunnelStage.THREAD
        ):
            return self._record(email, Outcome("dropped", FunnelStage.LLM, "extraction_not_job"))

        self._apply_calendar(email, extraction)
        event = self._store(email, extraction, decision.stage, raw, thread.application_id)
        return self._record(email, Outcome("job", decision.stage, decision.reason, event))

    def _drop_agency_company(self, extraction: Extraction) -> None:
        """The model sometimes names the recruiting agency ("Silver.dev") as the hiring company."""
        if not extraction.company:
            return
        targets = {
            normalize_company(extraction.company),
            normalize_company(extraction.company.replace(".", " ")),
        }
        for domain, name in self.repo.agency_domains().items():
            labels = {normalize_company(name), normalize_company(domain.split(".")[0])}
            # Containment too: the model says "mindIT HR Agency" for the agency "mindit hr".
            if any(company_similarity(t, label) >= 90 for t in targets for label in labels):
                extraction.company = None
                return

    def _apply_calendar(self, email: EmailMessage, extraction: Extraction) -> None:
        cal = first_interview(email.calendar_parts, self.cfg.tz)
        if cal is None:
            return
        if (cal.method or "").upper() == "CANCEL":
            extraction.event_type = EventType.INTERVIEW_RESCHEDULED
            extraction.interview_at = None
            return
        extraction.interview_at = cal.start
        if extraction.event_type in (
            EventType.OTHER,
            EventType.INTERVIEW_INVITE,
            EventType.SCREENING_INVITE,
        ):
            extraction.event_type = EventType.INTERVIEW_SCHEDULED

    def _store(
        self,
        email: EmailMessage,
        extraction: Extraction,
        stage: FunnelStage,
        raw: dict,
        thread_app_id,
    ) -> Event:
        repo = self.repo
        result = match(email, extraction, repo, thread_app_id, self.cfg.match)
        cal = first_interview(email.calendar_parts, self.cfg.tz)
        event = Event(
            kind=EventKind.EMAIL,
            event_type=extraction.event_type,
            occurred_at=email.received_at,
            message_id=email.message_id,
            gm_thread_id=email.gm_thread_id,
            in_reply_to=email.in_reply_to,
            references=email.references[-20:],
            from_address=email.from_address,
            from_name=email.from_name,
            subject=email.subject[:300],
            snippet=snippet(email.text),
            stage_implied=extraction.stage_implied,
            round=extraction.round,
            interview_at=extraction.interview_at,
            needs_reply=extraction.needs_reply,
            summary=extraction.summary,
            confidence=extraction.confidence,
            extraction={**raw, "prompt_version": ex.PROMPT_VERSION},
            model=self.llm.model if self.llm else None,
            filter_path=stage.value,
            match_method=result.method,
            assigned_by="auto" if result.application_id or result.create_application else None,
            company_hint_id=result.company_id,
            ical_uid=cal.uid if cal else None,
            created_at=self.clock.now(),
        )
        if self.dry_run:
            return event

        if result.create_application:
            app = services.create_application_from_email(
                repo, self.clock, extraction, email, result.company_id
            )
            event.application_id = app.id
            event.company_hint_id = app.company_id
        else:
            event.application_id = result.application_id
        repo.add_event(event)
        if event.application_id:
            services.fill_unknown_role(repo, event.application_id, extraction.role)
            services.recompute(repo, self.clock, event.application_id)
        if result.create_application:
            # Earlier mail (e.g. recruiter outreach) may belong to the application just created.
            services.rematch_unassigned(repo, self.clock, self.cfg.tz)
        elif result.method == MatchMethod.NONE:
            log.info("unassigned event %s (%s)", event.id, extraction.event_type)
        return event

    def _record(self, email: EmailMessage, outcome: Outcome, persist: bool = True) -> Outcome:
        if persist and not self.dry_run:
            self.repo.record_processed(
                email.message_id, email.uid, outcome.verdict, str(outcome.stage), outcome.reason
            )
        return outcome


@dataclass(slots=True)
class RunReport:
    seen: int = 0
    counts: Counter = field(default_factory=Counter)
    unassigned: int = 0
    created: int = 0
    errors: int = 0
    last_uid: int | None = None
    started_fresh: bool = False  # first run with nothing to resume from: only recorded "now"

    def add(self, outcome: Outcome) -> None:
        self.seen += 1
        key = outcome.verdict if outcome.verdict != "dropped" else f"dropped:{outcome.stage}"
        self.counts[key] += 1
        if outcome.verdict == "error":
            self.errors += 1
        if outcome.event is not None:
            if outcome.event.match_method == MatchMethod.CREATED:
                self.created += 1
            elif outcome.event.application_id is None:
                self.unassigned += 1


def run_incremental(pipeline: Pipeline, source: MailSource, limit: int | None = None) -> RunReport:
    """Process new mail since the stored UID. The checkpoint advances only past committed mail
    and stops at the first error so nothing gets skipped."""
    repo = pipeline.repo
    report = RunReport()
    uidvalidity = source.uidvalidity()
    state = repo.get_sync_state(source.mailbox)
    if state is None or state.uidvalidity != uidvalidity:
        # First run: continue after the newest mail a backfill already processed, so mail that
        # arrived in between isn't skipped. With no backfill (or after Gmail reset UIDs, which
        # makes stored UIDs meaningless) start from "now": history is the backfill command's job.
        # Message-ID dedupe makes any overlap safe.
        resume = repo.max_processed_uid() if state is None else None
        state = SyncState(
            source.mailbox, uidvalidity, resume if resume is not None else source.last_uid()
        )
        if resume is None:
            if not pipeline.dry_run:
                with repo.transaction():
                    repo.set_sync_state(state)
            report.last_uid = state.last_uid
            report.started_fresh = True
            return report

    for email in source.fetch_new(state.last_uid):
        with repo.transaction():
            outcome = pipeline.process(email)
            report.add(outcome)
            if outcome.verdict == "error":
                break
            if email.uid and not pipeline.dry_run:
                state.last_uid = max(state.last_uid, email.uid)
                repo.set_sync_state(state)
        if limit and report.seen >= limit:
            break
    if not pipeline.dry_run:
        with repo.transaction():
            repo.set_sync_state(state)  # also records when we last looked, even with no new mail
    report.last_uid = state.last_uid
    return report


OutcomeHook = Callable[[EmailMessage, Outcome], None]


def run_backfill(
    pipeline: Pipeline,
    source: MailSource,
    since: date,
    until: date | None,
    limit: int | None = None,
    on_outcome: OutcomeHook | None = None,
) -> RunReport:
    report = RunReport()
    for email in source.fetch_range(since, until):
        with pipeline.repo.transaction():
            outcome = pipeline.process(email)
            report.add(outcome)
        if on_outcome:
            on_outcome(email, outcome)
        if limit and report.seen >= limit:
            break
    return report
