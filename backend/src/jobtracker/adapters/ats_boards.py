"""BoardSource on the public job-board APIs of three applicant tracking systems (plan §21).

No key and no login: these are the same JSON feeds the companies' own careers pages read.
- Ashby:      GET api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
- Greenhouse: GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
- Lever:      GET api.lever.co/v0/postings/{slug}?mode=json   (the slug is case-sensitive)

A board returns every opening of the company; discovery.board_keep decides what is stored. The
slug comes from the watchlist, so it is checked before it goes into a URL.
"""

from __future__ import annotations

import html
import re
from datetime import UTC, datetime

import httpx

from jobtracker.adapters.remoteyeah import html_to_text
from jobtracker.core.models import JobPosting
from jobtracker.core.ports import SourceError

USER_AGENT = "jobtracker/0.1 (personal job search; reads each board once a day)"
MAX_BYTES = 40 * 1024 * 1024
URLS = {
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true",
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true",
    "lever": "https://api.lever.co/v0/postings/{}?mode=json",
}
_SLUG = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
# Lever gives the country as a code next to a free-text location.
_COUNTRIES = {
    "AR": "Argentina", "BR": "Brazil", "MX": "Mexico", "CO": "Colombia", "CL": "Chile",
    "UY": "Uruguay", "PE": "Peru", "US": "United States",
}  # fmt: skip
_EMPLOYMENT = {"FullTime": "Full time", "PartTime": "Part time", "Contract": "Contract",
               "Intern": "Internship", "Temporary": "Temporary"}  # fmt: skip


def _str(value: object) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _plain(value: object) -> str:
    return value if isinstance(value, str) else ""


def _http_url(value: object) -> str | None:
    return value if isinstance(value, str) and value.startswith("https://") else None


def _iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _places(parts: list[str]) -> str | None:
    """'Argentina | Remote, LATAM': each place once, in the order the board gave them."""
    seen = list(dict.fromkeys(p for p in parts if p))
    return " | ".join(seen)[:300] or None


def parse_ashby(data: object, slug: str, company: str) -> list[JobPosting]:
    jobs = data.get("jobs") if isinstance(data, dict) else None
    out = []
    for j in jobs if isinstance(jobs, list) else []:
        if not isinstance(j, dict) or j.get("isListed") is False:
            continue
        job_id, title, url = _str(j.get("id")), _str(j.get("title")), _http_url(j.get("jobUrl"))
        if not (job_id and title and url):
            continue
        address = (j.get("address") or {}).get("postalAddress") or {}
        places = [_str(j.get("location"))]
        places += [_str(s.get("location")) for s in j.get("secondaryLocations") or [] if isinstance(s, dict)]  # fmt: skip
        places.append(_str(address.get("addressCountry")))
        if j.get("isRemote") and not any("remote" in p.lower() for p in places):
            places.append("Remote")
        pay = _str((j.get("compensation") or {}).get("compensationTierSummary"))
        out.append(
            JobPosting(
                source="ashby",
                source_id=f"{slug}:{job_id}"[:200],
                url=url,
                title=title,
                company=company,
                description=_plain(j.get("descriptionPlain")),
                location=_places(places),
                employment_type=_EMPLOYMENT.get(_str(j.get("employmentType"))),
                salary_text=pay[:200] or None,
                publisher="Ashby",
                posted_at=_iso(j.get("publishedAt")),
            )
        )
    return out


def parse_greenhouse(data: object, slug: str, company: str) -> list[JobPosting]:
    jobs = data.get("jobs") if isinstance(data, dict) else None
    out = []
    for j in jobs if isinstance(jobs, list) else []:
        if not isinstance(j, dict):
            continue
        job_id, title, url = j.get("id"), _str(j.get("title")), _http_url(j.get("absolute_url"))
        if not (isinstance(job_id, int) and title and url):
            continue
        content = j.get("content") if isinstance(j.get("content"), str) else ""
        out.append(
            JobPosting(
                source="greenhouse",
                source_id=f"{slug}:{job_id}"[:200],
                url=url,
                title=title,
                company=company,
                description=html_to_text(html.unescape(content)),  # the HTML arrives escaped
                location=_places([_str((j.get("location") or {}).get("name"))]),
                publisher="Greenhouse",
                posted_at=_iso(j.get("first_published")) or _iso(j.get("updated_at")),
            )
        )
    return out


def _lever_text(j: dict) -> str:
    parts = [j.get("descriptionPlain") if isinstance(j.get("descriptionPlain"), str) else ""]
    for item in j.get("lists") or []:
        if isinstance(item, dict):
            parts.append(_str(item.get("text")))
            parts.append(html_to_text(item.get("content") if isinstance(item.get("content"), str) else ""))  # fmt: skip
    parts.append(j.get("additionalPlain") if isinstance(j.get("additionalPlain"), str) else "")
    return "\n".join(p.strip() for p in parts if p and p.strip())


def _lever_pay(j: dict) -> tuple[str | None, int | None, int | None, str | None]:
    pay = j.get("salaryRange")
    if not isinstance(pay, dict):
        return None, None, None, None
    lo, hi = pay.get("min"), pay.get("max")
    lo = int(lo) if isinstance(lo, int | float) and 0 < lo < 100_000_000 else None
    hi = int(hi) if isinstance(hi, int | float) and 0 < hi < 100_000_000 else None
    if lo is None and hi is None:
        return None, None, None, None
    currency = _str(pay.get("currency"))[:8]
    interval = _str(pay.get("interval"))[:40]
    amount = " – ".join(f"{n:,}" for n in (lo, hi) if n is not None)
    text = " ".join(x for x in (currency, amount, interval) if x)
    period = next((p for p in ("YEAR", "MONTH", "HOUR") if p in interval.upper()), None)
    usd = currency.upper() == "USD"  # salary_min/max are read as USD downstream
    return text, lo if usd else None, hi if usd else None, period if usd else None


def parse_lever(data: object, slug: str, company: str) -> list[JobPosting]:
    out = []
    for j in data if isinstance(data, list) else []:
        if not isinstance(j, dict):
            continue
        job_id, title, url = _str(j.get("id")), _str(j.get("text")), _http_url(j.get("hostedUrl"))
        if not (job_id and title and url):
            continue
        cats = j.get("categories") if isinstance(j.get("categories"), dict) else {}
        places = [_str(cats.get("location"))]
        places += [_str(x) for x in cats.get("allLocations") or []]
        code = _str(j.get("country")).upper()
        places.append(_COUNTRIES.get(code, ""))
        if j.get("workplaceType") == "remote" and not any("remote" in p.lower() for p in places):
            places.append("Remote")
        created = j.get("createdAt")
        text, lo, hi, period = _lever_pay(j)
        out.append(
            JobPosting(
                source="lever",
                source_id=f"{slug}:{job_id}"[:200],
                url=url,
                title=title,
                company=company,
                description=_lever_text(j),
                location=_places(places),
                employment_type=_str(cats.get("commitment"))[:60] or None,
                salary_text=text,
                salary_min=lo,
                salary_max=hi,
                salary_period=period,
                publisher="Lever",
                posted_at=datetime.fromtimestamp(created / 1000, UTC)
                if isinstance(created, int | float) and created > 0
                else None,
            )
        )
    return out


PARSERS = {"ashby": parse_ashby, "greenhouse": parse_greenhouse, "lever": parse_lever}


class AtsBoards:
    """Thread-safe: discovery fetches several boards at once through one client."""

    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(
            timeout=30.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
        )

    def fetch_board(self, ats: str, slug: str, company: str) -> list[JobPosting]:
        if ats not in URLS or not _SLUG.fullmatch(slug):
            raise SourceError(f"not a board: {ats}/{slug}")
        try:
            r = self._client.get(URLS[ats].format(slug), follow_redirects=False)
        except httpx.HTTPError as err:
            raise SourceError(f"{ats} request failed ({type(err).__name__})") from err
        if r.status_code == 404:
            raise SourceError(f"{ats} board {slug} not found", gone=True)
        if r.status_code != 200:
            raise SourceError(f"{ats} HTTP {r.status_code}")
        if len(r.content) > MAX_BYTES:
            raise SourceError(f"{ats} board {slug} is larger than 40 MB")
        try:
            data = r.json()
        except ValueError as err:
            raise SourceError(f"{ats} board {slug} is not JSON") from err
        return PARSERS[ats](data, slug, company or slug)
