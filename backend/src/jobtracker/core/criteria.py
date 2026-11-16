"""What the candidate is looking for, as fields (plan §21, round 6). The settings page edits a
`Profile`; `render` turns it into the prose the screening prompt reads, which is stored as the
`criteria` setting next to the profile, so scoring only ever reads text."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

CRITERIA_LIMIT = 6000  # characters the system prompt keeps
LIST_LIMIT = 60  # entries in one list
ENTRY_LIMIT = 120  # characters in one entry
TEXT_LIMIT = (
    CRITERIA_LIMIT  # characters in one free-text field (the old criteria text fits in the notes)
)

LIST_FIELDS = (
    "roles", "ai_roles", "seniority_ok", "seniority_maybe", "seniority_no", "stack", "stack_no",
    "location_yes", "location_maybe", "location_no", "industries",
)  # fmt: skip
TEXT_FIELDS = ("home", "background", "location_notes", "notes")


@dataclass
class Profile:
    home: str = "Buenos Aires, Argentina"
    background: str = ""
    roles: list[str] = field(default_factory=list)
    ai_roles: list[str] = field(default_factory=list)  # welcome; never marked down for AI
    seniority_ok: list[str] = field(default_factory=list)
    seniority_maybe: list[str] = field(default_factory=list)  # at most "maybe"
    seniority_no: list[str] = field(default_factory=list)
    max_years: int | None = None  # asking for more years of experience is a "no"
    stack: list[str] = field(default_factory=list)
    stack_no: list[str] = field(default_factory=list)  # roles mainly in these are a "no"
    location_yes: list[str] = field(default_factory=list)
    location_maybe: list[str] = field(default_factory=list)
    location_no: list[str] = field(default_factory=list)
    location_notes: str = ""
    salary_min_usd: int | None = None  # yearly; for the AI only (the rules have the hard floor)
    industries: list[str] = field(default_factory=list)  # preferred, not required
    notes: str = ""

    @classmethod
    def from_dict(cls, data: object) -> Profile:
        d = data if isinstance(data, dict) else {}
        p = cls()
        for key in LIST_FIELDS:
            setattr(p, key, _entries(d.get(key)))
        for key in TEXT_FIELDS:
            value = d.get(key)
            setattr(p, key, value.strip()[:TEXT_LIMIT] if isinstance(value, str) else "")
        p.home = " ".join(p.home.split())[:ENTRY_LIMIT]
        p.max_years = _int(d.get("max_years"), 0, 50)
        p.salary_min_usd = _int(d.get("salary_min_usd"), 0, 10_000_000) or None
        return p

    def to_dict(self) -> dict:
        return asdict(self)


def _entries(value: object) -> list[str]:
    """Trimmed, de-duplicated (ignoring case), in the order given."""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for v in value:
        if not isinstance(v, str) or not (text := " ".join(v.split())[:ENTRY_LIMIT]):
            continue
        if text.lower() not in seen:
            seen.add(text.lower())
            out.append(text)
    return out[:LIST_LIMIT]


def _int(value: object, lo: int, hi: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return max(lo, min(hi, int(value)))


def _join(items: list[str], last: str = "or") -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} {last} {items[-1]}"


def _paragraph(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.strip().splitlines())


def render(p: Profile) -> str:
    """The criteria text the screening prompt reads. Empty fields leave their line out."""
    parts: list[str] = []

    candidate = [f"Candidate: lives in {p.home}." if p.home else ""]
    if p.background:
        candidate.append(_paragraph(p.background))
    parts.append("\n".join(x for x in candidate if x))

    roles = []
    if p.roles:
        roles.append(f"Roles wanted: {_join(p.roles)}.")
    if p.ai_roles:
        roles.append(
            f"AI-flavoured roles are welcome too ({_join(p.ai_roles)}): never mark a posting "
            "down because it is about AI."
        )
    parts.append(" ".join(roles))

    seniority = []
    if p.seniority_ok:
        seniority.append(f"Seniority: {_join(p.seniority_ok)}.")
    if p.max_years is not None:
        seniority.append(
            f"A posting that asks for up to {p.max_years} years of experience is fine; "
            f'{p.max_years + 1} or more years is a "no".'
        )
    if p.seniority_no:
        seniority.append(f'{_join(p.seniority_no).capitalize()} roles are a "no".')
    if p.seniority_maybe:
        seniority.append(f'{_join(p.seniority_maybe).capitalize()} roles are at most "maybe".')
    parts.append(" ".join(seniority))

    stack = []
    if p.stack:
        stack.append(f"Stack: {', '.join(p.stack)}.")
    if p.stack_no:
        stack.append(f'Roles that are mainly {_join(p.stack_no)} are a "no".')
    parts.append(" ".join(stack))

    location = []
    city = p.home.split(",")[0].strip()
    if p.location_yes:
        near = f"; remote, hybrid or onsite anywhere in the {city} area" if city else ""
        location.append(f"- yes: hires in {_join(p.location_yes)}{near}.")
    if p.location_maybe:
        location.append(f"- maybe: open to {_join(p.location_maybe)}, but not clearly to the places above.")  # fmt: skip
    if p.location_no:
        location.append(f"- no: {_join(p.location_no)}.")
    location += [f"- {line.strip().lstrip('-').strip()}" for line in p.location_notes.splitlines() if line.strip()]  # fmt: skip
    if location:
        who = f"someone living in {p.home}" if p.home else "the candidate"
        parts.append(f"Location (the most important check): can they hire {who}?\n" + "\n".join(location))  # fmt: skip

    if p.salary_min_usd:
        parts.append(f'Salary: at least USD {p.salary_min_usd:,} a year; less is a "no".')
    else:
        parts.append("Salary: no minimum.")

    if p.industries:
        parts.append(f"Industry: {_join(p.industries)} first, but anything that fits the experience counts.")  # fmt: skip

    if p.notes:
        parts.append(_paragraph(p.notes))

    return "\n\n".join(x for x in parts if x).strip() + "\n"


DEFAULT_PROFILE = Profile(
    home="Buenos Aires, Argentina",
    background="""\
About 4 years of experience.
- Senior Software Engineer at a security startup (Python API + React): phishing and fake-app \
detection, a GitHub App that scans npm packages for supply-chain attacks, a migration from \
server-rendered templates to a React frontend.
- 3 years full stack at a litigation-funding fintech (React, TypeScript, Express, Next.js): an \
internal financial platform with $25M+ in transactions and bank reconciliation, a CRM, a data \
labeling platform, Python scraping pipelines over 2M+ court cases (MySQL, MongoDB).
- Earlier: REST APIs in ASP.NET for an industrial client.
- Informatics Engineering, University of Buenos Aires. English for work, Spanish native, only a \
little Portuguese (not enough to work in it).""",
    roles=["software engineer", "full stack engineer", "backend engineer"],
    ai_roles=[
        "AI product engineer",
        "AI engineer",
        "forward deployed engineer",
        "product engineer",
        "founding engineer",
    ],
    seniority_ok=["semi senior", "senior"],
    seniority_maybe=["staff", "principal", "lead"],
    seniority_no=["junior", "intern"],
    max_years=5,
    stack=["TypeScript", "React", "Node.js", "Next.js", "Python", "SQL (MySQL, Postgres)", "AWS"],
    stack_no=["Java", ".NET", "PHP", "Ruby", "native mobile", "DevOps/SRE", "data science", "QA"],
    location_yes=["Argentina", "LATAM", "the Americas", "worldwide"],
    location_maybe=["Brazil"],
    location_no=[
        "US-only",
        "requires US work authorization or a US address",
        "onsite outside Buenos Aires",
        "limited to Europe, India or other regions",
        "onsite in Brazil",
        "needs working Portuguese",
    ],
    location_notes="""\
A role open to Brazil is usually open to Argentina too.
Any contract type (employee, contractor, through an employer of record) and any currency, \
Argentine pesos included.
A salary above about USD 100k a year with no mention of LATAM usually means a US-local role: \
lean towards "no" on location.
A location that names Buenos Aires or Argentina means the candidate can certainly apply: score \
those higher.""",
    industries=["fintech"],
    notes="""\
Most LATAM roles pay USD 40-90k a year.

Employers: a recruiter or staffing firm hiring for a client (Silver.dev, G2i) is fine: judge the \
role itself. Talent marketplaces (Turing, Toptal, Crossover) and nearshore software consultancies \
(BairesDev, Globant, Stefanini…) are not wanted. Per-task AI-training gigs (creating or labelling \
tasks, not building a product) score lower, but are not a "no" when the rest fits.""",
)
