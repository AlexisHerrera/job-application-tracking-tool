"""Google Calendar over its REST API with a read-only OAuth scope.

Login is a one-time browser consent on the host (`jobtracker calendar login`); the resulting
refresh token is stored in the local database (`oauth_credentials`), never in a file in the repo.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
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
    def __init__(self, credentials: dict, calendar_id: str = "primary"):
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2.credentials import Credentials

        self.calendar_id = calendar_id
        creds = Credentials(
            token=None,
            refresh_token=credentials["refresh_token"],
            token_uri=credentials["token_uri"],
            client_id=credentials["client_id"],
            client_secret=credentials["client_secret"],
            scopes=credentials.get("scopes", SCOPES),
        )
        self.session = AuthorizedSession(creds)

    def fetch_changes(self, sync_token: str | None, since: datetime) -> CalendarChanges:
        from google.auth.exceptions import RefreshError

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
            try:
                r = self.session.get(
                    url, params={**params, **({"pageToken": page} if page else {})}
                )
            except RefreshError as err:
                # The usual cause: the app is still in "Testing", where logins expire in 7 days.
                raise CalendarAuthError(
                    "Google login expired or was revoked; run `jobtracker calendar login`"
                ) from err
            if r.status_code == 410:
                raise CalendarSyncExpired()
            if r.status_code in (401, 403):
                raise CalendarAuthError(f"Google Calendar refused access ({r.status_code})")
            r.raise_for_status()
            data = r.json()
            items += [item for ev in data.get("items", []) if (item := parse_event(ev))]
            page = data.get("nextPageToken")
            if not page:
                log.info("calendar: %s changed events", len(items))
                return CalendarChanges(items, data["nextSyncToken"])
