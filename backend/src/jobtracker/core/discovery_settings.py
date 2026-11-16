"""What the Discover settings page reads and changes beyond plain settings (plan §21, round 6):
the criteria profile, how much each rule hides, re-applying the rules to what's stored, and the
company watchlist as a table."""

from __future__ import annotations

from collections import Counter
from dataclasses import replace
from datetime import datetime

from jobtracker.core import criteria
from jobtracker.core.discovery import DEFAULT_CRITERIA, Rules, in_company_list, rule_drop
from jobtracker.core.models import WatchedCompany
from jobtracker.core.ports import DiscoveryRepo

TITLE_LISTS = ("seniority_exclude", "role_exclude", "title_exclude")  # drop reason "title: <word>"
COMPANY_LISTS = {"blocked": "blocked", "agencies": "agency", "consultancies": "consultancy"}
LOCATION_REASONS = ("location", "location: brazil onsite")

# ---------------------------------------------------------------------------------------------
# Criteria


def load_profile(repo: DiscoveryRepo) -> tuple[criteria.Profile, bool]:
    """The saved profile, or (not saved yet) the default fields with the saved criteria text as
    the notes, so nothing the user wrote is lost. The bool says whether a profile was saved."""
    raw = repo.get_discovery_setting("profile")
    if isinstance(raw, dict):
        return criteria.Profile.from_dict(raw), True
    profile = replace(criteria.DEFAULT_PROFILE)
    text = repo.get_discovery_setting("criteria")
    if isinstance(text, str) and text.strip() and text.strip() != DEFAULT_CRITERIA.strip():
        profile.notes = text.strip()[: criteria.TEXT_LIMIT]
    return profile, False


def preview(data: object) -> str:
    return criteria.render(criteria.Profile.from_dict(data))


def save_profile(repo: DiscoveryRepo, data: object) -> str:
    """Store the profile and the criteria text it renders to. Too long → ValueError."""
    profile = criteria.Profile.from_dict(data)
    text = criteria.render(profile)
    if len(text) > criteria.CRITERIA_LIMIT:
        raise ValueError(
            f"the criteria come to {len(text):,} characters; the AI reads at most "
            f"{criteria.CRITERIA_LIMIT:,}: shorten the notes or the background"
        )
    with repo.transaction():
        repo.set_discovery_setting("profile", profile.to_dict())
        repo.set_discovery_setting("criteria", text)
    return text


# ---------------------------------------------------------------------------------------------
# Rule hit counts


def rule_hits(counts: list[tuple[str, str, int]], rules: Rules) -> dict:
    """How many stored postings each hide reason, each rule list and each entry accounts for.
    `counts` is repo.drop_reason_counts(). A posting counts for the reason it was hidden with:
    the first rule that matched when it was stored or last checked."""
    reasons: Counter[str] = Counter()
    by_company: dict[str, Counter[str]] = {r: Counter() for r in COMPANY_LISTS.values()}
    for reason, company, n in counts:
        reasons[reason] += n
        if reason in by_company:
            by_company[reason][company] += n

    lists: dict[str, dict] = {}
    for key in TITLE_LISTS:
        entries = {w: reasons.get(f"title: {w}", 0) for w in getattr(rules, key)}
        lists[key] = {"total": sum(entries.values()), "entries": entries}
    for key, reason in COMPANY_LISTS.items():
        companies = by_company[reason]
        entries = {
            name: sum(n for c, n in companies.items() if in_company_list(c, [name]))
            for name in getattr(rules, key)
        }
        # The total is every posting with this reason: the LLM also hides consultancies.
        lists[key] = {"total": reasons.get(reason, 0), "entries": entries}
    lists["location_allow"] = {"total": sum(reasons.get(r, 0) for r in LOCATION_REASONS), "entries": {}}  # fmt: skip
    return {"reasons": dict(reasons.most_common()), "lists": lists}


# ---------------------------------------------------------------------------------------------
# Re-applying the rules


def _removed(old: list[str], new: list[str]) -> list[str]:
    keep = {x.lower() for x in new}
    return [x for x in old if x.lower() not in keep]


def loosened(old: Rules, new: Rules) -> tuple[set[str], dict[str, list[str]]]:
    """The hide reasons the new rules may no longer hold, and for the company lists, which
    names came off (only postings of those companies come back: the LLM hides consultancies
    too, with the same reason)."""
    reasons = {f"title: {w}" for key in TITLE_LISTS for w in _removed(getattr(old, key), getattr(new, key))}  # fmt: skip
    companies: dict[str, list[str]] = {}
    for key, reason in COMPANY_LISTS.items():
        if names := _removed(getattr(old, key), getattr(new, key)):
            reasons.add(reason)
            companies[reason] = names
    if _removed(new.location_allow, old.location_allow):  # a place was added
        reasons.update(LOCATION_REASONS)
    if new.max_age_days > old.max_age_days:
        reasons.add("old")
    if old.salary_floor_usd and (not new.salary_floor_usd or new.salary_floor_usd < old.salary_floor_usd):  # fmt: skip
        reasons.add("salary")
    return reasons, companies


def reapply_rules(repo: DiscoveryRepo, old: Rules, new: Rules, now: datetime) -> dict[str, int]:
    """After the rules change: hide the visible new postings a rule now catches (the age rule
    off, as before scoring), and check again the hidden ones whose reason a looser rule may no
    longer hold, which come back when nothing else hides them. Returns {hidden, restored}."""
    reasons, companies = loosened(old, new)
    out = {"hidden": 0, "restored": 0}
    with repo.transaction():
        for p in repo.postings_to_recheck(tuple(sorted(reasons))):
            if p.drop_reason is None:
                reason = rule_drop(p, new, now, age=False)
                out["hidden"] += reason is not None
            else:
                names = companies.get(p.drop_reason)
                if names is not None and not in_company_list(p.company_normalized, names):
                    continue
                reason = rule_drop(p, new, now)
                out["restored"] += reason is None
            if reason != p.drop_reason:
                p.drop_reason, p.updated_at = reason, now
                repo.update_posting(p)
    return out


# ---------------------------------------------------------------------------------------------
# Company watchlist

WATCH_STATUSES = ("on", "off", "gone", "error", "with_roles", "unread")
WATCH_SORTS = ("name", "roles", "checked")


def board_url(ats: str, slug: str) -> str | None:
    return {
        "ashby": f"https://jobs.ashbyhq.com/{slug}",
        "greenhouse": f"https://job-boards.greenhouse.io/{slug}",
        "lever": f"https://jobs.lever.co/{slug}",
    }.get(ats)


def has_status(c: WatchedCompany, status: str) -> bool:
    return {
        "on": c.enabled,
        "off": not c.enabled,
        "gone": c.last_status == "gone",
        "error": c.last_status not in (None, "ok", "gone"),
        "with_roles": c.enabled and bool(c.jobs_kept),
        "unread": c.last_checked_at is None,
    }.get(status, True)


def query_watched(
    rows: list[WatchedCompany],
    *,
    q: str | None = None,
    ats: str | None = None,
    status: str | None = None,
    sort: str = "name",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[WatchedCompany], int, dict[str, int]]:
    """One page of the watchlist, how many match, and how many have each status within the
    text and ATS filters (the status filter's own counts)."""
    text = (q or "").strip().lower()

    def wanted(c: WatchedCompany) -> bool:
        return (not ats or c.ats == ats) and (not text or text in f"{c.name} {c.slug}".lower())

    base = [c for c in rows if wanted(c)]
    counts = {s: sum(1 for c in base if has_status(c, s)) for s in WATCH_STATUSES}
    found = [c for c in base if not status or has_status(c, status)]
    if sort == "roles":
        found.sort(key=lambda c: (-(c.jobs_kept or 0), c.name.lower()))
    elif sort == "checked":
        found.sort(key=lambda c: (c.last_checked_at is None, -(c.last_checked_at.timestamp() if c.last_checked_at else 0), c.name.lower()))  # fmt: skip
    else:
        found.sort(key=lambda c: (c.name.lower(), c.ats, c.slug))
    return found[offset : offset + limit], len(found), counts
