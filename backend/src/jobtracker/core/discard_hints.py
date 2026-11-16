"""What each discard reason points to, for the Insights page: the rule or criteria change that
would have caught the postings discarded with it, using the knobs that exist (discovery.Rules and
the criteria Profile). Pure functions.

A hint needs a pattern: at least MIN_PATTERN discards sharing what it names (a word, a place, a
technology), except company names on "intermediary", where one is enough. What was saved or
applied to is the counter-check: a change that would also hide those says so, or isn't offered.
`closed`, `fake`, `no_apply` and `duplicate` are about the posting itself, so their hints speak of
the source, not the criteria."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass

from jobtracker.core.criteria import Profile
from jobtracker.core.discovery import Rules, in_company_list, normalize_title, title_hit
from jobtracker.core.models import JobPosting

MIN_PATTERN = 2
SOURCE_REASONS = ("closed", "fake", "no_apply", "duplicate")
SOURCE_NAMES = {
    "remoteyeah": "remoteyeah", "getonbrd": "getonbrd", "workable": "Workable",
    "ashby": "Ashby boards", "greenhouse": "Greenhouse boards", "lever": "Lever boards",
    "jsearch": "JSearch",
}  # fmt: skip
SENIOR_WORDS = {"staff", "principal", "lead", "architect", "distinguished", "expert", "head"}
JUNIOR_WORDS = {
    "junior", "jr", "associate", "entry", "graduate", "trainee", "intern", "internship", "mid",
    "ssr", "pasante", "becario", "aprendiz",
}  # fmt: skip
# Title words that say nothing about why a role isn't wanted.
STOP = {
    "engineer", "engineers", "engineering", "developer", "developers", "development", "software",
    "dev", "full", "stack", "fullstack", "back", "end", "backend", "front", "frontend", "web",
    "senior", "sr", "semi", "and", "or", "of", "the", "for", "to", "in", "at", "with", "a", "an",
    "de", "en", "y", "e", "para", "latam", "latin", "america", "americas", "argentina", "brazil",
    "brasil", "mexico", "colombia", "chile", "uruguay", "peru", "usa", "us", "uk", "eu", "europe",
    "emea", "apac", "global", "worldwide", "anywhere", "only", "based", "contract", "contractor",
    "freelance", "part", "time", "onsite", "i", "ii", "iii", "iv", "desarrollador",
    "desarrolladora", "ingeniero", "ingeniera", "programador", "team", "position", "role", "job",
    "new", "hiring", "level", "mid", "ssr",
}  # fmt: skip
MODE_WORDS = {"hybrid": ("hybrid", "híbrido", "hibrido"), "onsite": ("onsite", "on-site", "on site", "office", "presencial")}  # fmt: skip
MODE_LABEL = {"hybrid": "hybrid", "onsite": "on-site"}
CONTRACT = re.compile(
    r"contract|freelanc|part.?time|temporar|intern|por proyecto|medio tiempo|tiempo parcial|hourly",
    re.IGNORECASE,
)
# A trailing legal form, so "G2i Inc." is found as "G2i" in the notes.
LEGAL = re.compile(r",?\s+(inc|llc|ltd|corp|gmbh|s\.?a|s\.?r\.?l)\.?$", re.IGNORECASE)
SOURCE_PHRASE = {
    "closed": "were closed",
    "fake": "looked fake",
    "no_apply": "had no way to apply",
    "duplicate": "were reposts the dedupe missed",
}
# Where a criteria reason with no sharper hint sends the user.
FALLBACK_SECTION = {
    "too_senior": "Seniority", "too_junior": "Seniority", "stack": "Stack", "role": "Roles",
    "language": "Candidate", "location": "Location", "work_mode": "Location",
    "salary": "Salary and industry", "contract": "Location", "company": "Other notes",
    "intermediary": "Other notes", "other": "Other notes",
}  # fmt: skip


@dataclass(frozen=True)
class Hint:
    text: str
    where: str  # "criteria" | "rules" | "sources": the page (and tab) with the knob
    section: str  # the card or list there

    def to_dict(self) -> dict:
        return {"text": self.text, "where": self.where, "section": self.section}


@dataclass
class Context:
    kept: list[JobPosting]  # saved or applied to, any time: what a change mustn't hide
    reviewed: list[JobPosting]  # everything reviewed in the window (for the source rates)
    profile: Profile
    rules: Rules


# ---------------------------------------------------------------------------------------------
# Phrasing


def _some(n: int, total: int) -> str:
    """'All 3', 'Both', '9 of the 12'."""
    if n == total:
        return "Both" if n == 2 else f"All {n}" if n > 2 else "The one"
    return f"{n} of the {total}"


def _ranked(counts: Counter) -> list[tuple]:
    """Most first, then alphabetically: the same order every time."""
    return sorted(counts.items(), key=lambda kv: (-kv[1], str(kv[0]).lower()))


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}"


def _k(usd: int) -> str:
    return f"USD {round(usd / 1000)}k"


def _them(items: list) -> str:
    return "it" if len(items) == 1 else "them"


def _word_counts(words: list[tuple[str, int]]) -> str:
    """'“staff” in 4 titles, “lead” in 2'."""
    return ", ".join(f"“{w}” in {n}{' titles' if i == 0 else ''}" for i, (w, n) in enumerate(words))


def _kept_caveat(n: int) -> str:
    return f", though it would also catch {n} you saved or applied to" if n else ""


# ---------------------------------------------------------------------------------------------
# Matching


def mentions(entries: list[str], word: str) -> bool:
    """A criteria list names the word (whole words, either way round: "DevOps/SRE" names
    "DevOps", "Node.js" names "Node.js")."""
    return any(title_hit(e, [word]) or title_hit(word, [e]) for e in entries)


def _words(title: str) -> set[str]:
    return {w for w in normalize_title(title).split() if len(w) > 1 and not w.isdigit()}


def _title_words(
    group: list[JobPosting],
    ctx: Context,
    existing: list[str],
    vocabulary: set[str] | None = None,
    wanted: list[str] | None = None,
) -> list[tuple[str, int]]:
    """Words shared by at least a quarter of the titles (and MIN_PATTERN), not yet a rule word,
    in no title saved or applied to, and not part of what the criteria ask for."""
    known = {w.lower() for w in existing}
    asked = set().union(*(_words(x) for x in wanted)) if wanted else set()
    liked = set().union(*(_words(p.title) for p in ctx.kept)) if ctx.kept else set()
    counts = Counter(w for p in group for w in _words(p.title))
    out = []
    for word, n in _ranked(counts):
        if n < MIN_PATTERN or n * 4 < len(group):
            break
        if vocabulary is not None and word not in vocabulary:
            continue
        if vocabulary is None and word in STOP:
            continue
        if word in known or word in liked or word in asked or title_hit(word, existing):
            continue
        out.append((word, n))
    return out[:3]


def _title_rule_hint(words: list[tuple[str, int]], list_name: str, section: str) -> list[Hint]:
    if not words:
        return []
    text = f"{_word_counts(words)}: add {_them(words)} to the {list_name} (Rules), which hide a title before the AI reads it."  # fmt: skip
    return [Hint(text, "rules", section)]


def _sole_allow_entry(location: str | None, allow: list[str]) -> str | None:
    """The one location rule entry that let this location through, when only one did."""
    low = (location or "").lower()
    hits = [a for a in allow if low and a.lower() in low]
    return hits[0] if len(hits) == 1 else None


def _companies(
    group: list[JobPosting], ctx: Context, existing: list[str], minimum: int
) -> list[tuple[str, int, list[JobPosting]]]:
    """Companies discarded at least `minimum` times, not on `existing` and never saved or applied
    to: (name, count, postings), most first."""
    liked = {p.company_normalized for p in ctx.kept}
    by: dict[str, list[JobPosting]] = {}
    for p in group:
        by.setdefault(p.company_normalized, []).append(p)
    out = [
        (ps[0].company, len(ps), ps)
        for key, ps in by.items()
        if key and len(ps) >= minimum and key not in liked and not in_company_list(key, existing)
    ]
    return sorted(out, key=lambda x: (-x[1], x[0].lower()))[:3]


def _company_counts(items: list[tuple[str, int, list[JobPosting]]]) -> str:
    return _join([f"{name} ({n})" if n > 1 else name for name, n, _ in items])


# ---------------------------------------------------------------------------------------------
# One function per reason


def _too_senior(group: list[JobPosting], ctx: Context) -> list[Hint]:
    p, rules, hints = ctx.profile, ctx.rules, []
    limit = p.max_years
    asked = [x.years_required for x in group if x.years_required]
    within = sorted(y for y in asked if limit is None or y <= limit)
    # A limit that catches at least two thirds of them, so one outlier doesn't set it.
    to = within[len(within) // 3] - 1 if len(within) >= MIN_PATTERN else 0
    if to >= 1:
        caught = sum(1 for y in within if y > to)
        lost = sum(
            1 for x in ctx.kept
            if x.years_required and x.years_required > to and (limit is None or x.years_required <= limit)
        )  # fmt: skip
        knob = "“Most years of experience asked”"
        change = f"lower {knob} from {limit} to {to}" if limit is not None else f"set {knob} to {to} (no limit now)"  # fmt: skip
        tail = f" (it would also make a no of {lost} you saved or applied to)" if lost else ""
        hints.append(Hint(f"{_some(caught, len(group))} ask for {to + 1}+ years: {change}{tail}.", "criteria", "Seniority"))  # fmt: skip
    if limit is not None:
        over = [x for x in group if (x.years_required or 0) > limit and x.ai_verdict in ("match", "maybe")]  # fmt: skip
        if len(over) >= MIN_PATTERN:
            hints.append(Hint(f"{_some(len(over), len(group))} ask for more than {limit} years, which the criteria already make a no, yet the AI said match or maybe: score them again.", "criteria", "Apply to recent postings"))  # fmt: skip
    words = _title_words(group, ctx, rules.seniority_exclude + rules.role_exclude, SENIOR_WORDS)
    hints += _title_rule_hint(words, "seniority words", "Seniority words")
    staff = sum(1 for x in group if x.seniority == "staff_plus")
    if staff >= MIN_PATTERN and not mentions(p.seniority_no, "staff"):
        move = "move staff, principal and lead from “At most a maybe” to “A no”" if mentions(p.seniority_maybe, "staff") else "add staff, principal and lead to “A no”"  # fmt: skip
        hints.append(Hint(f"{_some(staff, len(group))} are staff level or above, as the AI read them: {move}.", "criteria", "Seniority"))  # fmt: skip
    return hints


def _too_junior(group: list[JobPosting], ctx: Context) -> list[Hint]:
    words = _title_words(group, ctx, ctx.rules.seniority_exclude, JUNIOR_WORDS)
    hints = _title_rule_hint(words, "seniority words", "Seniority words")
    levels = Counter(x.seniority for x in group if x.seniority in ("junior", "mid"))
    missing = [lvl for lvl in ("junior", "mid") if levels[lvl] and not mentions(ctx.profile.seniority_no, lvl)]  # fmt: skip
    if (n := sum(levels[lvl] for lvl in missing)) >= MIN_PATTERN:
        names = " or ".join("mid-level" if lvl == "mid" else lvl for lvl in missing)
        entries = " and ".join(f"“{lvl}”" for lvl in missing)
        hints.append(Hint(f"{_some(n, len(group))} are {names}, as the AI read them: add {entries} to “A no”.", "criteria", "Seniority"))  # fmt: skip
    return hints


def _stack(group: list[JobPosting], ctx: Context) -> list[Hint]:
    """Technologies that set these postings apart: in a third of them, not in the stack, and at
    most half as common among the postings saved or applied to."""
    counts = Counter(t for x in group for t in set(x.technologies))
    liked = Counter(t for x in ctx.kept for t in set(x.technologies))
    techs = []
    for tech, n in _ranked(counts):
        if n < MIN_PATTERN or n * 3 < len(group):
            break
        if mentions(ctx.profile.stack, tech):
            continue
        if ctx.kept and liked[tech] / len(ctx.kept) >= n / len(group) / 2:
            continue
        techs.append((tech, n))
    techs = techs[:3]
    hints = []
    new = [(t, n) for t, n in techs if not mentions(ctx.profile.stack_no, t)]
    if new:
        listed = ", ".join(f"{t} in {n}{f' of the {len(group)}' if i == 0 else ''}" for i, (t, n) in enumerate(new))  # fmt: skip
        hints.append(Hint(f"{listed}: add {_them(new)} to “Roles mainly in these are a no”.", "criteria", "Stack"))  # fmt: skip
    liked_titles = [x.title for x in ctx.kept]
    for tech, _ in techs:
        if not mentions(ctx.profile.stack_no, tech) or title_hit(tech, ctx.rules.title_exclude):
            continue
        titled = sum(1 for x in group if title_hit(x.title, [tech]))
        if titled >= MIN_PATTERN and not any(title_hit(t, [tech]) for t in liked_titles):
            hints.append(Hint(f"“{tech}” is in {titled} titles and already a no in the criteria: add it to the stack words (Rules) to hide those before the AI reads them.", "rules", "Stack words"))  # fmt: skip
    return hints


def _role(group: list[JobPosting], ctx: Context) -> list[Hint]:
    r, p = ctx.rules, ctx.profile
    existing = r.role_exclude + r.title_exclude + r.seniority_exclude
    words = _title_words(group, ctx, existing, wanted=p.roles + p.ai_roles + p.stack)
    return _title_rule_hint(words, "role words", "Role words")


def _location_entries(group: list[JobPosting], ctx: Context) -> list[Hint]:
    allow = ctx.rules.location_allow
    counts = Counter(e for x in group if (e := _sole_allow_entry(x.location, allow)))
    liked = Counter(e for x in ctx.kept if (e := _sole_allow_entry(x.location, allow)))
    hints = []
    for entry, n in _ranked(counts)[:2]:
        if n >= MIN_PATTERN:
            hints.append(Hint(f"“{entry}” alone let {_some(n, len(group)).lower()} through: take it off the locations (Rules){_kept_caveat(liked[entry])}.", "rules", "Locations"))  # fmt: skip
    return hints


def _location(group: list[JobPosting], ctx: Context) -> list[Hint]:
    hints = _location_entries(group, ctx)
    fits = sum(1 for x in group if x.location_fit == "yes")
    if fits >= MIN_PATTERN:
        hints.append(Hint(f"The AI thought {_some(fits, len(group)).lower()} could hire you: add where they were really limited to under “No”.", "criteria", "Location"))  # fmt: skip
    return hints


def _language(group: list[JobPosting], ctx: Context) -> list[Hint]:
    hints = _location_entries(group, ctx)
    hints.append(Hint("The rules only hide postings written in Portuguese: say which languages you can't work in under Candidate, which the AI reads.", "criteria", "Candidate"))  # fmt: skip
    return hints


def _work_mode(group: list[JobPosting], ctx: Context) -> list[Hint]:
    modes = Counter(x.work_mode for x in group if x.work_mode in MODE_WORDS)
    no = ctx.profile.location_no
    missing = [m for m in MODE_WORDS if modes[m] and not any(mentions(no, w) for w in MODE_WORDS[m])]  # fmt: skip
    if (n := sum(modes[m] for m in missing)) < MIN_PATTERN:
        return []
    city = ctx.profile.home.split(",")[0].strip() or "your city"
    kinds = " or ".join(MODE_LABEL[m] for m in missing)
    return [Hint(f"{_some(n, len(group))} were {kinds}, as the AI read them: add “{kinds} outside {city}” under “No”.", "criteria", "Location")]  # fmt: skip


def _salary(group: list[JobPosting], ctx: Context) -> list[Hint]:
    pay = [x.salary_usd_max for x in group if x.salary_usd_max]
    lowest_liked = min((x.salary_usd_max for x in ctx.kept if x.salary_usd_max), default=None)
    below = [s for s in pay if lowest_liked is None or s < lowest_liked]
    if len(below) < MIN_PATTERN:
        return []
    to = (max(below) // 5000 + 1) * 5000
    if lowest_liked is not None:
        to = min(to, lowest_liked)  # what pays less than this is hidden; the lowest liked stays
    said = f"{_some(sum(1 for s in pay if s < to), len(group))} pay at most {_k(max(below))} a year"
    bound = f"; the lowest you saved or applied to pays {_k(lowest_liked)}" if to == lowest_liked else ""  # fmt: skip
    current = ctx.profile.salary_min_usd
    if current is None or current < to:
        now = f"from {_k(current)}" if current else "(none now)"
        return [Hint(f"{said}: raise “Minimum salary” {now} to {_k(to)}{bound}.", "criteria", "Salary and industry")]  # fmt: skip
    floor = ctx.rules.salary_floor_usd
    if floor is None or floor < to:
        now = _k(floor) if floor else "none"
        return [Hint(f"{said}, and the criteria already ask for {_k(current)}: a salary floor of {_k(to)} (now {now}) hides those before the AI reads them, when the source states the pay.", "rules", "Age and salary")]  # fmt: skip
    return []


def _contract(group: list[JobPosting], ctx: Context) -> list[Hint]:
    hits = [x for x in group if CONTRACT.search(x.employment_type or "")]
    if len(hits) < MIN_PATTERN:
        return []
    kinds = _ranked(Counter(x.employment_type for x in hits))
    listed = " or ".join(f"“{k}”" for k, _ in kinds[:2])
    any_kind = re.search(r"any contract", ctx.profile.location_notes, re.IGNORECASE)
    tail = "the location notes say any contract type is fine: narrow that down" if any_kind else "say which contracts you don't take in the location notes"  # fmt: skip
    return [Hint(f"{_some(len(hits), len(group))} were listed as {listed}: {tail}.", "criteria", "Location")]  # fmt: skip


def _company(group: list[JobPosting], ctx: Context) -> list[Hint]:
    items = _companies(group, ctx, ctx.rules.blocked, MIN_PATTERN)
    if not items:
        return []
    return [Hint(f"{_company_counts(items)}: add {_them(items)} to the blocked companies (Rules), or use “Hide company” on a posting.", "rules", "Blocked companies")]  # fmt: skip


def _intermediary(group: list[JobPosting], ctx: Context) -> list[Hint]:
    r, notes = ctx.rules, ctx.profile.notes
    items = _companies(group, ctx, r.agencies + r.consultancies + r.blocked, 1)
    # The notes can name intermediaries that are fine ("Silver.dev, G2i"): those disagree with
    # the discards, so the notes come first.
    named = [c for c in items if title_hit(notes, [c[0]]) or title_hit(notes, [LEGAL.sub("", c[0])])]  # fmt: skip
    consultancy = [c for c in items if c not in named and any(x.employer_kind == "consultancy" for x in c[2])]  # fmt: skip
    agency = [c for c in items if c not in named and c not in consultancy]
    hints = [
        Hint(f"Add {_company_counts(found)} to the {name} (Rules).", "rules", section)
        for found, name, section in (
            (agency, "agencies and talent marketplaces", "Agencies & talent marketplaces"),
            (consultancy, "consultancies", "Consultancies"),
        )
        if found
    ]
    if named:
        hints.append(Hint(f"The other notes call {_company_counts(named)} fine, yet you discarded {_them(named)} as an intermediary: take {_them(named)} out of the notes, then add {_them(named)} to the agencies if they keep coming.", "criteria", "Other notes"))  # fmt: skip
    return hints


def _source_rates(reason: str) -> Callable[[list[JobPosting], Context], list[Hint]]:
    """Which sources these came from, against how many each brought to review."""

    def hints(group: list[JobPosting], ctx: Context) -> list[Hint]:
        reviewed = Counter(x.source for x in ctx.reviewed)
        found = [(s, n) for s, n in _ranked(Counter(x.source for x in group)) if n >= MIN_PATTERN]
        rows = [
            f"{SOURCE_NAMES.get(s, s)}: {n} of the {reviewed[s]} reviewed from it {SOURCE_PHRASE[reason]}"
            if i == 0
            else f"{SOURCE_NAMES.get(s, s)}: {n} of {reviewed[s]}"
            for i, (s, n) in enumerate(found[:2])
        ]
        out = [Hint(f"{'; '.join(rows)}.", "sources", "Sources")] if rows else []
        if reason == "fake" and (items := _companies(group, ctx, ctx.rules.blocked, MIN_PATTERN)):
            out.append(Hint(f"{_company_counts(items)}: block {_them(items)} (Rules) to stop seeing their postings.", "rules", "Blocked companies"))  # fmt: skip
        return out

    return hints


HINTS: dict[str, Callable[[list[JobPosting], Context], list[Hint]]] = {
    "too_senior": _too_senior, "too_junior": _too_junior, "stack": _stack, "role": _role,
    "location": _location, "language": _language, "work_mode": _work_mode, "salary": _salary,
    "contract": _contract, "company": _company, "intermediary": _intermediary,
    **{reason: _source_rates(reason) for reason in SOURCE_REASONS},
}  # fmt: skip


def hints_for(reason: str, group: list[JobPosting], ctx: Context) -> list[dict]:
    """The hints for one reason's discards. A reason the criteria could catch, with no sharper
    hint, says so when the AI liked enough of them."""
    if len(group) < MIN_PATTERN and reason != "intermediary":
        return []
    out = HINTS.get(reason, lambda _g, _c: [])(group, ctx)
    liked = sum(1 for x in group if x.ai_verdict in ("match", "maybe"))
    if not out and reason in FALLBACK_SECTION and liked >= MIN_PATTERN:
        section = FALLBACK_SECTION[reason]
        out = [Hint(f"The AI scored {_some(liked, len(group)).lower()} a match or maybe, so the criteria don't rule these out yet: say why under {section}.", "criteria", section)]  # fmt: skip
    return [h.to_dict() for h in out]
