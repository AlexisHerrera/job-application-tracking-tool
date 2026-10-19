from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from jobtracker.api.app import create_app
from jobtracker.core import campaigns, services
from jobtracker.core.clock import FixedClock
from jobtracker.core.models import Campaign, Event, EventKind, EventType
from jobtracker.settings import Settings
from tests.conftest import TZ
from tests.fakes import MemoryRepo

NOW = datetime(2026, 10, 19, 15, 0, tzinfo=UTC)


def _app(repo, clock, company, applied: date):
    at = datetime(applied.year, applied.month, applied.day, 12, tzinfo=TZ).astimezone(UTC)
    return services.create_application(
        repo, clock, services.ApplicationInput(company=company, role_title="SWE", applied_at=at)
    )


def test_membership_by_applied_local_date():
    c = Campaign(name="Sep 2026", started_on=date(2026, 9, 15))
    # 2026-09-15 01:00 UTC is still Sep 14 in Buenos Aires.
    assert campaigns.local_date(datetime(2026, 9, 15, 1, tzinfo=UTC), TZ) == date(2026, 9, 14)
    assert not campaigns.contains(c, date(2026, 9, 14))
    assert campaigns.contains(c, date(2026, 9, 15))
    assert campaigns.contains(c, date(2030, 1, 1))  # ongoing


def test_overlaps_are_rejected_and_close_previous(repo):
    clock = FixedClock(NOW)
    first = campaigns.save(repo, clock, Campaign(name="Sep 2026", started_on=date(2026, 9, 15)))
    with pytest.raises(campaigns.CampaignError):
        campaigns.save(repo, clock, Campaign(name="Overlap", started_on=date(2026, 10, 1)))
    campaigns.save(
        repo, clock, Campaign(name="Next", started_on=date(2027, 3, 1)), close_previous=True
    )
    assert repo.get_campaign(first.id).ended_on == date(2027, 2, 28)
    with pytest.raises(campaigns.CampaignError):
        campaigns.save(
            repo,
            clock,
            Campaign(name="Bad", started_on=date(2027, 5, 1), ended_on=date(2027, 4, 1)),
        )


def test_summary_counts_days_to_first_interview(repo):
    clock = FixedClock(NOW)
    c = campaigns.save(repo, clock, Campaign(name="Sep 2026", started_on=date(2026, 9, 15)))
    a = _app(repo, clock, "Northwind", date(2026, 9, 15))
    _app(repo, clock, "Contoso", date(2026, 9, 18))
    _app(repo, clock, "Old Co", date(2026, 8, 1))  # before the campaign
    repo.add_event(Event(kind=EventKind.EMAIL, event_type=EventType.INTERVIEW_SCHEDULED, application_id=a.id,
                         occurred_at=datetime(2026, 9, 18, 15, tzinfo=UTC),
                         interview_at=datetime(2026, 9, 21, 15, tzinfo=UTC)))  # fmt: skip
    s = campaigns.summary(
        c, repo.list_applications(), repo.list_all_events(), date(2026, 10, 19), TZ
    )
    assert s["applications"] == 2
    assert s["day"] == 35
    assert s["first_interview_on"] == "2026-09-21"
    assert s["days_to_first_interview"] == 7
    assert s["first_response_on"] == "2026-09-18"


def test_api_scopes_lists_and_stats():
    repo = MemoryRepo()
    settings = Settings.from_env({"APP_ENV": "local", "AUTH_DEV_BYPASS": "true"})
    client = TestClient(create_app(settings, repo_factory=lambda: repo))
    clock = FixedClock(NOW)
    _app(repo, clock, "Old Co", date(2026, 8, 1))
    _app(repo, clock, "Northwind", date(2026, 9, 20))

    r = client.post("/api/campaigns", json={"name": "Sep 2026", "started_on": "2026-09-15"})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    listing = client.get("/api/campaigns").json()
    assert listing["current_id"] == cid and listing["campaigns"][0]["applications"] == 1

    assert [
        a["company"] for a in client.get("/api/applications", params={"campaign": cid}).json()
    ] == ["Northwind"]
    assert len(client.get("/api/applications", params={"campaign": "all"}).json()) == 2
    assert client.get("/api/stats", params={"campaign": cid}).json()["total"] == 1
    assert client.get("/api/dashboard").json()["campaign"]["name"] == "Sep 2026"

    # Moving the start date re-sorts membership; no stored foreign key to fix up.
    client.patch(f"/api/campaigns/{cid}", json={"started_on": "2026-07-01"})
    assert len(client.get("/api/applications", params={"campaign": cid}).json()) == 2
    assert (
        client.post(
            "/api/campaigns",
            json={"name": "x", "started_on": "2026-08-01", "close_previous": False},
        ).status_code
        == 422
    )
    assert client.delete(f"/api/campaigns/{cid}").status_code == 204
    assert len(client.get("/api/applications").json()) == 2  # applications untouched


def test_seed_creates_sample_campaign(repo):
    from jobtracker.cli.seed import seed

    seed(repo, FixedClock(NOW), TZ)
    [c] = repo.list_campaigns()
    assert c.started_on == (NOW - timedelta(days=60)).astimezone(TZ).date()
