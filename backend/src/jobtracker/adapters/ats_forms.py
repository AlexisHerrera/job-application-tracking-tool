"""The application forms of single postings, from the same public endpoints the apply pages use.

No key and no login, and nothing is submitted: each call only reads the form's fields.
- Greenhouse: GET boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}?questions=true
- Ashby:      POST jobs.ashbyhq.com/api/non-user-graphql (ApiJobPosting → applicationForm);
              unofficial, the query the hosted job page sends
- Lever:      GET jobs.lever.co/{slug}/{id}/apply, the HTML form (Lever has no JSON for it)
- Workable:   GET jobs.workable.com/api/v1/jobs/{id}/form

A 404 (or Ashby's empty answer) means the posting closed. Everything read is untrusted text.
"""

from __future__ import annotations

import html
import re

import httpx

from jobtracker.core.apply import FormField
from jobtracker.core.ports import SourceError

USER_AGENT = "jobtracker/0.1 (personal job search; reads one application form)"
MAX_BYTES = 5 * 1024 * 1024
ASHBY_QUERY = (
    "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {"
    " jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName,"
    " jobPostingId: $jobPostingId) { id applicationForm { sections { title fieldEntries {"
    " ... on FormFieldEntry { field isRequired } } } } } }"
)
_SLUG = r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}"
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_PATTERNS = [
    ("greenhouse", re.compile(rf"greenhouse\.io/({_SLUG})/jobs/(\d+)")),
    ("greenhouse", re.compile(rf"greenhouse\.io/embed/job_app\?for=({_SLUG})&token=(\d+)")),
    ("ashby", re.compile(rf"jobs\.ashbyhq\.com/({_SLUG})/({_UUID})")),
    ("lever", re.compile(rf"jobs\.lever\.co/({_SLUG})/({_UUID})")),
    ("workable", re.compile(r"jobs\.workable\.com/view/([A-Za-z0-9]{6,40})")),
]
SUPPORTED = ("greenhouse", "ashby", "lever", "workable")


def form_target(url: str | None, source: str = "", source_id: str = "") -> tuple[str, str, str]:
    """(ats, slug, job id) of a posting, from its board key or its URL; ("", "", "") if neither
    is one of the four ATSs. Workable's job id is the slug (the form needs nothing else)."""
    if source in ("greenhouse", "ashby", "lever") and ":" in source_id:
        slug, job_id = source_id.split(":", 1)
        if re.fullmatch(_SLUG, slug) and re.fullmatch(r"[0-9a-f-]{1,40}|\d{1,20}", job_id):
            return source, slug, job_id
    for ats, pattern in _PATTERNS:
        if m := pattern.search(url or ""):
            return ats, m[1], m[2] if pattern.groups > 1 else ""
    return "", "", ""


def _plain(value: object) -> str:
    text = re.sub(r"<[^>]+>", " ", value if isinstance(value, str) else "")
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    return re.sub(r"\s+([?.,!:])", r"\1", text)


def parse_greenhouse(d: dict) -> list[FormField]:
    out = []
    for q in (d.get("questions") or []) + (d.get("location_questions") or []):
        kinds = "/".join(f.get("type", "") for f in q.get("fields") or [])
        out.append(FormField(_plain(q.get("label")), kinds, bool(q.get("required"))))
    for q in (d.get("demographic_questions") or {}).get("questions") or []:
        out.append(FormField(_plain(q.get("label")), str(q.get("type")), False, "demographic"))
    return out


def parse_ashby(d: dict) -> list[FormField]:
    posting = (d.get("data") or {}).get("jobPosting")
    if not posting:
        raise SourceError("ashby posting not found", gone=True)
    out = []
    for section in (posting.get("applicationForm") or {}).get("sections") or []:
        for entry in section.get("fieldEntries") or []:
            f = entry.get("field") or {}
            out.append(FormField(_plain(f.get("title")), str(f.get("type")),
                                 bool(entry.get("isRequired")), section.get("title") or ""))  # fmt: skip
    return out


def parse_lever(page: str) -> list[FormField]:
    out = []
    for li in re.findall(r'<li class="application-question[^"]*"[^>]*>(.*?)</li>', page, re.S):
        label = re.search(r'class="application-label[^"]*">(.*?)</div>', li, re.S)
        text = _plain(label[1]).replace("✱", "").strip() if label else ""
        kind = next((k for k, mark in [("textarea", "<textarea"), ("radio", 'type="radio"'),
                                       ("checkbox", 'type="checkbox"'), ("select", "<select"),
                                       ("file", 'type="file"')] if mark in li), "text")  # fmt: skip
        out.append(FormField(text, kind, "required" in li, "custom" if "cards[" in li else ""))
    if re.search(r'<textarea[^>]*name="comments"', page):
        out.append(FormField("Additional information", "textarea", False))
    return out


def parse_workable(d: list) -> list[FormField]:
    out = []

    def walk(fields: list, group: str) -> None:
        for f in fields:
            if f.get("fields") and f.get("type") not in ("multiple", "dropdown", "boolean"):
                walk(f["fields"], f.get("label") or group)
            else:
                out.append(FormField(_plain(f.get("label")), str(f.get("type")),
                                     bool(f.get("required")), group))  # fmt: skip

    for section in d if isinstance(d, list) else []:
        walk(section.get("fields") or [], section.get("name") or "")
    return out


class AtsForms:
    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(timeout=20.0, headers={"User-Agent": USER_AGENT})

    def _get(self, ats: str, method: str, url: str, **kw) -> httpx.Response:
        try:
            r = self._client.request(method, url, follow_redirects=False, **kw)
        except httpx.HTTPError as err:
            raise SourceError(f"{ats} request failed ({type(err).__name__})") from err
        if r.status_code in (404, 410):
            raise SourceError(f"{ats} posting closed", gone=True)
        if r.status_code != 200:
            raise SourceError(f"{ats} HTTP {r.status_code}")
        if len(r.content) > MAX_BYTES:
            raise SourceError(f"{ats} form is larger than 5 MB")
        return r

    def fetch_form(self, ats: str, slug: str, job_id: str) -> list[FormField]:
        try:
            if ats == "greenhouse":
                url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{job_id}"
                return parse_greenhouse(self._get(ats, "GET", url + "?questions=true").json())
            if ats == "ashby":
                body = {"operationName": "ApiJobPosting", "query": ASHBY_QUERY,
                        "variables": {"organizationHostedJobsPageName": slug,
                                      "jobPostingId": job_id}}  # fmt: skip
                url = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting"
                return parse_ashby(self._get(ats, "POST", url, json=body).json())
            if ats == "lever":
                url = f"https://jobs.lever.co/{slug}/{job_id}/apply"
                fields = parse_lever(self._get(ats, "GET", url).text)
                if not fields:
                    raise SourceError("lever form not found (closed, or the page changed)")
                return fields
            if ats == "workable":
                url = f"https://jobs.workable.com/api/v1/jobs/{slug}/form"
                return parse_workable(self._get(ats, "GET", url).json())
        except ValueError as err:  # a body that isn't the JSON we expect
            raise SourceError(f"{ats} form is not JSON") from err
        raise SourceError(f"not a supported form: {ats}")
