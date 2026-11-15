"""JobSource on Workable's public job search (jobs.workable.com; plan §21, round 3). No key:
GET /api/v1/jobs?query=…&location=…, 20 jobs a page, the next page through `nextPageToken`.

The search covers every company that hires through Workable, so there is no board to watch per
company: a saved search by country does it. Only published jobs are listed, so a job that is
here is open, however old. The location is written as "Buenos Aires, Argentina (remote)" so the
location rule can read it.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx

from jobtracker.adapters.remoteyeah import html_to_text
from jobtracker.core.models import JobPosting
from jobtracker.core.ports import FetchResult, SourceError

API = "https://jobs.workable.com/api/v1/jobs"
USER_AGENT = "jobtracker/0.1 (personal job search; reads the public search once a day)"
MAX_PAGES = 15  # 300 jobs a search
_WORKPLACE = {"remote": "remote", "hybrid": "hybrid", "on_site": "on-site"}
_SECTIONS = ("description", "requirementsSection", "benefitsSection")


def _str(value: object) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def location_of(j: dict) -> str | None:
    place = j.get("location") if isinstance(j.get("location"), dict) else {}
    where = ", ".join(x for x in (_str(place.get("city")), _str(place.get("countryName"))) if x)
    mode = _WORKPLACE.get(_str(j.get("workplace")))
    if where and mode:
        return f"{where} ({mode})"[:300]
    return (where or (mode.capitalize() if mode else ""))[:300] or None


def parse_jobs(data: object) -> list[JobPosting]:
    jobs = data.get("jobs") if isinstance(data, dict) else None
    out = []
    for j in jobs if isinstance(jobs, list) else []:
        if not isinstance(j, dict):
            continue
        job_id, title, url = _str(j.get("id")), _str(j.get("title")), j.get("url")
        if not (job_id and title and isinstance(url, str) and url.startswith("https://")):
            continue
        company = j.get("company") if isinstance(j.get("company"), dict) else {}
        parts = (html_to_text(j[k]) for k in _SECTIONS if isinstance(j.get(k), str))
        out.append(
            JobPosting(
                source="workable",
                source_id=job_id[:200],
                url=url,
                title=title,
                company=_str(company.get("title")) or "(unknown)",
                description="\n\n".join(p for p in parts if p),
                location=location_of(j),
                employment_type=_str(j.get("employmentType"))[:60] or None,
                publisher="Workable",
                posted_at=_iso(j.get("created")),
            )
        )
    return out


class WorkableSource:
    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT})

    def fetch(self, params: dict) -> FetchResult:
        query, location = _str(params.get("query")), _str(params.get("location"))
        if not (query or location):
            raise SourceError("a Workable search needs a query or a location")
        ask = {k: v for k, v in (("query", query), ("location", location)) if v}
        postings: dict[str, JobPosting] = {}
        token = None
        for _ in range(MAX_PAGES):
            try:
                r = self._client.get(
                    API,
                    params={**ask, "pageToken": token} if token else ask,
                    follow_redirects=False,
                )
            except httpx.HTTPError as err:
                raise SourceError(f"workable request failed ({type(err).__name__})") from err
            if r.status_code != 200:
                raise SourceError(f"workable HTTP {r.status_code}")
            try:
                data = r.json()
            except ValueError as err:
                raise SourceError("workable answer is not JSON") from err
            page = [p for p in parse_jobs(data) if p.source_id not in postings]
            postings.update((p.source_id, p) for p in page)
            token = data.get("nextPageToken") if isinstance(data, dict) else None
            # A token the API doesn't know gives the first page again: stop when nothing is new.
            if not page or not isinstance(token, str) or not token:
                break
        return FetchResult(list(postings.values()), 0)
