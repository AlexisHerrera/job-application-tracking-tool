"""Service account access to Google Calendar: the key setting, the source factory, auth errors,
and moving stored interviews when the calendar ID changes. Nothing here talks to Google."""

import base64
import json
from datetime import UTC, datetime

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from jobtracker.adapters.google_calendar import (
    GoogleCalendarSource,
    decode_service_account_key,
    encode_service_account_key,
    make_source,
)
from jobtracker.api.app import create_app
from jobtracker.core.models import Interview, InterviewSource, InterviewStatus
from jobtracker.core.ports import CalendarAuthError, CalendarSyncExpired
from jobtracker.settings import ConfigError, Settings, set_dotenv_values
from tests.fakes import MemoryRepo

ACCOUNT = "calendar-reader@test-project.iam.gserviceaccount.com"
OAUTH = {
    "client_id": "c",
    "client_secret": "s",
    "refresh_token": "r",
    "token_uri": "https://oauth2.googleapis.com/token",
}


@pytest.fixture(scope="module")
def key_info() -> dict:
    """A throwaway key: real RSA, so google-auth accepts it; no Google account behind it."""
    pem = (
        rsa.generate_private_key(public_exponent=65537, key_size=2048)
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )
    return {
        "type": "service_account",
        "project_id": "test-project",
        "private_key_id": "k1",
        "private_key": pem,
        "client_email": ACCOUNT,
        "client_id": "1",
        "token_uri": "https://oauth2.googleapis.com/token",
    }


# --- the key setting -----------------------------------------------------------------------


def test_key_round_trips_as_one_line_and_raw_json_is_accepted(key_info):
    encoded = encode_service_account_key(key_info)
    assert "\n" not in encoded and '"' not in encoded and "$" not in encoded
    assert decode_service_account_key(encoded) == key_info
    assert decode_service_account_key(json.dumps(key_info, indent=2)) == key_info


@pytest.mark.parametrize(
    "value, message",
    [
        ("not base64 at all!", "not a service account key"),
        (base64.b64encode(b"[1, 2]").decode(), "type=service_account"),
        (json.dumps({"type": "authorized_user"}), "type=service_account"),
        (json.dumps({"type": "service_account", "client_email": "x"}), "private_key, token_uri"),
    ],
)
def test_bad_keys_are_rejected(value, message):
    with pytest.raises(ValueError, match=message):
        decode_service_account_key(value)


def test_service_account_needs_a_real_calendar_id_and_never_shows_in_repr():
    with pytest.raises(ConfigError, match="GOOGLE_CALENDAR_ID"):
        Settings.from_env({"GOOGLE_SERVICE_ACCOUNT_KEY": "abc"})
    s = Settings.from_env(
        {"GOOGLE_SERVICE_ACCOUNT_KEY": "secret-key", "GOOGLE_CALENDAR_ID": "me@example.com"}
    )
    assert s.google_service_account_key == "secret-key"
    assert "secret-key" not in repr(s)


def test_dotenv_values_replace_append_and_lock_the_file(tmp_path):
    env = tmp_path / ".env"
    env.write_text(
        "# GOOGLE_CALENDAR_ID=primary\nGMAIL_ADDRESS=me@example.com\nGOOGLE_CALENDAR_ID=primary\n"
        "GOOGLE_CALENDAR_ID=dupe\n"
    )
    env.chmod(0o644)
    set_dotenv_values(
        env, {"GOOGLE_CALENDAR_ID": "me@example.com", "GOOGLE_SERVICE_ACCOUNT_KEY": "k"}
    )
    assert env.read_text().splitlines() == [
        "# GOOGLE_CALENDAR_ID=primary",
        "GMAIL_ADDRESS=me@example.com",
        "GOOGLE_CALENDAR_ID=me@example.com",
        "GOOGLE_SERVICE_ACCOUNT_KEY=k",
    ]
    assert env.stat().st_mode & 0o777 == 0o600


# --- which source -------------------------------------------------------------------------


def test_service_account_wins_over_a_stored_login(key_info):
    assert make_source("", "primary", None) is None
    assert make_source("", "primary", OAUTH).auth == "oauth"
    sa = make_source(encode_service_account_key(key_info), "me@example.com", OAUTH)
    assert (sa.auth, sa.calendar_id) == ("service_account", "me@example.com")


# --- errors from Google -------------------------------------------------------------------


class Response:
    def __init__(self, status: int, body: dict | None = None):
        self.status_code, self._body = status, body or {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class Session:
    def __init__(self, *responses):
        self.responses = list(responses)

    def get(self, url, params=None):
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def source(key_info, *responses, auth="service_account"):
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_info(key_info)
    return GoogleCalendarSource(creds, "me@example.com", auth=auth, session=Session(*responses))


def test_calendar_not_shared_names_the_account_to_share_with(key_info):
    with pytest.raises(CalendarAuthError, match=f"not shared with {ACCOUNT}"):
        source(key_info, Response(404)).calendar_name()


def test_rejected_key_and_expired_login_say_what_to_do(key_info):
    from google.auth.exceptions import RefreshError

    with pytest.raises(CalendarAuthError, match="use-service-account"):
        source(key_info, RefreshError("invalid_grant")).fetch_changes(None, datetime.now(UTC))
    with pytest.raises(CalendarAuthError, match="calendar login"):
        source(key_info, RefreshError("x"), auth="oauth").fetch_changes(None, datetime.now(UTC))
    with pytest.raises(CalendarAuthError, match="403"):
        source(key_info, Response(403)).fetch_changes("tok", datetime.now(UTC))


def test_reads_name_and_pages_and_keeps_410_for_a_full_sync(key_info):
    assert source(key_info, Response(200, {"summary": "Alexis"})).calendar_name() == "Alexis"
    page1 = {"items": [{"id": "e1", "summary": "Interview"}], "nextPageToken": "p2"}
    page2 = {"items": [{"id": "e2", "eventType": "focusTime"}], "nextSyncToken": "next"}
    changes = source(key_info, Response(200, page1), Response(200, page2)).fetch_changes(
        None, datetime.now(UTC)
    )
    assert [i.calendar_event_id for i in changes.items] == ["e1"]
    assert changes.next_sync_token == "next"
    with pytest.raises(CalendarSyncExpired):
        source(key_info, Response(410)).fetch_changes("old", datetime.now(UTC))


# --- switching calendar ID ----------------------------------------------------------------


def test_rename_calendar_moves_interviews_and_drops_the_old_token():
    repo = MemoryRepo()
    now = datetime(2026, 11, 3, tzinfo=UTC)
    iv = Interview(
        source=InterviewSource.CALENDAR,
        status=InterviewStatus.SCHEDULED,
        starts_at=now,
        calendar_id="primary",
        calendar_event_id="e1",
        created_at=now,
        updated_at=now,
    )
    repo.save_interview(iv)
    repo.set_calendar_sync("primary", "tok")
    assert repo.rename_calendar("primary", "me@example.com") == 1
    assert repo.get_interview_by_calendar_event("me@example.com", "e1").id == iv.id
    assert repo.get_calendar_sync("primary") is None


def test_status_says_which_login_is_used(key_info):
    settings = Settings.from_env(
        {
            "APP_ENV": "local",
            "AUTH_DEV_BYPASS": "true",
            "GOOGLE_SERVICE_ACCOUNT_KEY": encode_service_account_key(key_info),
            "GOOGLE_CALENDAR_ID": "me@example.com",
        }
    )
    repo = MemoryRepo()
    client = TestClient(create_app(settings, repo_factory=lambda: repo))
    body = client.get("/api/calendar").json()
    assert (body["connected"], body["auth"], body["calendar_id"]) == (
        True,
        "service_account",
        "me@example.com",
    )


def test_use_service_account_checks_access_saves_and_moves_interviews(
    key_info, tmp_path, monkeypatch
):
    from typer.testing import CliRunner

    from jobtracker.cli import main

    (tmp_path / ".env").write_text("GMAIL_ADDRESS=me@example.com\n")
    key_file = tmp_path / "key.json"
    key_file.write_text(json.dumps(key_info))
    monkeypatch.chdir(tmp_path)
    repo = MemoryRepo()
    now = datetime(2026, 11, 3, tzinfo=UTC)
    iv = Interview(starts_at=now, source=InterviewSource.CALENDAR, calendar_id="primary")
    iv.calendar_event_id = "e1"
    repo.save_interview(iv)
    settings = Settings.from_env({"GMAIL_ADDRESS": "me@example.com"})
    monkeypatch.setattr(main, "_settings", lambda: settings)
    monkeypatch.setattr(main, "_repo", lambda _s: repo)
    checked = []
    monkeypatch.setattr(
        GoogleCalendarSource, "calendar_name", lambda self: checked.append(self) or "Me"
    )

    result = CliRunner().invoke(main.app, ["calendar", "use-service-account", str(key_file)])
    assert result.exit_code == 0, result.output
    assert checked[0].calendar_id == "me@example.com" and checked[0].auth == "service_account"
    env = Settings.from_env(
        dict(line.split("=", 1) for line in (tmp_path / ".env").read_text().splitlines())
    )
    assert env.google_calendar_id == "me@example.com"
    assert decode_service_account_key(env.google_service_account_key) == key_info
    assert repo.get_interview_by_calendar_event("me@example.com", "e1") is not None
    assert "1 synced interview(s) moved" in result.output and f"rm {key_file}" in result.output


def test_use_service_account_saves_nothing_when_the_calendar_isnt_shared(
    key_info, tmp_path, monkeypatch
):
    from typer.testing import CliRunner

    from jobtracker.cli import main

    (tmp_path / ".env").write_text("GMAIL_ADDRESS=me@example.com\n")
    key_file = tmp_path / "key.json"
    key_file.write_text(json.dumps(key_info))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(main, "_settings", lambda: Settings.from_env({"GMAIL_ADDRESS": "m@e.com"}))

    def not_shared(self):
        raise CalendarAuthError("not shared")

    monkeypatch.setattr(GoogleCalendarSource, "calendar_name", not_shared)
    result = CliRunner().invoke(main.app, ["calendar", "use-service-account", str(key_file)])
    assert result.exit_code == 1
    assert (tmp_path / ".env").read_text() == "GMAIL_ADDRESS=me@example.com\n"
