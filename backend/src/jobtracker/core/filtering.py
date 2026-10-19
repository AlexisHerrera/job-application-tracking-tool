"""Filtering funnel: hard excludes -> allowlist -> heuristics. The LLM gate runs in the pipeline."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

from jobtracker.core.models import EmailMessage


class Verdict(StrEnum):
    PASS = "pass"  # job mail, go straight to extraction
    CANDIDATE = "candidate"  # ask the LLM gate
    DROP = "drop"


class FunnelStage(StrEnum):
    EXCLUDE = "exclude"
    THREAD = "thread"
    ALLOWLIST = "allowlist"
    HEURISTIC = "heuristic"
    LLM = "llm"


@dataclass(slots=True)
class Decision:
    verdict: Verdict
    stage: FunnelStage
    reason: str


# Senders whose mail is never a job *process*: alerts, digests, recommendations.
EXCLUDED_SENDERS = {
    "jobalerts-noreply@linkedin.com",
    "jobs-listings@linkedin.com",
    "jobs-noreply@linkedin.com",  # except Easy Apply confirmations, see LINKEDIN_APPLIED
    "linkedin@e.linkedin.com",
    "news@linkedin.com",
    "alert@indeed.com",
    "jobalerts@indeed.com",
    "donotreply@match.indeed.com",
    "noreply@glassdoor.com",
    "noreply@getonbrd.com",
    "alerts@weworkremotely.com",
}
EXCLUDED_DOMAINS = {"e.linkedin.com", "glassdoor.com", "match.indeed.com"}

EXCLUDED_SUBJECTS = re.compile(
    r"jobs? you may (be interested in|like)|recommended jobs?|new jobs? (for you|match)|"
    r"job alert|is hiring|are hiring|jobs? similar to|top job picks|^new jobs?:|"
    r"empleos? que (te )?pueden interesar|alerta de empleo|nuevos empleos|empleos recomendados|"
    r"está contratando|vacantes (para ti|recomendadas)",
    re.IGNORECASE,
)

# LinkedIn Easy Apply confirmations: the only mail from jobs-noreply@ we keep.
LINKEDIN_APPLIED = re.compile(
    r"your application was sent to|your application to .+ (was viewed|has been viewed)|"
    r"tu solicitud (se ha enviado|fue enviada|se envió) a|tu solicitud .+ (fue vista|se ha visto)",
    re.IGNORECASE,
)

GENERIC_LOCALPARTS = re.compile(
    r"^(no-?reply|do-?not-?reply|notifications?|jobs|careers|talent|recruiting|recruitment|"
    r"hiring|hello|hi|support|team|mail|info|candidates?|applications?|messages?|"
    r"inmail-hit-reply|invitations?)([+.-].*)?$"
)


# Shared senders/hosts that must never become a company's domain alias.
JOB_BOARD_DOMAINS = {
    "linkedin.com",
    "indeed.com",
    "glassdoor.com",
    "getonbrd.com",
    "wellfound.com",
    "weworkremotely.com",
    "remoteok.com",
    "workatastartup.com",
    "ycombinator.com",
    "computrabajo.com",
    "bumeran.com.ar",
    "zonajobs.com.ar",
    "google.com",
}

FREEMAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "proton.me",
    "protonmail.com",
}

STRONG = re.compile(
    r"\b(interview|entrevista|your application|thank you for applying|thanks for applying|"
    r"application (received|status|update)|next steps|pr[oó]ximos pasos|unfortunately|"
    r"lamentablemente|move forward|moving forward|avanzar con|other candidates|otros candidatos|"
    r"offer letter|job offer|oferta (laboral|de trabajo)|take[- ]home|coding (challenge|exercise)|"
    r"technical (assessment|challenge|interview)|desaf[ií]o t[eé]cnico|prueba t[eé]cnica|"
    r"hiring manager|recruit(er|ing team)|reclutador(a)?|talent acquisition|"
    r"postulaci[oó]n|candidatura|tu aplicaci[oó]n|"
    r"schedule (a|your) (call|chat|interview)|agendar|availability for)\b",
    re.IGNORECASE,
)
WEAK = re.compile(
    r"\b(position|role|posici[oó]n|puesto|vacante|opportunity|oportunidad|candidate|candidato|"
    r"hiring|contrataci[oó]n|resume|cv|curr[ií]culum|salary|salario)\b",
    re.IGNORECASE,
)
SCHEDULING_LINK = re.compile(
    r"calendly\.com|goodtime\.io|cal\.com/|app\.ashbyhq\.com/.*schedul|"
    r"greenhouse\.io/.*(schedul|interview)|zoom\.us/j/|meet\.google\.com/|teams\.microsoft\.com/l/meetup",
    re.IGNORECASE,
)


def domain_matches(domain: str, known: set[str]) -> str | None:
    """Return the known domain that `domain` equals or is a subdomain of."""
    domain = domain.lower()
    parts = domain.split(".")
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in known:
            return candidate
    return None


@dataclass(slots=True)
class FunnelConfig:
    ats_domains: set[str]
    company_domains: set[str]
    agency_domains: set[str] = field(default_factory=set)
    my_addresses: set[str] = field(default_factory=set)


def classify(email: EmailMessage, cfg: FunnelConfig, *, known_thread: bool) -> Decision:
    sender = email.from_address
    domain = email.from_domain
    subject = email.subject or ""
    head = f"{subject}\n{email.text[:4000]}"

    if domain.endswith("linkedin.com") and LINKEDIN_APPLIED.search(subject):
        return Decision(Verdict.PASS, FunnelStage.ALLOWLIST, "linkedin_easy_apply")
    if sender in EXCLUDED_SENDERS or domain_matches(domain, EXCLUDED_DOMAINS):
        return Decision(Verdict.DROP, FunnelStage.EXCLUDE, "excluded_sender")
    if EXCLUDED_SUBJECTS.search(subject):
        return Decision(Verdict.DROP, FunnelStage.EXCLUDE, "alert_subject")

    if known_thread:
        return Decision(Verdict.PASS, FunnelStage.THREAD, "known_thread")
    if (hit := domain_matches(domain, cfg.agency_domains)) and not GENERIC_LOCALPARTS.match(
        sender.partition("@")[0]
    ):
        # A person at a recruiting agency writes about processes; their notifications@ don't.
        return Decision(Verdict.PASS, FunnelStage.ALLOWLIST, f"agency:{hit}")
    if hit := domain_matches(domain, cfg.ats_domains):
        return Decision(Verdict.PASS, FunnelStage.ALLOWLIST, f"ats:{hit}")
    if hit := domain_matches(domain, cfg.company_domains):
        return Decision(Verdict.PASS, FunnelStage.ALLOWLIST, f"company:{hit}")

    # Distinct keywords: a receipt repeating one word four times is not a signal.
    strong = len({m.group(0).lower() for m in STRONG.finditer(head)})
    weak = len({m.group(0).lower() for m in WEAK.finditer(head)})
    has_ics = bool(email.calendar_parts)
    has_link = bool(SCHEDULING_LINK.search(email.text))
    if has_ics or strong >= 1 or (has_link and weak >= 1) or weak >= 4:
        # Bulk mail needs a stronger signal; newsletters love the word "interview".
        if email.list_unsubscribe and not has_ics and strong < 2:
            return Decision(Verdict.DROP, FunnelStage.HEURISTIC, "bulk_weak_signal")
        return Decision(
            Verdict.CANDIDATE,
            FunnelStage.HEURISTIC,
            f"strong={strong} weak={weak} ics={has_ics} link={has_link}",
        )
    return Decision(Verdict.DROP, FunnelStage.HEURISTIC, "no_signal")
