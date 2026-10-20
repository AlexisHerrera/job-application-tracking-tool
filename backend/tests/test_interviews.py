from datetime import UTC, datetime, timedelta

from jobtracker.adapters.google_calendar import parse_event
from jobtracker.core import interviews, services
from jobtracker.core.models import (
    CalendarItem,
    Event,
    EventKind,
    EventType,
    InterviewNote,
    InterviewSource,
    InterviewStatus,
    MatchMethod,
)
from tests.conftest import ME
from tests.fakes import FakeCalendar

NOW = datetime(2026, 10, 12, 12, 0, tzinfo=UTC)
SINCE = NOW - timedelta(days=60)


def _app(repo, clock, company="Northwind", role="Backend Engineer", domain="northwind.test"):
    return services.create_application(
        repo,
        clock,
        services.ApplicationInput(
            company=company,
            role_title=role,
            company_domain=domain,
            applied_at=NOW - timedelta(days=30),
        ),
    )


def _item(event_id="ev1", start=NOW + timedelta(days=2), **kw):
    return CalendarItem(
        calendar_event_id=event_id,
        status=kw.pop("status", "confirmed"),
        title=kw.pop("title", "Chat"),
        start=start,
        end=start + timedelta(hours=1) if start else None,
        **kw,
    )


def _invite(
    repo,
    app_id,
    at,
    *,
    event_type=EventType.INTERVIEW_SCHEDULED,
    occurred=NOW,
    thread=None,
    uid=None,
):
    e = Event(
        kind=EventKind.EMAIL,
        event_type=event_type,
        occurred_at=occurred,
        application_id=app_id,
        interview_at=at,
        subject="Interview with Northwind",
        gm_thread_id=thread,
        ical_uid=uid,
        match_method=MatchMethod.ALIAS,
        assigned_by="auto",
    )
    repo.add_event(e)
    return e


def _sync(repo, clock, *items):
    cal = FakeCalendar(items, items)
    return services.sync_calendar(repo, clock, cal, SINCE, {ME}), cal


def test_attendee_domain_matches_and_sets_next_interview(repo, clock):
    a = _app(repo, clock)
    report, _ = _sync(repo, clock, _item(attendees=[ME, "jane@northwind.test"]))
    assert (report.created, report.unassigned) == (1, 0)
    [iv] = repo.list_interviews(a.id)
    assert iv.source == InterviewSource.CALENDAR and iv.match_method == MatchMethod.ALIAS
    assert repo.get_application(a.id).next_interview_at == NOW + timedelta(days=2)


def test_title_names_the_company(repo, clock):
    a = _app(repo, clock, company="Sluicebox", domain=None)
    _sync(repo, clock, _item(title="Technical interview - Sluicebox"))
    [iv] = repo.list_interviews(a.id)
    assert iv.match_method == MatchMethod.FUZZY and iv.interview_type == "technical"


def test_personal_events_are_never_stored(repo, clock):
    _app(repo, clock)
    report, _ = _sync(
        repo,
        clock,
        _item("dentist", title="Dentist", attendees=[ME, "friend@gmail.com"]),
        _item("holiday", start=None, title="Holiday"),
    )
    assert report.skipped == 2 and repo.interviews == {}


def test_interview_like_event_without_company_goes_to_review(repo, clock):
    _app(repo, clock)
    report, _ = _sync(
        repo, clock, _item(title="Entrevista con Contoso", attendees=["x@contoso.test"])
    )
    assert report.unassigned == 1
    [iv] = repo.list_unassigned_interviews()
    assert iv.application_id is None


def test_calendar_event_takes_over_the_invite_email_interview(repo, clock):
    a = _app(repo, clock, domain=None)
    at = NOW + timedelta(days=3)
    _invite(repo, a.id, at)
    services.recompute(repo, clock, a.id)
    [from_email] = repo.list_interviews(a.id)
    assert from_email.source == InterviewSource.EMAIL
    repo.save_note(InterviewNote(application_id=a.id, interview_id=from_email.id, body="prep"))

    # The calendar event is at the same time but names nothing we know: the invite time links it.
    _sync(
        repo, clock, _item(start=at + timedelta(minutes=5), title="Call", attendees=["r@ats.test"])
    )
    [iv] = repo.list_interviews(a.id)
    assert iv.id == from_email.id  # same row, so the note is still attached
    assert iv.source == InterviewSource.CALENDAR and iv.match_method == MatchMethod.INVITE
    assert iv.calendar_event_id == "ev1"

    services.recompute(repo, clock, a.id)  # the email doesn't spawn a second interview
    assert len(repo.list_interviews(a.id)) == 1


def test_reschedule_email_cancels_the_old_time(repo, clock):
    a = _app(repo, clock, domain=None)
    first, second = NOW + timedelta(days=2), NOW + timedelta(days=5)
    _invite(repo, a.id, first, occurred=NOW - timedelta(days=1), thread="t1")
    services.recompute(repo, clock, a.id)
    _invite(repo, a.id, second, event_type=EventType.INTERVIEW_RESCHEDULED, thread="t1")
    services.recompute(repo, clock, a.id)
    by_time = {iv.starts_at: iv.status for iv in repo.list_interviews(a.id)}
    assert by_time == {first: InterviewStatus.CANCELLED, second: InterviewStatus.SCHEDULED}
    assert repo.get_application(a.id).next_interview_at == second


def test_cancelled_and_declined_events(repo, clock):
    a = _app(repo, clock)
    item = _item(attendees=["jane@northwind.test"])
    _, cal = _sync(repo, clock, item)
    cal.changes = [CalendarItem("ev1", "cancelled")]
    services.sync_calendar(repo, clock, cal, SINCE, {ME})
    [iv] = repo.list_interviews(a.id)
    assert iv.status == InterviewStatus.CANCELLED
    assert repo.get_application(a.id).next_interview_at is None
    assert cal.calls == [None, "token-1"]  # second run was incremental

    declined = _item("ev2", attendees=["jane@northwind.test"], declined=True)
    report, _ = _sync(repo, clock, declined)
    assert report.created == 0


def test_expired_sync_token_falls_back_to_full_sync(repo, clock):
    _app(repo, clock)
    cal = FakeCalendar([_item(attendees=["jane@northwind.test"])])
    services.sync_calendar(repo, clock, cal, SINCE, {ME})
    cal.expired = True
    report = services.sync_calendar(repo, clock, cal, SINCE, {ME})
    assert report.full_sync and cal.calls == [None, "token-1", None]
    assert len(repo.list_interviews()) == 1  # re-reading the same event updates it in place


def test_manual_assignment_teaches_the_attendee_domain(repo, clock):
    a = _app(repo, clock, company="Contoso", domain=None)
    _sync(repo, clock, _item(title="Interview", attendees=[ME, "ana@contoso-hr.test"]))
    [iv] = repo.list_unassigned_interviews()
    services.assign_interview(repo, clock, iv.id, a.id, {ME})
    assert "contoso-hr.test" in repo.company_domains()

    _sync(repo, clock, _item("ev2", title="Round 2", attendees=["bob@contoso-hr.test"]))
    assert len(repo.list_interviews(a.id)) == 2


def test_delete_application_sends_calendar_interviews_back_to_review(repo, clock):
    a = _app(repo, clock)
    _sync(repo, clock, _item(attendees=["jane@northwind.test"]))
    services.add_interview(repo, clock, a.id, {"starts_at": NOW - timedelta(days=1)})
    services.delete_application(repo, clock, a.id)
    [iv] = repo.list_interviews()
    assert iv.application_id is None and iv.source == InterviewSource.CALENDAR


def test_remove_interview_dismisses_synced_ones(repo, clock):
    a = _app(repo, clock)
    _sync(repo, clock, _item(attendees=["jane@northwind.test"]))
    [iv] = repo.list_interviews(a.id)
    services.remove_interview(repo, clock, iv.id)
    assert repo.get_interview(iv.id).dismissed
    _sync(repo, clock, _item(attendees=["jane@northwind.test"]))  # a resync doesn't revive it
    assert repo.get_interview(iv.id).dismissed


def test_past_interview_counts_as_news(repo, clock):
    a = _app(repo, clock)
    services.add_interview(repo, clock, a.id, {"starts_at": NOW - timedelta(days=1)})
    app = repo.get_application(a.id)
    assert app.last_event_at == NOW - timedelta(days=1)
    assert interviews.counts(repo.list_interviews(), {a.id}, NOW) == {"done": 1, "upcoming": 0}
    assert [iv.id for iv in interviews.recent(repo.list_interviews(), NOW)] == [
        repo.list_interviews(a.id)[0].id
    ]


def test_parse_google_event():
    item = parse_event(
        {
            "id": "abc",
            "status": "confirmed",
            "summary": "Interview",
            "start": {"dateTime": "2026-10-14T15:00:00-03:00"},
            "end": {"dateTime": "2026-10-14T16:00:00-03:00"},
            "organizer": {"email": "jane@northwind.test"},
            "attendees": [
                {"email": ME, "self": True, "responseStatus": "declined"},
                {"email": "room@resource.calendar.google.com", "resource": True},
                {"email": "jane@northwind.test"},
            ],
            "hangoutLink": "https://meet.google.com/x",
        }
    )
    assert item.start == datetime(2026, 10, 14, 18, 0, tzinfo=UTC)
    assert item.attendees == [ME, "jane@northwind.test"]
    assert item.declined and item.meeting_url == "https://meet.google.com/x"
    assert parse_event({"id": "d", "start": {"date": "2026-10-14"}}).start is None
    assert parse_event({"id": "w", "eventType": "workingLocation"}) is None


def test_invite_uid_links_a_moved_calendar_event(repo, clock):
    """The HomeVision case: the email said the 12th, the event was moved to the 8th."""
    a = _app(repo, clock, domain=None)
    emailed, moved = NOW + timedelta(days=6), NOW + timedelta(days=2)
    _invite(repo, a.id, emailed, uid="abc@google.com")
    services.recompute(repo, clock, a.id)
    [from_email] = repo.list_interviews(a.id)
    repo.save_note(InterviewNote(application_id=a.id, interview_id=from_email.id, body="prep"))

    _sync(repo, clock, _item(start=moved, title="Interview", ical_uid="abc@google.com"))
    [iv] = repo.list_interviews(a.id)
    assert iv.id == from_email.id and iv.starts_at == moved
    assert iv.match_method == MatchMethod.INVITE
    services.recompute(repo, clock, a.id)  # the email's old time doesn't come back
    assert [x.starts_at for x in repo.list_interviews(a.id)] == [moved]


def test_updated_and_cancelled_invites_by_uid(repo, clock):
    a = _app(repo, clock, domain=None)
    first, second = NOW + timedelta(days=2), NOW + timedelta(days=4)
    _invite(repo, a.id, first, occurred=NOW - timedelta(hours=3), uid="u1")
    _invite(repo, a.id, second, occurred=NOW - timedelta(hours=2), uid="u1")  # "Updated invitation"
    services.recompute(repo, clock, a.id)
    [iv] = repo.list_interviews(a.id)
    assert iv.starts_at == second and iv.status == InterviewStatus.SCHEDULED

    _invite(repo, a.id, None, event_type=EventType.INTERVIEW_RESCHEDULED, uid="u1")  # METHOD:CANCEL
    services.recompute(repo, clock, a.id)
    [iv] = repo.list_interviews(a.id)
    assert iv.status == InterviewStatus.CANCELLED
    assert repo.get_application(a.id).next_interview_at is None


def test_general_talk_has_no_application(repo, clock):
    _app(repo, clock)
    _sync(
        repo,
        clock,
        _item(start=NOW - timedelta(days=1), title="Interview", attendees=["r@agency.test"]),
    )
    [iv] = repo.list_unassigned_interviews()
    services.mark_general(repo, clock, iv.id)
    assert repo.list_unassigned_interviews() == []
    services.update_interview(repo, clock, repo.get_interview(iv.id), {"notes": "Roles at A and B"})
    ivs = repo.list_interviews()
    assert [x.id for x in interviews.recent(ivs, NOW)] == [iv.id]
    assert interviews.notes_by_interview([], ivs) == {iv.id: 1}
    assert interviews.counts(ivs, {a.id for a in repo.list_applications()}, NOW)["done"] == 0
    _sync(
        repo,
        clock,
        _item(start=NOW - timedelta(days=1), title="Interview", attendees=["r@agency.test"]),
    )
    assert repo.get_interview(iv.id).general  # a resync doesn't put it back in the queue


def test_inline_notes_are_only_for_general_talks(repo, clock):
    import pytest

    a = _app(repo, clock)
    iv = services.add_interview(repo, clock, a.id, {"starts_at": NOW})
    with pytest.raises(services.InvalidInput):
        services.update_interview(repo, clock, iv, {"notes": "x"})
