from jobtracker.core.email_parse import clean_body, snippet, strip_quoted
from tests.conftest import load


def test_parses_headers_and_body():
    m = load("ashby_received.eml", uid=7, thread="t1")
    assert m.message_id == "<ashby-received-1@ashbyhq.com>"
    assert m.from_address == "no-reply@ashbyhq.com"
    assert m.from_name == "Northwind Hiring Team"
    assert m.from_domain == "ashbyhq.com"
    assert m.uid == 7 and m.gm_thread_id == "t1"
    assert "Senior Backend Engineer" in m.text
    assert m.received_at.tzinfo is not None


def test_encoded_headers_and_spanish_body():
    m = load("recruiter_es.eml")
    assert m.from_name == "María López"
    assert "¿Te interesaría" in m.text


def test_html_only_body_is_converted_without_css():
    m = load("workable_rejection_es_html.eml")
    assert "Lamentablemente" in m.text
    assert "color:red" not in m.text


def test_calendar_parts_extracted():
    m = load("greenhouse_interview_ics.eml")
    assert len(m.calendar_parts) == 1
    assert b"BEGIN:VCALENDAR" in m.calendar_parts[0]
    assert "invite.ics" in m.attachment_names


def test_reply_threading_headers():
    m = load("own_reply.eml")
    assert m.in_reply_to == "<jane-1@northwind.test>"
    assert m.references == ["<jane-1@northwind.test>"]


def test_list_unsubscribe_flag():
    assert load("linkedin_alert.eml").list_unsubscribe
    assert not load("personal.eml").list_unsubscribe


def test_missing_message_id_gets_stable_synthetic_id():
    from jobtracker.core.email_parse import parse_email

    raw = b"From: a@b.test\nSubject: hi\n\nbody"
    assert parse_email(raw).message_id == parse_email(raw).message_id


def test_strip_quoted_and_truncate():
    text = "New reply here, long enough to keep the header check happy.\n\nOn Fri, Oct 9, 2026 at 1:00 PM Jane wrote:\n> old"
    assert "old" not in strip_quoted(text)
    assert len(clean_body("x" * 10_000, 4000)) == 4000
    assert snippet("a\n\n  b") == "a b"
