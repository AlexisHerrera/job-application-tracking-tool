"""RFC 822 bytes -> EmailMessage. Stdlib only."""

from __future__ import annotations

import email
import email.policy
import hashlib
import re
from datetime import UTC, datetime
from email.message import EmailMessage as StdEmailMessage
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from html.parser import HTMLParser
from typing import ClassVar

from jobtracker.core.models import EmailMessage

_MSGID_RE = re.compile(r"<[^>]+>")


class _HTMLText(HTMLParser):
    _SKIP: ClassVar[set[str]] = {"script", "style", "head", "title"}
    _BLOCK: ClassVar[set[str]] = {
        "p",
        "div",
        "br",
        "tr",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "table",
        "section",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")
        if tag == "a":
            href = dict(attrs).get("href") or ""
            # Keep scheduling links visible to the heuristics (Calendly, GoodTime...).
            if any(h in href for h in ("calendly", "goodtime", "cal.com", "ashbyhq", "greenhouse")):
                self.parts.append(f" {href} ")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip:
            self._skip -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _HTMLText()
    p.feed(html)
    text = "".join(p.parts)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def _ids(value: str | None) -> list[str]:
    return _MSGID_RE.findall(value or "")


def _body(msg: StdEmailMessage) -> str:
    plain = msg.get_body(preferencelist=("plain",))
    if plain is not None:
        try:
            text = plain.get_content()
        except (LookupError, UnicodeDecodeError):
            text = plain.get_payload(decode=True).decode("utf-8", "replace")
        if text.strip():
            return text
    html = msg.get_body(preferencelist=("html",))
    if html is not None:
        try:
            return html_to_text(html.get_content())
        except (LookupError, UnicodeDecodeError):
            return html_to_text(html.get_payload(decode=True).decode("utf-8", "replace"))
    return ""


def parse_email(
    raw: bytes, *, uid: int | None = None, gm_thread_id: str | None = None
) -> EmailMessage:
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    assert isinstance(msg, StdEmailMessage)

    from_name, from_addr = parseaddr(str(msg.get("From", "")))
    date_hdr = msg.get("Date")
    try:
        received = parsedate_to_datetime(str(date_hdr)) if date_hdr else None
    except (TypeError, ValueError):
        received = None
    if received is None:
        received = datetime.now(UTC)
    elif received.tzinfo is None:
        received = received.replace(tzinfo=UTC)

    message_id = (_ids(str(msg.get("Message-ID", ""))) or [None])[0]
    if not message_id:
        # Stable synthetic id so dedupe still works for broken senders.
        message_id = "<sha256-" + hashlib.sha256(raw).hexdigest()[:32] + "@local>"

    calendar_parts: list[bytes] = []
    attachment_names: list[str] = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        filename = part.get_filename()
        if filename:
            attachment_names.append(filename)
        if ctype == "text/calendar" or (filename or "").lower().endswith(".ics"):
            payload = part.get_payload(decode=True)
            if payload:
                calendar_parts.append(payload)

    auto = str(msg.get("Auto-Submitted", "")).lower()
    return EmailMessage(
        uid=uid,
        gm_thread_id=gm_thread_id,
        message_id=message_id,
        from_address=from_addr.lower(),
        from_name=from_name.strip(),
        to_addresses=[a.lower() for _, a in getaddresses([str(v) for v in msg.get_all("To", [])])],
        subject=str(msg.get("Subject", "")).strip(),
        received_at=received.astimezone(UTC),
        text=_body(msg),
        in_reply_to=(_ids(str(msg.get("In-Reply-To", ""))) or [None])[0],
        references=_ids(str(msg.get("References", ""))),
        list_unsubscribe=msg.get("List-Unsubscribe") is not None,
        list_id=str(msg["List-Id"]) if msg.get("List-Id") else None,
        auto_submitted=bool(auto) and auto != "no",
        calendar_parts=calendar_parts,
        attachment_names=attachment_names,
    )


_QUOTE_HEADERS = re.compile(
    r"^(On .{5,200} wrote:|El .{5,200} escribió:|-----Original Message-----|"
    r"-------- Mensaje original --------|From: .+|De: .+)\s*$",
    re.MULTILINE,
)


def strip_quoted(text: str) -> str:
    """Drop the quoted history of a reply so the LLM only sees the new message."""
    m = _QUOTE_HEADERS.search(text)
    if m and m.start() > 40:
        text = text[: m.start()]
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith(">")]
    return "\n".join(lines)


def clean_body(text: str, limit: int) -> str:
    text = strip_quoted(text)
    text = re.sub(r"https?://\S{80,}", "[long-link]", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return text[:limit]


def snippet(text: str, limit: int = 280) -> str:
    one_line = re.sub(r"\s+", " ", strip_quoted(text)).strip()
    return one_line[:limit]
