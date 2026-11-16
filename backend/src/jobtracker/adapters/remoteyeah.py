"""JobSource on remoteyeah.com's per-category RSS feeds (free; robots.txt allows everything).

The feed isn't well-formed XML (bare `&` in titles and URLs), so stray ampersands are escaped
before parsing, and parsing uses defusedxml because the document comes from the web. Only
https://remoteyeah.com/*.xml URLs are fetched, whatever a saved search says.
"""

from __future__ import annotations

import html
import re
from datetime import UTC, datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from xml.etree.ElementTree import Element

import httpx
from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from jobtracker.core.models import JobPosting
from jobtracker.core.ports import FetchResult, SourceError

HOST = "remoteyeah.com"
USER_AGENT = "jobtracker/0.1 (personal job search; reads RSS once a day)"
MAX_BYTES = 5 * 1024 * 1024
_BARE_AMP = re.compile(r"&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)")
_TRACKING = {"ref", "source"}


def feed_url_ok(url: object) -> bool:
    if not isinstance(url, str):
        return False
    parts = urlsplit(url)
    return parts.scheme == "https" and parts.hostname == HOST and parts.path.endswith(".xml")


def clean_link(url: str) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if not k.startswith("utm_") and k not in _TRACKING]  # fmt: skip
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


_BLOCK_END = re.compile(r"</(p|li|h[1-6]|ul|ol|div)>|<br\s*/?>", re.IGNORECASE)
_LI = re.compile(r"<li[^>]*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def html_to_text(raw: str) -> str:
    text = _LI.sub("- ", _BLOCK_END.sub("\n", raw))
    text = html.unescape(_TAG.sub("", text))
    lines = (" ".join(line.split()) for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def _text(item: Element, tag: str) -> str:
    return " ".join((item.findtext(tag) or "").split())


def _title(raw: str, company: str) -> str:
    title = re.sub(r"^remote\s+", "", raw, flags=re.IGNORECASE)
    suffix = f" at {company}"
    if company and title.lower().endswith(suffix.lower()):
        title = title[: -len(suffix)]
    return title.strip() or raw


def _date(raw: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def parse_feed(text: str) -> list[JobPosting]:
    try:
        root = ElementTree.fromstring(_BARE_AMP.sub("&amp;", text))
    except (ElementTree.ParseError, DefusedXmlException) as err:
        raise SourceError(f"remoteyeah feed is not parseable ({type(err).__name__})") from err
    out = []
    for item in root.iter("item"):
        guid, company, link = _text(item, "guid"), _text(item, "company"), _text(item, "link")
        if not (guid and company and link.startswith("https://")):
            continue
        tags = _text(item, "tags")
        description = html_to_text(item.findtext("description") or "")
        out.append(
            JobPosting(
                source="remoteyeah",
                source_id=guid[:200],
                url=clean_link(link),
                title=_title(_text(item, "title"), company),
                company=company,
                description=f"Tags: {tags}\n\n{description}" if tags else description,
                location=_text(item, "location") or None,
                publisher="remoteyeah",
                posted_at=_date(_text(item, "pubDate")),
            )
        )
    return out


class RemoteYeahSource:
    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT})

    def fetch(self, params: dict) -> FetchResult:
        url = params.get("feed")
        if not feed_url_ok(url):
            raise SourceError("feed must be an https://remoteyeah.com/….xml URL")
        try:
            r = self._client.get(url, follow_redirects=False)
        except httpx.HTTPError as err:
            raise SourceError(f"remoteyeah request failed ({type(err).__name__})") from err
        if r.status_code != 200:
            hint = " (blocked by Cloudflare?)" if r.status_code in {403, 503} else ""
            raise SourceError(f"remoteyeah HTTP {r.status_code}{hint}")
        if len(r.content) > MAX_BYTES:
            raise SourceError("remoteyeah feed is larger than 5 MB")
        return FetchResult(parse_feed(r.text))
