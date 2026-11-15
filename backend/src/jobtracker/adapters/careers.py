"""From a company's website to its job board (plan §21, round 3): the home page or one of its
careers pages usually links to, or embeds, an Ashby, Greenhouse or Lever board.

Used when the user adds one company by URL. It was measured as a way to grow the watchlist in
bulk (the YC hiring list, Hacker News, company names from other sources) and found almost
nothing new for Latin America, so it only runs on request. The URL comes from the user and the
pages from the web: only https, a size cap, and nothing in them is followed except links to the
same site.
"""

from __future__ import annotations

import html
import re
from urllib.parse import urljoin, urlsplit

import httpx

USER_AGENT = "Mozilla/5.0 (compatible; jobtracker/0.1; personal job search)"
MAX_BYTES = 3 * 1024 * 1024
CAREERS_PAGES = 3  # careers-looking links tried when the first page has no board
_SLUG = r"([A-Za-z0-9][A-Za-z0-9._-]{0,99})"
_BOARD_LINKS = [
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/" + _SLUG)),
    ("ashby", re.compile(r"api\.ashbyhq\.com/posting-api/job-board/" + _SLUG)),
    ("greenhouse", re.compile(r"boards-api\.greenhouse\.io/v1/boards/" + _SLUG)),
    ("greenhouse", re.compile(
        r"(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board(?:/js)?\?for=)?" + _SLUG
    )),
    ("lever", re.compile(r"(?:jobs(?:\.eu)?\.lever\.co|api\.lever\.co/v0/postings)/" + _SLUG)),
]  # fmt: skip
_NOT_A_SLUG = {"embed", "api", "js", "v1", "v0", "postings", "boards", "job_board"}
_HREF = re.compile(r"""href\s*=\s*["']([^"'#]+)""", re.IGNORECASE)
_CAREERS = re.compile(
    r"career|jobs?\b|join|hiring|work-?with|open-?(roles|positions)|vacan|empleo|trabaj",
    re.IGNORECASE,
)


def find_boards(text: str) -> list[tuple[str, str]]:
    """Every (ats, slug) a text links to, in the order above. Lever slugs keep their case."""
    out: list[tuple[str, str]] = []
    for ats, pattern in _BOARD_LINKS:
        for m in pattern.finditer(text):
            slug = m.group(1).rstrip(".")
            if slug and slug.lower() not in _NOT_A_SLUG and (ats, slug) not in out:
                out.append((ats, slug))
    return out


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").removeprefix("www.")


class BoardFinder:
    def __init__(self, client: httpx.Client | None = None):
        self._client = client or httpx.Client(
            timeout=15.0,
            max_redirects=5,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"},
        )

    def _page(self, url: str) -> tuple[str, str]:
        """(final URL, HTML) of a page; no HTML when it can't be read."""
        try:
            with self._client.stream("GET", url, follow_redirects=True) as r:
                final = str(r.url)
                if r.status_code != 200 or not final.startswith("https://"):
                    return final, ""
                body = b""
                for chunk in r.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        break
                return final, body[:MAX_BYTES].decode(r.encoding or "utf-8", "replace")
        except (httpx.HTTPError, ValueError, LookupError):
            return url, ""

    def find(self, url: str) -> tuple[str, str] | None:
        """The board behind a URL: a board link itself, a company's site, or its careers page."""
        url = url.strip()
        if "://" not in url:
            url = "https://" + url
        if not url.startswith("https://") or not _host(url):
            return None
        if found := find_boards(url):
            return found[0]
        final, text = self._page(url)
        if found := find_boards(f"{final} {text}"):
            return found[0]
        site, links = _host(final), []
        for href in _HREF.findall(text):
            link = urljoin(final, html.unescape(href))
            parts = urlsplit(link)
            same_site = _host(link) == site or _host(link).endswith("." + site)
            if (
                parts.scheme == "https"
                and same_site
                and _CAREERS.search(f"{parts.hostname}{parts.path}")
                and link not in links
            ):
                links.append(link)
        for link in links[:CAREERS_PAGES]:
            final, text = self._page(link)
            if found := find_boards(f"{final} {text}"):
                return found[0]
        return None
