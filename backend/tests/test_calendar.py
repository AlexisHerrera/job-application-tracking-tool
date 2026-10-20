from datetime import UTC, datetime

from jobtracker.core.calendar import first_interview, parse_ics
from tests.conftest import TZ, load

ICS_LOCAL = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20261110T110000
SUMMARY:Floating time
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261111
SUMMARY:All day
END:VEVENT
END:VCALENDAR
"""


def test_parses_utc_start():
    m = load("greenhouse_interview_ics.eml")
    ev = first_interview(m.calendar_parts, TZ)
    assert ev.start == datetime(2026, 11, 5, 15, 0, tzinfo=UTC)
    assert ev.method == "REQUEST"
    assert ev.organizer == "recruiting@contoso.test"
    assert ev.uid == "interview-1@contoso.test"


def test_floating_time_uses_default_tz_and_all_day_is_skipped():
    events = parse_ics(ICS_LOCAL, TZ)
    assert len(events) == 1
    assert events[0].start == datetime(2026, 11, 10, 14, 0, tzinfo=UTC)  # 11:00 ART = 14:00 UTC


def test_garbage_is_ignored():
    assert parse_ics(b"not a calendar", TZ) == []
