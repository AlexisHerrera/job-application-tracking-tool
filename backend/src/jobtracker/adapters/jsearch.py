"""JobSource on OpenWebNinja's JSearch API (Google for Jobs: LinkedIn, Indeed, Glassdoor…).

Each page of up to 10 jobs is one paid request, and the plan includes 200 free a month, so every
search asks for one page (at most 3). The `x-rapidapi-billing` response header says what a call
cost. The API key goes in a header and is never logged.

With `country=ar` the results come in Spanish ("hace 4 días", no UTC timestamp) and `language=en`
returns nothing, so the language is left to the API and relative dates are parsed here.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

import httpx

from jobtracker.core.clock import SystemClock
from jobtracker.core.discovery import parse_relative_age
from jobtracker.core.models import JobPosting
from jobtracker.core.ports import Clock, FetchResult, SourceError

log = logging.getLogger(__name__)

SEARCH_URL = "https://api.openwebninja.com/jsearch/search-v2"
PARAMS = {
    "query", "country", "language", "date_posted", "work_from_home", "employment_types",
    "job_requirements", "radius", "exclude_job_publishers",
}  # fmt: skip
MAX_PAGES = 3
_BILLED = re.compile(r"Requests=(\d+)")


def _billed(header: str | None, default: int) -> int:
    m = _BILLED.search(header or "")
    return int(m.group(1)) if m else default


def _http_url(value: object) -> str | None:
    return value if isinstance(value, str) and value.startswith(("https://", "http://")) else None


def _int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value) if 0 < value < 100_000_000 else None


def _text(value: object) -> str | None:
    return " ".join(value.split()) if isinstance(value, str) and value.strip() else None


def _posted_at(job: dict, now: datetime) -> datetime | None:
    raw = job.get("job_posted_at_datetime_utc")
    if isinstance(raw, str) and raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
        except ValueError:
            pass
    ts = job.get("job_posted_at_timestamp")
    if isinstance(ts, int | float) and not isinstance(ts, bool) and ts > 0:
        return datetime.fromtimestamp(ts, UTC)
    return parse_relative_age(job.get("job_posted_at"), now)


def parse_job(job: dict, now: datetime) -> JobPosting | None:
    source_id = job.get("job_uid") or job.get("job_id")
    title, company = _text(job.get("job_title")), _text(job.get("employer_name"))
    url = _http_url(job.get("job_apply_link")) or _http_url(job.get("job_google_link"))
    if not (isinstance(source_id, str) and source_id and title and company and url):
        return None
    # "Argentina  •  a través de LinkedIn": the part after the dot is the publisher.
    location = _text((job.get("job_location") or "").split("•")[0])
    return JobPosting(
        source="jsearch",
        source_id=source_id[:200],
        url=url,
        title=title,
        company=company,
        description=job.get("job_description")
        if isinstance(job.get("job_description"), str)
        else "",
        location=location,
        employment_type=_text(job.get("job_employment_type")),
        salary_text=_text(job.get("job_salary_string")) or _text(job.get("job_salary")),
        salary_min=_int(job.get("job_min_salary")),
        salary_max=_int(job.get("job_max_salary")),
        salary_period=_text(job.get("job_salary_period")),
        publisher=_text(job.get("job_publisher")),
        posted_at=_posted_at(job, now),
    )


class JSearchSource:
    def __init__(
        self,
        api_key: str,
        *,
        clock: Clock | None = None,
        client: httpx.Client | None = None,
        date_posted: str = "3days",
    ):
        if not api_key:
            raise ValueError("JSEARCH_API_KEY is required")
        self._key = api_key
        self._clock = clock or SystemClock()
        self._client = client or httpx.Client(timeout=30.0)
        self._date_posted = date_posted

    def fetch(self, params: dict) -> FetchResult:
        query: dict[str, str | int] = {}
        for k, v in params.items():
            if k in PARAMS and v not in (None, ""):
                query[k] = ("true" if v else "false") if isinstance(v, bool) else v
        if not query.get("query"):
            raise SourceError("search has no query")
        query.setdefault("date_posted", self._date_posted)
        pages = params.get("num_pages", 1)
        query["num_pages"] = max(1, min(MAX_PAGES, pages if isinstance(pages, int) else 1))
        try:
            r = self._client.get(SEARCH_URL, params=query, headers={"x-api-key": self._key})
        except httpx.HTTPError as err:
            raise SourceError(f"JSearch request failed ({type(err).__name__})") from err
        billed = _billed(r.headers.get("x-rapidapi-billing"), 0)
        if r.status_code != 200:
            raise SourceError(f"JSearch HTTP {r.status_code}", requests=billed)
        try:
            data = r.json()
        except ValueError as err:
            raise SourceError("JSearch returned invalid JSON", requests=billed) from err
        jobs = (data.get("data") or {}).get("jobs") if isinstance(data, dict) else None
        if not isinstance(jobs, list):
            raise SourceError("JSearch response has no data.jobs", requests=billed)
        now = self._clock.now()
        postings = [p for j in jobs if isinstance(j, dict) and (p := parse_job(j, now))]
        return FetchResult(postings, billed or int(query["num_pages"]))
