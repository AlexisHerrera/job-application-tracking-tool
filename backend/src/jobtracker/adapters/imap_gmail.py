"""Gmail over IMAP with an app password. Read-only: the mailbox is EXAMINEd and bodies are PEEKed,
so nothing gets marked as read."""

from __future__ import annotations

import contextlib
import imaplib
import logging
import re
from collections.abc import Iterator
from datetime import date, timedelta

from jobtracker.core.email_parse import parse_email
from jobtracker.core.models import EmailMessage

log = logging.getLogger(__name__)

_LIST_RE = re.compile(rb'\((?P<flags>[^)]*)\) "(?P<delim>[^"]*)" (?P<name>.+)$')
_FETCH_META = re.compile(rb"UID (\d+)|X-GM-THRID (\d+)|RFC822\.SIZE (\d+)")
MAX_MESSAGE_BYTES = 8 * 1024 * 1024
BATCH = 25


def _quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


class GmailImapSource:
    def __init__(self, host: str, address: str, app_password: str, extra_query: str):
        if not address or not app_password:
            raise ValueError("GMAIL_ADDRESS and GMAIL_APP_PASSWORD are required for IMAP")
        self.extra_query = extra_query
        self.conn = imaplib.IMAP4_SSL(host)
        self.conn.login(address, app_password)
        self.mailbox = self._all_mail_name()
        typ, _ = self.conn.select(_quote(self.mailbox), readonly=True)
        if typ != "OK":
            raise RuntimeError(f"cannot open {self.mailbox}")

    def close(self) -> None:
        with contextlib.suppress(imaplib.IMAP4.error, OSError):
            self.conn.logout()

    def _all_mail_name(self) -> str:
        # Locale-independent: "[Gmail]/All Mail" is "[Gmail]/Todos" in Spanish accounts.
        _typ, lines = self.conn.list()
        for line in lines or []:
            m = _LIST_RE.match(line or b"")
            if m and b"\\All" in m.group("flags"):
                return m.group("name").strip().strip(b'"').decode("utf-8")
        raise RuntimeError("could not find the \\All mailbox; is IMAP enabled for All Mail?")

    def uidvalidity(self) -> int:
        return self._status("UIDVALIDITY")

    def last_uid(self) -> int:
        return self._status("UIDNEXT") - 1

    def _status(self, item: str) -> int:
        _typ, data = self.conn.status(_quote(self.mailbox), f"({item})")
        m = re.search(rf"{item} (\d+)".encode(), data[0] if data else b"")
        if not m:
            raise RuntimeError(f"IMAP STATUS {item} failed")
        return int(m.group(1))

    def _search(self, criteria: list[str]) -> list[int]:
        typ, data = self.conn.uid("SEARCH", None, *criteria)
        if typ != "OK":
            raise RuntimeError("IMAP search failed")
        return sorted(int(u) for u in (data[0] or b"").split())

    def fetch_new(self, after_uid: int) -> Iterator[EmailMessage]:
        query = self.extra_query.strip()
        criteria = [f"UID {after_uid + 1}:*"]
        if query:
            criteria += ["X-GM-RAW", _quote(query)]
        # "N:*" always matches the newest message even when its UID < N.
        uids = [u for u in self._search(criteria) if u > after_uid]
        yield from self._fetch(uids)

    def fetch_range(self, since: date, until: date | None) -> Iterator[EmailMessage]:
        parts = [f"after:{since:%Y/%m/%d}"]
        if until:
            parts.append(f"before:{(until + timedelta(days=1)):%Y/%m/%d}")
        if self.extra_query.strip():
            parts.append(self.extra_query.strip())
        uids = self._search(["X-GM-RAW", _quote(" ".join(parts))])
        log.info("backfill matched %d messages", len(uids))
        yield from self._fetch(uids)

    def fetch_by_message_ids(self, message_ids: list[str]) -> Iterator[EmailMessage]:
        uids = []
        for mid in message_ids:
            found = self._search(["X-GM-RAW", _quote(f"rfc822msgid:{mid.strip('<>')}")])
            if not found:
                log.warning("message no longer in the mailbox")  # never log the id or content
            uids += found[:1]
        yield from self._fetch(sorted(set(uids)))

    def _fetch(self, uids: list[int]) -> Iterator[EmailMessage]:
        for i in range(0, len(uids), BATCH):
            chunk = ",".join(str(u) for u in uids[i : i + BATCH])
            typ, meta = self.conn.uid("FETCH", chunk, "(UID X-GM-THRID RFC822.SIZE)")
            sizes: dict[int, tuple[str | None, int]] = {}
            for item in meta or []:
                line = item[0] if isinstance(item, tuple) else item
                if not line:
                    continue
                uid = thrid = size = None
                for m in _FETCH_META.finditer(line):
                    uid = int(m.group(1)) if m.group(1) else uid
                    thrid = m.group(2).decode() if m.group(2) else thrid
                    size = int(m.group(3)) if m.group(3) else size
                if uid is not None:
                    sizes[uid] = (thrid, size or 0)
            for uid in uids[i : i + BATCH]:
                thrid, size = sizes.get(uid, (None, 0))
                part = "BODY.PEEK[HEADER]" if size > MAX_MESSAGE_BYTES else "BODY.PEEK[]"
                typ, data = self.conn.uid("FETCH", str(uid), f"({part})")
                raw = next((d[1] for d in data or [] if isinstance(d, tuple)), None)
                if typ != "OK" or raw is None:
                    log.warning("could not fetch uid=%s", uid)
                    continue
                yield parse_email(raw, uid=uid, gm_thread_id=thrid)
