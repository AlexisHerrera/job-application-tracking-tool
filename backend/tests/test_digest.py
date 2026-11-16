"""The daily discovery digest (core/digest) and the progress row a Lambda run writes
(core/discovery_progress), on the in-memory repo."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from jobtracker.core import digest, discovery, discovery_progress
from jobtracker.core.clock import FixedClock
from jobtracker.core.models import DiscoveryRun, DiscoverySearch, PostingStatus
from tests.fakes import FakeLLM, FakeSource, MemoryRepo, posting, verdict

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
TZ = ZoneInfo("America/Buenos_Aires")


class FakeMailer:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, subject, text, html):
        self.sent.append((subject, text, html))


def scored(repo, company, verdict_, score, *, fetched=NOW - timedelta(hours=3), **kw):
    p = discovery.prepare(posting(company=company, source_id=company, **kw), fetched)
    discovery.apply_verdict(p, discovery.parse_verdict(verdict(verdict=verdict_, score=score, reasons=[f"{company} fits"])), "m", fetched)  # fmt: skip
    repo.add_posting(p)
    return p


def test_digest_lists_matches_then_maybes_and_sends_each_posting_once():
    repo, mailer = MemoryRepo(), FakeMailer()
    scored(repo, "Maybe Co", "maybe", 70)
    scored(repo, "Northwind Pay", "match", 88, url="https://jobs.example.test/nw")
    scored(repo, "Nope Inc", "no", 20)
    scored(repo, "Old Co", "match", 95, fetched=NOW - timedelta(days=8))
    scored(repo, "Seen Co", "match", 90, status=PostingStatus.DISMISSED)
    hidden = scored(repo, "Hidden Co", "match", 90)
    hidden.drop_reason = "agency"
    repo.update_posting(hidden)
    repo.save_run(DiscoveryRun(started_at=NOW - timedelta(hours=6), trigger="schedule", new=12, dropped=7, llm_calls=5))  # fmt: skip

    result = digest.send(repo, mailer, FixedClock(NOW), TZ, "https://jobs.example.test")
    assert result == {"sent": True, "postings": 2, "subject": "Discover: 1 match and 1 maybe (Tue 17 Nov)"}  # fmt: skip
    _, text, html = mailer.sent[0]
    assert text.index("Northwind Pay") < text.index("Maybe Co")
    assert "1 run: 12 new postings, 7 hidden by the rules, 5 scored." in text
    assert "Northwind Pay fits" in text and "https://jobs.example.test/discover" in text
    assert '<a href="https://jobs.example.test/nw"' in html

    # The next day: nothing new, nothing sent. A new match goes out alone.
    later = FixedClock(NOW + timedelta(days=1))
    assert digest.send(repo, mailer, later, TZ, "")["sent"] is False and len(mailer.sent) == 1
    scored(repo, "Contoso", "match", 80, fetched=NOW + timedelta(hours=20))
    assert digest.send(repo, mailer, later, TZ, "")["postings"] == 1
    assert "Contoso" in mailer.sent[1][1] and "Northwind" not in mailer.sent[1][1]


def test_the_first_digest_skips_the_backlog():
    repo = MemoryRepo()
    scored(repo, "Backlog Co", "match", 90, fetched=NOW - timedelta(days=3))
    assert digest.send(repo, FakeMailer(), FixedClock(NOW), TZ, "")["sent"] is False
    repo.set_discovery_setting(digest.KEY, {"sent_at": (NOW - timedelta(days=1)).isoformat(), "sent": {}})  # fmt: skip
    assert digest.send(repo, FakeMailer(), FixedClock(NOW), TZ, "")["postings"] == 1


def test_digest_escapes_web_text_and_drops_odd_links():
    repo, mailer = MemoryRepo(), FakeMailer()
    scored(repo, "<script>alert(1)</script>", "match", 90, url="javascript:alert(1)")
    digest.send(repo, mailer, FixedClock(NOW), TZ, "")
    html = mailer.sent[0][2]
    assert "<script>" not in html and "&lt;script&gt;" in html and "javascript:" not in html


def test_preview_marks_nothing_as_sent():
    repo = MemoryRepo()
    scored(repo, "Northwind Pay", "match", 88)
    preview = digest.send(repo, None, FixedClock(NOW), TZ, "")
    assert preview["sent"] is False and preview["digest"].postings[0].company == "Northwind Pay"
    assert digest.unsent(repo, NOW) and repo.get_discovery_setting(digest.KEY) is None


def test_progress_row_follows_a_run_and_goes_stale():
    repo = MemoryRepo()
    repo.save_search(DiscoverySearch("workable", "w", {"query": "x"}))
    clock = FixedClock(NOW)
    writer = discovery_progress.ProgressWriter(repo, clock)
    seen = []
    discovery.run_discovery(repo, {"workable": FakeSource([posting()])}, FakeLLM(), clock, on_progress=lambda p: (writer(p), seen.append(discovery_progress.load(repo, NOW))))  # fmt: skip
    assert seen[0].phase == "collecting"  # the first report is written; the next ones throttled
    done = discovery_progress.load(repo, NOW)
    assert done.phase == "done" and done.scored == 1 and done.new == 1
    assert not discovery_progress.running(repo, NOW)

    started = discovery.Progress("run", NOW, phase_started_at=NOW)
    discovery_progress.save(repo, started, NOW)
    assert discovery_progress.running(repo, NOW + timedelta(minutes=2))
    stale = discovery_progress.load(repo, NOW + timedelta(minutes=4))
    assert stale.phase == "done" and stale.finished_at == NOW  # a run that died


def test_scoring_stops_at_the_deadline():
    repo = MemoryRepo()
    for i in range(10):
        repo.add_posting(discovery.prepare(posting(source_id=str(i), company=f"Co {i}"), NOW))
    result = discovery.run_discovery(
        repo, {}, FakeLLM(), FixedClock(NOW), collect=False, deadline=NOW
    )
    assert result.run.llm_calls < 10
    assert any("time limit" in n for n in result.run.notes)
