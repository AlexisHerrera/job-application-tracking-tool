from datetime import timedelta

from jobtracker.cli.seed import seed
from jobtracker.core import stats
from jobtracker.core.clock import FixedClock
from tests.conftest import TZ


def test_stats_on_seed_data(repo, clock):
    seed(repo, clock, TZ)
    s = stats.summary(repo.list_applications(), repo.list_all_events(), clock.now(), 14, 7)
    assert s["total"] == 7
    funnel = {r["stage"]: r["count"] for r in s["funnel"]}
    assert funnel["applied"] == 7 and funnel["interviewing"] >= 3
    rejected = {r["stage"]: r["count"] for r in s["rejection_stages"]}
    assert rejected["applied"] == 1 and rejected["interviewing"] == 1
    assert s["upcoming_interviews"][0]["company"] == "Acme Robotics"
    assert s["follow_ups"]["needs_reply"]
    assert s["time_to_first_response"]["count"] >= 3
    assert s["needs_review"] == 1
    assert "ghosted" in s["by_status"]  # Initech: 40 days of silence


def test_ghosted_clears_when_news_arrives(repo, clock):
    seed(repo, clock, TZ)
    later = FixedClock(clock.now() + timedelta(days=60))
    s = stats.summary(repo.list_applications(), repo.list_all_events(), later.now(), 14, 7)
    assert s["by_status"].get("ghosted", 0) >= 4
