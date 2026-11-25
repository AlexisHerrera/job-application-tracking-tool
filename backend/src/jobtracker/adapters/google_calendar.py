"""Google Calendar over its REST API with a read-only scope.

Two ways in, the first one configured wins:

- **Service account** (`GOOGLE_SERVICE_ACCOUNT_KEY`): you share your calendar with the account
  ("See all event details") and it reads it with its own key. No consent screen, no 7-day
  expiry, and it works from a Lambda. The key is a setting like the other secrets: `.env`
  locally (written by `jobtracker calendar use-service-account`), SSM in AWS.
- **OAuth login** (`jobtracker calendar login`): a browser consent on the host; the refresh token
  is stored in the local database (`oauth_credentials`). While the consent screen is in
  "Testing", Google expires it after 7 days.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from jobtracker.core.models import CalendarItem
from jobtracker.core.ports import CalendarAuthError, CalendarChanges, CalendarSyncExpired

log = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
PROVIDER = "google_calendar"
API = "https://www.googleapis.com/calendar/v3"
# Working location, out of office, focus time and birthdays are never interviews.
_SKIP_TYPES = {"workingLocation", "outOfOffice", "focusTime", "birthday", "fromGmail"}
_DESCRIPTION_CHARS = 2000  # matched in memory only, never stored


_KEY_FIELDS = ("client_email", "private_key", "token_uri")


def decode_service_account_key(value: str) -> dict:
    """The key as stored in settings: base64 of the JSON (what we write), or the JSON itself."""
    value = value.strip()
    try:
        text = value if value.startswith("{") else base64.b64decode(value, validate=True).decode()
        info = json.loads(text)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as err:
        raise ValueError("not a service account key (expected its JSON, or base64 of it)") from err
    if not isinstance(info, dict) or info.get("type") != "service_account":
        raise ValueError("not a service account key: its JSON should have type=service_account")
    if missing := [f for f in _KEY_FIELDS if not info.get(f)]:
        raise ValueError(f"service account key is missing {', '.join(missing)}")
    return info


def encode_service_account_key(info: dict) -> str:
    """One line with nothing to escape, for `.env`, docker compose and SSM alike."""
    return base64.b64encode(json.dumps(info, separators=(",", ":")).encode()).decode()


def make_source(
    service_account_key: str, calendar_id: str, oauth: dict | None
) -> GoogleCalendarSource | None:
    """The configured calendar source: the service account if set, else the stored OAuth login."""
    if service_account_key:
        return GoogleCalendarSource.from_service_account(
            decode_service_account_key(service_account_key), calendar_id
        )
    if oauth:
        return GoogleCalendarSource.from_oauth(oauth, calendar_id)
    return None


def find_client_file() -> Path | None:
    """The OAuth client JSON downloaded from Google Cloud, in the repo root or here."""
    for folder in (Path("."), Path("..")):
        hits = sorted(folder.glob("client_secret*.json"))
        if hits:
            return hits[0]
    return None


def login(client_file: Path) -> dict:
    """Open the browser for consent and return the credentials to store."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(str(client_file), SCOPES)
    # prompt=consent makes Google issue a refresh token even if this app was approved before.
    creds = flow.run_local_server(
        port=0, access_type="offline", prompt="consent", open_browser=True
    )
    if not creds.refresh_token:
        raise CalendarAuthError("Google returned no refresh token; try `calendar login` again")
    return {
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "scopes": SCOPES,
        "logged_in_at": datetime.now(UTC).isoformat(),
    }


def _parse_time(value: dict | None) -> datetime | None:
    if not value or "dateTime" not in value:
        return None  # all-day events only have "date"
    return datetime.fromisoformat(value["dateTime"]).astimezone(UTC)


def _meeting_url(ev: dict) -> str | None:
    if ev.get("hangoutLink"):
        return ev["hangoutLink"]
    for entry in (ev.get("conferenceData") or {}).get("entryPoints", []):
        if entry.get("entryPointType") == "video" and entry.get("uri"):
            return entry["uri"]
    return None


def parse_event(ev: dict) -> CalendarItem | None:
    """One API event resource -> CalendarItem. None for event types that are never interviews."""
    if ev.get("eventType") in _SKIP_TYPES:
        return None
    attendees = ev.get("attendees") or []
    me = next((a for a in attendees if a.get("self")), None)
    return CalendarItem(
        calendar_event_id=ev["id"],
        status=ev.get("status", "confirmed"),
        title=ev.get("summary", ""),
        start=_parse_time(ev.get("start")),
        end=_parse_time(ev.get("end")),
        ical_uid=ev.get("iCalUID"),
        description=(ev.get("description") or "")[:_DESCRIPTION_CHARS],
        location=ev.get("location"),
        meeting_url=_meeting_url(ev),
        organizer=(ev.get("organizer") or {}).get("email"),
        attendees=[a["email"] for a in attendees if a.get("email") and not a.get("resource")],
        html_link=ev.get("htmlLink"),
        declined=bool(me and me.get("responseStatus") == "declined"),
    )


class GoogleCalendarSource:
    def __init__(
        self,
        creds,
        calendar_id: str,
        *,
        auth: str,
        session=None,
        make_creds: Callable[[], Any] | None = None,
        account: str | None = None,
    ):
        """`auth` is "service_account" or "oauth"; `session` is for tests. `make_creds` instead of
        `creds` defers google-auth (~50-80 ms of imports in Lambda) to the first call to Google:
        GET /api/shell, on every page load, makes a source only to say the calendar is connected.
        """
        self.calendar_id = calendar_id
        self.auth = auth
        self._account = account or getattr(creds, "service_account_email", None)
        self._creds, self._make_creds, self._session = creds, make_creds, session

    @property
    def session(self):
        if self._session is None:
            from google.auth.transport.requests import AuthorizedSession

            creds = self._creds if self._make_creds is None else self._make_creds()
            self._session = AuthorizedSession(creds)
        return self._session

    @classmethod
    def from_oauth(cls, credentials: dict, calendar_id: str = "primary") -> GoogleCalendarSource:
        def make_creds():
            from google.oauth2.credentials import Credentials

            return Credentials(
                token=None,
                refresh_token=credentials["refresh_token"],
                token_uri=credentials["token_uri"],
                client_id=credentials["client_id"],
                client_secret=credentials["client_secret"],
                scopes=credentials.get("scopes", SCOPES),
            )

        return cls(None, calendar_id, auth="oauth", make_creds=make_creds)

    @classmethod
    def from_service_account(cls, info: dict, calendar_id: str) -> GoogleCalendarSource:
        def make_creds():
            from google.oauth2 import service_account

            return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)

        return cls(
            None,
            calendar_id,
            auth="service_account",
            make_creds=make_creds,
            account=info.get("client_email"),
        )

    def _get(self, url: str, params: dict[str, str] | None = None):
        """GET with Google's auth failures turned into CalendarAuthError."""
        from google.auth.exceptions import RefreshError

        try:
            r = self.session.get(url, params=params)
        except RefreshError as err:
            if self.auth == "service_account":
                raise CalendarAuthError(
                    "Google rejected the service account key (deleted or disabled?); create a "
                    "new key and run `jobtracker calendar use-service-account` again"
                ) from err
            # The usual cause: the app is still in "Testing", where logins expire in 7 days.
            raise CalendarAuthError(
                "Google login expired or was revoked; run `jobtracker calendar login`"
            ) from err
        if r.status_code == 404 and self.auth == "service_account":
            # What Google answers for a calendar that isn't shared with the account.
            raise CalendarAuthError(
                f"calendar {self.calendar_id!r} not found or not shared with {self._account}: "
                "share it with that address (See all event details)"
            )
        if r.status_code in (401, 403):
            raise CalendarAuthError(f"Google Calendar refused access ({r.status_code})")
        return r

    def calendar_name(self) -> str:
        """Reads only the calendar's own metadata (no events): proves the access works."""
        r = self._get(f"{API}/calendars/{quote(self.calendar_id, safe='')}")
        r.raise_for_status()
        return r.json().get("summary") or self.calendar_id

    def fetch_changes(self, sync_token: str | None, since: datetime) -> CalendarChanges:
        params: dict[str, str] = {
            "singleEvents": "true",
            "showDeleted": "true",
            "maxResults": "250",
        }
        if sync_token:
            params["syncToken"] = sync_token
        else:
            params["timeMin"] = since.astimezone(UTC).isoformat()
        url = f"{API}/calendars/{quote(self.calendar_id, safe='')}/events"
        items: list[CalendarItem] = []
        page: str | None = None
        while True:
            r = self._get(url, {**params, **({"pageToken": page} if page else {})})
            if r.status_code == 410:
                raise CalendarSyncExpired()
            r.raise_for_status()
            data = r.json()
            items += [item for ev in data.get("items", []) if (item := parse_event(ev))]
            page = data.get("nextPageToken")
            if not page:
                log.info("calendar: %s changed events", len(items))
                return CalendarChanges(items, data["nextSyncToken"])
