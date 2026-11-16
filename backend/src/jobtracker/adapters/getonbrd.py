"""JobSource on Get on Board's public API (getonbrd.com, a Latin American tech job board;
plan §21). No key: GET /api/v0/categories/{category}/jobs, 100 jobs a page.

The API says how remote a job is but not always from where: `fully_remote` with no country is
written as "Remote (anywhere)", `remote_local` (remote inside the employer's country) as
"Remote (in-country)", and the rest as "Chile (hybrid)", so the location rule can read it.
Salaries are USD a month.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

import httpx

from jobtracker.adapters.remoteyeah import html_to_text
from jobtracker.core.models import JobPosting
from jobtracker.core.ports import FetchResult, SourceError

API = "https://www.getonbrd.com/api/v0/categories/{}/jobs"
USER_AGENT = "jobtracker/0.1 (personal job search; reads the public API once a day)"
PER_PAGE = 100
MAX_PAGES = 10
_CATEGORY = re.compile(r"[a-z][a-z-]{1,40}")
_SECTIONS = [
    (None, "projects"),
    ("functions_headline", "functions"),
    ("description_headline", "description"),
    ("desirable_headline", "desirable"),
    ("benefits_headline", "benefits"),
]


def _str(value: object) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _amount(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value) if 0 < value < 1_000_000 else None


def location_of(a: dict) -> str | None:
    countries = [_str(c) for c in a.get("countries") or [] if _str(c) and _str(c) != "Remote"]
    where = ", ".join(countries)
    zone = _str(a.get("remote_zone"))
    modality = a.get("remote_modality")
    if modality == "fully_remote":
        return f"Remote ({zone or where or 'anywhere'})"
    if modality == "remote_local":
        return f"Remote ({where or 'in-country'})"
    if modality == "hybrid":
        return f"{where} (hybrid)" if where else "Hybrid"
    return where or None


def description_of(a: dict) -> str:
    parts = []
    for headline, body in _SECTIONS:
        text = html_to_text(a.get(body) if isinstance(a.get(body), str) else "")
        if text:
            title = _str(a.get(headline)) if headline else ""
            parts.append(f"{title}\n{text}" if title else text)
    return "\n\n".join(parts)


def parse_jobs(data: object) -> list[JobPosting]:
    rows = data.get("data") if isinstance(data, dict) else None
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not isinstance(row.get("attributes"), dict):
            continue
        a = row["attributes"]
        job_id, title = _str(row.get("id")), _str(a.get("title"))
        url = (row.get("links") or {}).get("public_url")
        company = (((a.get("company") or {}).get("data") or {}).get("attributes") or {}).get("name")
        if not (job_id and title and isinstance(url, str) and url.startswith("https://")):
            continue
        lo, hi = _amount(a.get("min_salary")), _amount(a.get("max_salary"))
        published = a.get("published_at")
        out.append(
            JobPosting(
                source="getonbrd",
                source_id=job_id[:200],
                url=url,
                title=title,
                company=_str(company) or "(unknown)",
                description=description_of(a),
                location=location_of(a),
                salary_text=f"USD {' – '.join(f'{n:,}' for n in (lo, hi) if n)} a month"
                if lo or hi
                else None,
                salary_min=lo,
                salary_max=hi,
                salary_period="MONTH" if lo or hi else None,
                publisher="getonbrd",
                posted_at=datetime.fromtimestamp(published, UTC)
                if isinstance(published, int | float) and published > 0
                else None,
            )
        )
    return out


class GetOnBoardSource:
    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT})

    def fetch(self, params: dict) -> FetchResult:
        category = params.get("category")
        if not isinstance(category, str) or not _CATEGORY.fullmatch(category):
            raise SourceError("a getonbrd search needs a category")
        postings: list[JobPosting] = []
        for page in range(1, MAX_PAGES + 1):
            try:
                r = self._client.get(
                    API.format(category),
                    params={"per_page": PER_PAGE, "page": page, "expand": '["company"]'},
                    follow_redirects=False,
                )
            except httpx.HTTPError as err:
                raise SourceError(f"getonbrd request failed ({type(err).__name__})") from err
            if r.status_code != 200:
                raise SourceError(f"getonbrd HTTP {r.status_code}")
            try:
                data = r.json()
            except ValueError as err:
                raise SourceError("getonbrd answer is not JSON") from err
            postings += parse_jobs(data)
            meta = data.get("meta") if isinstance(data, dict) else None
            total = meta.get("total_pages") if isinstance(meta, dict) else None
            if not isinstance(total, int) or page >= total:
                break
        return FetchResult(postings)
