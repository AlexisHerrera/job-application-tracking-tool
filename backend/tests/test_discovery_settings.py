"""The Discover settings page (plan §21, round 6): criteria as fields, rule hit counts,
re-applying the rules, the watchlist table, on fakes."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from jobtracker.api.app import create_app
from jobtracker.core import criteria, discovery, discovery_settings
from jobtracker.core.clock import FixedClock
from jobtracker.core.discovery import Rules
from jobtracker.core.models import DiscoveryRun, PostingStatus, WatchedCompany
from jobtracker.settings import Settings
from tests.fakes import FakeBoards, MemoryRepo, posting

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=UTC)
YESTERDAY = NOW - timedelta(days=1)


def stored(repo, **overrides):
    p = discovery.prepare(posting(**overrides), NOW)
    repo.add_posting(p)
    return p


# --- criteria ---------------------------------------------------------------------------------


def test_the_default_profile_renders_to_the_default_criteria():
    assert criteria.render(criteria.DEFAULT_PROFILE) == discovery.DEFAULT_CRITERIA
    text = discovery.DEFAULT_CRITERIA
    assert "Candidate: lives in Buenos Aires, Argentina." in text
    assert 'up to 5 years of experience is fine; 6 or more years is a "no"' in text
    assert "anywhere in the Buenos Aires area" in text
    assert len(text) < criteria.CRITERIA_LIMIT
    again = criteria.Profile.from_dict(criteria.DEFAULT_PROFILE.to_dict())
    assert again == criteria.DEFAULT_PROFILE


def test_profile_from_dict_cleans_what_it_gets():
    p = criteria.Profile.from_dict(
        {
            "roles": ["  backend   engineer ", "Backend Engineer", "", 3, "x" * 500],
            "stack": "not a list",
            "max_years": 99.7,
            "salary_min_usd": -5,
            "home": "  Córdoba,   Argentina ",
            "notes": 42,
        }
    )
    assert p.roles == ["backend engineer", "x" * criteria.ENTRY_LIMIT]
    assert p.stack == [] and p.notes == ""
    assert p.max_years == 50 and p.salary_min_usd is None
    assert p.home == "Córdoba, Argentina"


def test_render_leaves_empty_fields_out():
    text = criteria.render(criteria.Profile(home="", stack=["Go"], salary_min_usd=50000))
    assert text == 'Stack: Go.\n\nSalary: at least USD 50,000 a year; less is a "no".\n'
    p = criteria.Profile(location_yes=["Uruguay"], location_notes="- Contractors fine\n\n")
    text = criteria.render(p)
    assert "can they hire someone living in Buenos Aires, Argentina?" in text
    assert "- yes: hires in Uruguay; remote, hybrid or onsite anywhere in the Buenos Aires area." in text  # fmt: skip
    assert "\n- Contractors fine" in text


def test_an_unsaved_profile_keeps_the_old_text_in_the_notes():
    repo = MemoryRepo()
    profile, saved = discovery_settings.load_profile(repo)
    assert not saved and profile == criteria.DEFAULT_PROFILE  # nothing saved: the defaults
    repo.set_discovery_setting("criteria", discovery.DEFAULT_CRITERIA)
    assert discovery_settings.load_profile(repo)[0].notes == criteria.DEFAULT_PROFILE.notes
    repo.set_discovery_setting("criteria", "  My own words.  ")
    profile, saved = discovery_settings.load_profile(repo)
    assert not saved and profile.notes == "My own words."
    assert profile.roles == criteria.DEFAULT_PROFILE.roles

    text = discovery_settings.save_profile(repo, {**profile.to_dict(), "notes": "Short."})
    assert repo.get_discovery_setting("criteria") == text and text.endswith("Short.\n")
    profile, saved = discovery_settings.load_profile(repo)
    assert saved and profile.notes == "Short."
    assert discovery.load_settings(repo)[0] == text  # scoring reads the rendered text

    with pytest.raises(ValueError, match="at most 6,000"):
        discovery_settings.save_profile(repo, {"background": "x" * 6000})
    assert discovery.load_settings(repo)[0] == text


# --- rule hits --------------------------------------------------------------------------------


def test_rule_hits_per_list_and_entry():
    repo = MemoryRepo()
    for reason, company, n in [
        ("title: java", "acme", 3), ("title: junior", "acme", 1), ("blocked", "spam co", 4),
        ("blocked", "spam co latam", 1), ("consultancy", "globant", 2),
        ("consultancy", "someone the llm caught", 5), ("location", "x", 6),
        ("location: brazil onsite", "y", 1), ("duplicate", "z", 2),
    ]:  # fmt: skip
        for _ in range(n):
            stored(repo, company=company, drop_reason=reason)
    stored(repo)  # visible: not counted
    rules = Rules(blocked=["Spam Co", "Nobody"], consultancies=["Globant"], title_exclude=["java", "php"])  # fmt: skip
    hits = discovery_settings.rule_hits(repo.drop_reason_counts(), rules)
    assert hits["reasons"]["location"] == 6 and hits["reasons"]["duplicate"] == 2
    lists = hits["lists"]
    assert lists["title_exclude"] == {"total": 3, "entries": {"java": 3, "php": 0}}
    assert lists["seniority_exclude"]["entries"]["junior"] == 1
    assert lists["blocked"] == {"total": 5, "entries": {"Spam Co": 5, "Nobody": 0}}
    assert lists["consultancies"] == {"total": 7, "entries": {"Globant": 2}}  # the LLM's too
    assert lists["location_allow"]["total"] == 7


# --- re-applying the rules --------------------------------------------------------------------


def test_saving_rules_hides_and_brings_back():
    repo = MemoryRepo()
    old = Rules(title_exclude=["java", "go"], consultancies=["Globant"], blocked=[])
    java = stored(repo, title="Java Engineer", drop_reason="title: java")
    golang = stored(repo, title="Go Java Engineer", drop_reason="title: go")
    rust = stored(repo, title="Rust Engineer")
    applied = stored(repo, title="Rust Platform Engineer", status=discovery.PostingStatus.APPLIED)  # fmt: skip
    globant = stored(repo, company="Globant", drop_reason="consultancy")
    caught = stored(repo, company="Other Shop", drop_reason="consultancy")  # hidden by the LLM

    new = Rules(title_exclude=["rust", "java"], consultancies=[], blocked=[])
    out = discovery_settings.reapply_rules(repo, old, new, NOW)
    assert out == {"hidden": 1, "restored": 1}
    reason = {p.id: p.drop_reason for p in repo.list_postings()}
    assert reason[java.id] == "title: java"  # still on the list: not checked
    assert reason[golang.id] == "title: java"  # "go" came off, but "java" still hides it
    assert reason[rust.id] == "title: rust"
    assert reason[applied.id] is None  # only new postings are hidden again
    assert reason[globant.id] is None  # came off the list: back
    assert reason[caught.id] == "consultancy"  # never on the list: stays hidden


def test_looser_rules_name_the_reasons_to_check():
    old = Rules(location_allow=["argentina"], max_age_days=21, salary_floor_usd=50000)
    same = discovery_settings.loosened(old, old)
    assert same == (set(), {})
    new = Rules(location_allow=["argentina", "uruguay"], max_age_days=30, salary_floor_usd=None)
    reasons, _ = discovery_settings.loosened(old, new)
    assert reasons == {"location", "location: brazil onsite", "old", "salary"}


def test_an_added_place_brings_back_postings_hidden_for_location():
    repo = MemoryRepo()
    old = Rules(location_allow=["argentina"])
    p = stored(repo, source="remoteyeah", location="Uruguay", drop_reason="location")
    out = discovery_settings.reapply_rules(repo, old, Rules(location_allow=["argentina", "uruguay"]), NOW)  # fmt: skip
    assert out == {"hidden": 0, "restored": 1}
    assert repo.get_posting(p.id).drop_reason is None


# --- watchlist --------------------------------------------------------------------------------


def watched(name, ats="ashby", **fields):
    return WatchedCompany(ats=ats, slug=name.replace(" ", ""), name=name, **fields)


def test_watchlist_query():
    rows = [
        watched("Acme", jobs_kept=3, last_checked_at=NOW, last_status="ok"),
        watched("Beta", ats="lever", enabled=False, last_status="gone", last_checked_at=NOW),
        watched("Gamma", ats="greenhouse", last_status="HTTP 500", last_checked_at=YESTERDAY),
        watched("Delta"),
    ]
    page, total, counts = discovery_settings.query_watched(rows)
    assert [c.name for c in page] == ["Acme", "Beta", "Delta", "Gamma"] and total == 4
    assert counts == {"on": 3, "off": 1, "gone": 1, "error": 1, "with_roles": 1, "unread": 1}
    assert [c.name for c in discovery_settings.query_watched(rows, status="error")[0]] == ["Gamma"]
    assert [c.name for c in discovery_settings.query_watched(rows, q="LTA")[0]] == ["Delta"]
    page, total, counts = discovery_settings.query_watched(rows, ats="ashby", sort="roles", limit=1)
    assert [c.name for c in page] == ["Acme"] and total == 2 and counts["on"] == 2
    checked = discovery_settings.query_watched(rows, sort="checked")[0]
    assert [c.name for c in checked] == ["Acme", "Beta", "Gamma", "Delta"]
    assert discovery_settings.board_url("lever", "RyzLabs") == "https://jobs.lever.co/RyzLabs"


# --- API --------------------------------------------------------------------------------------


@pytest.fixture
def repo():
    return MemoryRepo()


@pytest.fixture
def boards():
    job = posting(source="lever", source_id="RyzLabs:1", title="Backend Engineer")
    return FakeBoards({("lever", "RyzLabs"): [job]})


@pytest.fixture
def client(repo, boards):
    settings = Settings.from_env(
        {"APP_ENV": "local", "AUTH_DEV_BYPASS": "true", "ALLOWED_EMAIL": "me@example.com"}
    )
    app = create_app(settings, repo_factory=lambda: repo, discovery_factory=lambda: ({}, None),
                     boards_factory=lambda: boards)  # fmt: skip
    return TestClient(app)


def test_api_profile_preview_and_save(client, repo):
    state = client.get("/api/discover/settings").json()
    assert state["profile_saved"] is False and state["criteria_limit"] == 6000
    profile = {**state["profile"], "notes": "Fintech is a plus."}
    preview = client.post("/api/discover/criteria/preview", json={"profile": profile}).json()
    assert preview["text"].endswith("Fintech is a plus.\n") and preview["chars"] == len(preview["text"])  # fmt: skip
    saved = client.put("/api/discover/settings", json={"profile": profile, "criteria": "ignored"}).json()  # fmt: skip
    assert saved["profile_saved"] is True and saved["criteria"] == preview["text"]
    assert saved["reapplied"] is None
    too_long = client.put("/api/discover/settings", json={"profile": {"notes": "x" * 6000}})
    assert too_long.status_code == 422 and "6,000" in too_long.json()["detail"]


def test_api_rules_save_reapplies_and_hits(client, repo):
    stored(repo, title="Java Engineer", drop_reason="title: java")
    stored(repo, title="Rust Engineer")
    rules = client.get("/api/discover/settings").json()["rules"]
    hits = client.get("/api/discover/rules/hits").json()
    assert hits["lists"]["title_exclude"]["entries"]["java"] == 1
    words = [w for w in rules["title_exclude"] if w != "java"] + ["rust"]
    r = client.put("/api/discover/settings", json={"rules": {**rules, "title_exclude": words}}).json()  # fmt: skip
    assert r["reapplied"] == {"hidden": 1, "restored": 1}
    hits = client.get("/api/discover/rules/hits").json()
    assert hits["lists"]["title_exclude"]["entries"]["rust"] == 1 and "java" not in hits["lists"]["title_exclude"]["entries"]  # fmt: skip

    client.post("/api/discover/block", json={"company": "Spam Co"})
    added = client.get("/api/discover/settings").json()["blocked_added"]
    assert [x["name"] for x in added] == ["Spam Co"]


def test_api_watchlist(client, repo, boards):
    repo.save_watched(watched("Acme", jobs_kept=2, last_checked_at=NOW, last_status="ok"))
    r = client.post("/api/discover/companies", json={"ats": "lever", "slug": "RyzLabs", "name": " RYZ  Labs "})  # fmt: skip
    assert r.status_code == 201, r.text
    ryz = r.json()
    assert (ryz["name"], ryz["jobs_total"], ryz["jobs_kept"], ryz["last_status"]) == ("RYZ Labs", 1, 1, "ok")  # fmt: skip
    assert ryz["board_url"] == "https://jobs.lever.co/RyzLabs" and ryz["note"] == "added by hand"
    again = client.post("/api/discover/companies", json={"ats": "lever", "slug": "RyzLabs"})
    assert again.status_code == 422 and "already watched" in again.json()["detail"]
    gone = client.post("/api/discover/companies", json={"ats": "ashby", "slug": "missing"})
    assert gone.status_code == 422 and "didn't answer" in gone.json()["detail"]
    bad = client.post("/api/discover/companies", json={"ats": "workday", "slug": "x"})
    assert bad.status_code == 422

    page = client.get("/api/discover/companies", params={"sort": "roles"}).json()
    assert [c["name"] for c in page["companies"]] == ["Acme", "RYZ Labs"] and page["total"] == 2
    off = client.patch(f"/api/discover/companies/{ryz['id']}", json={"enabled": False}).json()
    assert off["enabled"] is False
    page = client.get("/api/discover/companies", params={"status": "off"}).json()
    assert [c["slug"] for c in page["companies"]] == ["RyzLabs"] and page["counts"]["on"] == 1
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.patch(f"/api/discover/companies/{missing}", json={"enabled": True}).status_code == 404  # fmt: skip


def test_api_runs(client, repo):
    for day in range(3):
        repo.save_run(DiscoveryRun(started_at=NOW - timedelta(days=day), trigger="page", notes=[f"run {day}"]))  # fmt: skip
    runs = client.get("/api/discover/runs", params={"limit": 2}).json()
    assert [r["notes"] for r in runs] == [["run 0"], ["run 1"]]


def test_api_status_counts_the_review_queue(client, repo):
    assert client.get("/api/discover/status").json() == {"to_review": 0, "last_run": None}
    stored(repo, source_id="a", title="Backend Engineer")
    stored(repo, source_id="b", title="Platform Engineer", ai_verdict="no", ai_score=20)
    stored(repo, source_id="c", title="Java Engineer", drop_reason="title: java")
    stored(repo, source_id="d", title="Data Engineer", status=PostingStatus.INTERESTED)
    stored(repo, source_id="e", title="SRE", status=PostingStatus.DISMISSED)
    repo.save_run(DiscoveryRun(started_at=YESTERDAY, trigger="schedule"))
    repo.save_run(DiscoveryRun(started_at=NOW, trigger="page", errors=1, notes=["getonbrd: 503"]))  # fmt: skip
    repo.save_run(
        DiscoveryRun(started_at=NOW + timedelta(minutes=5), trigger="rescore")
    )  # reads no source
    status = client.get("/api/discover/status").json()
    queue = client.get("/api/discover", params={"status": "new"}).json()
    assert status["to_review"] == queue["total"] == 2  # visible and new, any verdict
    assert status["last_run"]["trigger"] == "page" and status["last_run"]["errors"] == 1


def test_clock_is_used_for_hide_company():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    discovery.block_company(repo, "Spam Co", clock.now())
    assert repo.get_discovery_setting("blocked_added") == [{"name": "Spam Co", "at": NOW.isoformat()}]  # fmt: skip
