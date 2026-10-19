"""Deterministic .ics parsing. Interview times from calendar data always beat the LLM."""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from icalendar import Calendar

from jobtracker.core.models import CalendarEvent

log = logging.getLogger(__name__)


def _to_utc(value: datetime | date, default_tz: ZoneInfo) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=default_tz)
        return value.astimezone(UTC)
    return None  # all-day events carry no interview time


def parse_ics(data: bytes, default_tz: ZoneInfo) -> list[CalendarEvent]:
    try:
        cal = Calendar.from_ical(data)
    except ValueError:
        log.warning("unparseable calendar part")
        return []
    method = str(cal.get("METHOD")) if cal.get("METHOD") else None
    out: list[CalendarEvent] = []
    for comp in cal.walk("VEVENT"):
        dtstart = comp.get("DTSTART")
        if dtstart is None:
            continue
        start = _to_utc(dtstart.dt, default_tz)
        if start is None:
            continue
        dtend = comp.get("DTEND")
        organizer = comp.get("ORGANIZER")
        out.append(
            CalendarEvent(
                start=start,
                end=_to_utc(dtend.dt, default_tz) if dtend is not None else None,
                summary=str(comp.get("SUMMARY", "")),
                organizer=str(organizer).removeprefix("mailto:").removeprefix("MAILTO:")
                if organizer
                else None,
                method=method,
                location=str(comp.get("LOCATION")) if comp.get("LOCATION") else None,
            )
        )
    return out


def first_interview(parts: list[bytes], default_tz: ZoneInfo) -> CalendarEvent | None:
    events = [ev for p in parts for ev in parse_ics(p, default_tz)]
    events = [ev for ev in events if (ev.method or "").upper() != "CANCEL"] or events
    return min(events, key=lambda e: e.start) if events else None
