"""Company boards and getonbrd (plan §21): the adapters' parsing, what a run stores from a
board, the watchlist and the block list, on fakes."""

from datetime import UTC, datetime

import httpx
import pytest

from jobtracker.adapters import seeds
from jobtracker.adapters.ats_boards import AtsBoards, parse_ashby, parse_greenhouse, parse_lever
from jobtracker.adapters.careers import BoardFinder, find_boards
from jobtracker.adapters.getonbrd import GetOnBoardSource, parse_jobs
from jobtracker.adapters.workable import WorkableSource
from jobtracker.adapters.workable import parse_jobs as parse_workable
from jobtracker.core import discovery
from jobtracker.core.clock import FixedClock
from jobtracker.core.discovery import Rules, board_keep, rule_drop
from jobtracker.core.models import DiscoverySearch, WatchedCompany
from jobtracker.core.ports import SourceError
from tests.fakes import FakeBoards, FakeLLM, FakeSource, MemoryRepo, posting

NOW = datetime(2026, 11, 14, 15, 0, tzinfo=UTC)

ASHBY = {
    "jobs": [
        {
            "id": "a1", "title": "Software Engineer - Contract - Argentina", "location": "Argentina",
            "secondaryLocations": [{"location": "Uruguay"}], "isRemote": True, "isListed": True,
            "employmentType": "Contract", "publishedAt": "2025-06-03T19:46:35.025+00:00",
            "jobUrl": "https://jobs.ashbyhq.com/acme/a1", "descriptionPlain": "Build things.",
            "address": {"postalAddress": {"addressCountry": "Argentina"}},
            "compensation": {"compensationTierSummary": "$5K – $8K per month"},
        },
        {"id": "a2", "title": "Hidden", "isListed": False, "jobUrl": "https://jobs.ashbyhq.com/acme/a2"},
        {"id": "a3", "title": "No link", "jobUrl": "javascript:alert(1)"},
    ]
}  # fmt: skip
GREENHOUSE = {
    "jobs": [
        {
            "id": 8080372, "title": "Staff Software Engineer (Payments)",
            "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/8080372",
            "location": {"name": "Buenos Aires, Argentina"},
            "first_published": "2026-08-04T15:21:44-04:00",
            "content": "&lt;p&gt;Want to help?&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python &amp;amp; Go&lt;/li&gt;&lt;/ul&gt;",
        }
    ]
}  # fmt: skip
LEVER = [
    {
        "id": "l1", "text": "Full Stack AI Engineer", "hostedUrl": "https://jobs.lever.co/Acme/l1",
        "categories": {"location": "Buenos Aires", "allLocations": ["Buenos Aires"], "commitment": "Full Time"},
        "country": "AR", "workplaceType": "remote", "createdAt": 1777927388626,
        "descriptionPlain": "About us.", "additionalPlain": "Perks.",
        "lists": [{"text": "Requirements", "content": "<li>React</li><li>Node</li>"}],
        "salaryRange": {"min": 60000, "max": 90000, "currency": "USD", "interval": "per-year-salary"},
    }
]  # fmt: skip


def test_ashby_parsing():
    [p] = parse_ashby(ASHBY, "acme", "Acme")
    assert (p.source, p.source_id, p.company) == ("ashby", "acme:a1", "Acme")
    assert p.location == "Argentina | Uruguay | Remote"  # each place once, remote added
    assert p.salary_text == "$5K – $8K per month" and p.employment_type == "Contract"
    assert p.posted_at.year == 2025 and p.url == "https://jobs.ashbyhq.com/acme/a1"
    assert parse_ashby({"jobs": "nope"}, "acme", "Acme") == []


def test_greenhouse_parsing_unescapes_the_html():
    [p] = parse_greenhouse(GREENHOUSE, "acme", "Acme")
    assert (p.source_id, p.location) == ("acme:8080372", "Buenos Aires, Argentina")
    assert p.description == "Want to help?\n- Python & Go"
    assert p.posted_at == datetime.fromisoformat("2026-08-04T15:21:44-04:00")


def test_lever_parsing():
    [p] = parse_lever(LEVER, "Acme", "Acme")
    assert p.location == "Buenos Aires | Argentina | Remote"  # the country code, spelled out
    assert (
        "Requirements" in p.description and "- React" in p.description and "Perks." in p.description
    )
    assert (p.salary_min, p.salary_max, p.salary_period) == (60000, 90000, "YEAR")
    assert p.salary_text == "USD 60,000 – 90,000 per-year-salary"
    assert parse_lever({"ok": False}, "Acme", "Acme") == []


def test_boards_adapter_checks_the_slug_and_reports_gone_boards():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if "missing" in str(request.url):
            return httpx.Response(404, json={})
        return httpx.Response(200, json=LEVER)

    boards = AtsBoards(httpx.Client(transport=httpx.MockTransport(handler)))
    assert len(boards.fetch_board("lever", "Acme", "Acme")) == 1
    assert seen == ["https://api.lever.co/v0/postings/Acme?mode=json"]
    with pytest.raises(SourceError) as gone:
        boards.fetch_board("ashby", "missing", "Missing")
    assert gone.value.gone
    for ats, slug in [("ashby", "../x"), ("ashby", "a/b?c"), ("workday", "acme")]:
        with pytest.raises(SourceError):
            boards.fetch_board(ats, slug, "X")
    assert len(seen) == 2  # the bad ones never reached the network


def getonbrd_job(job_id, modality, countries, **attrs):
    return {
        "id": job_id,
        "links": {"public_url": f"https://www.getonbrd.com/jobs/{job_id}"},
        "attributes": {
            "title": "Full-Stack Developer", "remote_modality": modality, "countries": countries,
            "projects": "<p>About the role</p>", "functions_headline": "What you'll do",
            "functions": "<ul><li>Build features</li></ul>", "min_salary": 2200, "max_salary": 3500,
            "published_at": 1794490311,
            "company": {"data": {"attributes": {"name": "ZipISA"}}},
            **attrs,
        },
    }  # fmt: skip


def test_getonbrd_parsing():
    data = {
        "data": [
            getonbrd_job("a", "fully_remote", ["Remote"]),
            getonbrd_job("b", "remote_local", ["Remote"]),
            getonbrd_job("c", "hybrid", ["Chile"], min_salary=None, max_salary=None),
            getonbrd_job("d", "fully_remote", ["Remote"], remote_zone="Latin America"),
        ]
    }
    a, b, c, d = parse_jobs(data)
    assert [p.location for p in (a, b, c, d)] == [
        "Remote (anywhere)", "Remote (in-country)", "Chile (hybrid)", "Remote (Latin America)",
    ]  # fmt: skip
    assert (a.source, a.source_id, a.company) == ("getonbrd", "a", "ZipISA")
    assert a.description == "About the role\n\nWhat you'll do\n- Build features"
    assert (a.salary_min, a.salary_max, a.salary_period) == (2200, 3500, "MONTH")
    assert a.salary_text == "USD 2,200 – 3,500 a month" and c.salary_text is None
    rules = Rules()
    assert [rule_drop(discovery.prepare(p, NOW), rules, NOW) for p in (a, b, c, d)] == [
        None, "location", "location", None,
    ]  # fmt: skip


def test_getonbrd_reads_every_page():
    pages = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        pages.append(page)
        assert request.url.path == "/api/v0/categories/programming/jobs"
        job = getonbrd_job(f"job-{page}", "fully_remote", ["Remote"])
        return httpx.Response(200, json={"data": [job], "meta": {"total_pages": 2}})

    source = GetOnBoardSource(httpx.Client(transport=httpx.MockTransport(handler)))
    result = source.fetch({"category": "programming"})
    assert pages == [1, 2] and [p.source_id for p in result.postings] == ["job-1", "job-2"]
    with pytest.raises(SourceError):
        source.fetch({"category": "../users"})
    assert discovery.clean_search_params("getonbrd", {"category": "programming", "x": 1}) == {"category": "programming"}  # fmt: skip
    with pytest.raises(ValueError):
        discovery.clean_search_params("getonbrd", {"category": "sales-and-more"})


@pytest.mark.parametrize(
    ("title", "location", "kept"),
    [
        ("Senior Software Engineer", "Argentina Remote", True),
        ("Backend Developer", "Remote", True),  # a bare "Remote": unknown, kept
        ("Full Stack Engineer", None, True),
        ("Product Engineer", "Remote, LATAM | US Remote", True),
        ("Senior Software Engineer", "San Francisco", False),
        ("Senior Software Engineer", "Remote - US", False),
        ("Account Executive", "Buenos Aires, Argentina", False),
    ],
)
def test_what_is_kept_from_a_board(title, location, kept):
    assert board_keep(posting(title=title, location=location), Rules()) is kept


def test_blocked_companies_and_old_board_jobs():
    rules = Rules()
    spam = discovery.prepare(posting(company="Bluelight Consulting"), NOW)
    assert rule_drop(spam, rules, NOW) == "blocked"
    old = {"posted_at": datetime(2025, 6, 3, tzinfo=UTC)}
    assert (
        rule_drop(discovery.prepare(posting(source="remoteyeah", **old), NOW), rules, NOW) == "old"
    )
    # still listed on the company's board, so still open
    assert rule_drop(discovery.prepare(posting(source="ashby", **old), NOW), rules, NOW) is None
    assert Rules.from_dict({"blocked": ["Acme"]}).blocked == ["Acme"]
    assert Rules.from_dict({}).blocked == ["Bluelight Consulting"]  # settings saved before §21


def board_job(ats, slug, job_id, **overrides):
    return posting(source=ats, source_id=f"{slug}:{job_id}", **overrides)


def test_run_reads_the_watchlist():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    rows = [
        {"ats": "ashby", "slug": "mural", "name": "Mural"},
        {"ats": "lever", "slug": "Gone", "name": "Gone Inc"},
        {"ats": "greenhouse", "slug": "broken", "name": "Broken"},
        {"ats": "ashby", "slug": "off", "name": "Off"},
    ]
    assert discovery.import_companies(repo, rows, clock) == 4
    off = next(c for c in repo.list_watched() if c.slug == "off")
    off.enabled = False
    repo.save_watched(off)
    boards = FakeBoards(
        {
            ("ashby", "mural"): [
                board_job("ashby", "mural", 1, company="Mural", title="Senior Software Engineer"),
                board_job("ashby", "mural", 2, company="Mural", title="Java Developer"),
                board_job("ashby", "mural", 3, company="Mural", title="Account Executive"),
                board_job("ashby", "mural", 4, company="Mural", title="Software Engineer", location="New York"),
            ],
            ("ashby", "off"): [board_job("ashby", "off", 1)],
        },
        broken=[("greenhouse", "broken")],
    )  # fmt: skip
    seen = []
    result = discovery.run_discovery(repo, {}, None, clock, boards=boards, on_progress=seen.append)

    run = result.run
    # the sales job and the New York one are never stored; the Java one is stored, hidden
    assert (run.fetched, run.new, run.dropped, run.llm_calls, run.errors) == (2, 2, 1, 0, 1)
    assert run.notes == ["boards: 3 checked, 1 gone (now off), 1 failed (Broken)"]
    assert sorted(boards.calls) == [("ashby", "mural"), ("greenhouse", "broken"), ("lever", "Gone")]
    stored = {p.source_id: p.drop_reason for p in repo.list_postings()}
    assert stored == {"mural:1": None, "mural:2": "title: java"}
    assert all(p.ai_verdict is None and p.search_id is None for p in repo.list_postings())
    by_slug = {c.slug: c for c in repo.list_watched()}
    assert (by_slug["mural"].last_status, by_slug["mural"].jobs_total, by_slug["mural"].jobs_kept) == ("ok", 4, 2)  # fmt: skip
    assert (by_slug["Gone"].last_status, by_slug["Gone"].enabled) == ("gone", False)
    assert by_slug["broken"].enabled and "500" in by_slug["broken"].last_status
    assert by_slug["off"].last_checked_at is None
    assert (by_slug["mural"].last_found_at, by_slug["mural"].fail_streak) == (NOW, 0)
    assert (by_slug["broken"].last_found_at, by_slug["broken"].fail_streak) == (None, 1)
    assert (seen[0].searches_total, seen[-1].searches_done, seen[-1].phase) == (3, 3, "done")

    # the next day: nothing new, the gone board isn't asked again
    boards.calls.clear()
    again = discovery.run_discovery(repo, {}, None, clock, boards=boards)
    assert again.run.new == 0 and ("lever", "Gone") not in boards.calls
    assert next(c for c in repo.list_watched() if c.slug == "broken").fail_streak == 2


def test_only_source_picks_searches_or_boards():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    repo.save_search(
        DiscoverySearch(source="getonbrd", label="g", params={"category": "programming"})
    )
    discovery.import_companies(repo, [{"ats": "ashby", "slug": "mural", "name": "Mural"}], clock)
    source = FakeSource([posting(source="getonbrd", source_id="g1")])
    boards = FakeBoards({("ashby", "mural"): [board_job("ashby", "mural", 1, company="Mural")]})

    def run(only):
        boards.calls.clear()
        source.calls.clear()
        discovery.run_discovery(
            repo, {"getonbrd": source}, None, clock, boards=boards, only_source=only, dry_run=True
        )
        return len(source.calls), len(boards.calls)

    assert run("getonbrd") == (1, 0)
    assert run("boards") == (0, 1)
    assert run("ashby") == (0, 1)
    assert run("lever") == (0, 0)
    assert run(None) == (1, 1)
    assert repo.list_postings() == [] and repo.list_watched()[0].last_checked_at is None  # dry runs


def test_a_run_scores_board_postings_when_given_an_llm():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    discovery.import_companies(repo, [{"ats": "ashby", "slug": "mural", "name": "Mural"}], clock)
    boards = FakeBoards({("ashby", "mural"): [board_job("ashby", "mural", 1, company="Mural")]})
    result = discovery.run_discovery(repo, {}, FakeLLM(), clock, boards=boards)
    assert result.run.llm_calls == 1 and repo.list_postings()[0].ai_verdict == "maybe"


def test_import_skips_what_it_does_not_know():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    rows = [
        {"ats": "ashby", "slug": "Silver", "name": "Silver.dev", "note": "agency"},
        {"ats": "ashby", "slug": "silver", "name": "again"},  # the same board
        {"ats": "workday", "slug": "acme", "name": "Acme"},
        {"ats": "lever", "slug": "a/../b", "name": "Bad"},
        {"ats": "lever", "slug": "", "name": "Empty"},
        {"ats": "greenhouse", "slug": "gofundme", "name": ""},
    ]
    assert discovery.import_companies(repo, rows, clock) == 2
    assert [(c.ats, c.slug, c.name, c.note) for c in repo.list_watched()] == [
        ("ashby", "Silver", "Silver.dev", "agency"),
        ("greenhouse", "gofundme", "gofundme", None),
    ]


def test_directory_scan_adds_only_latam_engineering_boards():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    discovery.import_companies(repo, [{"ats": "ashby", "slug": "mural", "name": "Mural"}], clock)
    boards = FakeBoards(
        {
            ("ashby", "mural"): [],
            ("ashby", "double"): [board_job("ashby", "double", 1, title="Senior Fullstack Engineer", location="Argentina/Uruguay (Remote)")],
            ("ashby", "ramp"): [board_job("ashby", "ramp", 1, title="Software Engineer", location="New York")],
            ("lever", "sales"): [board_job("lever", "sales", 1, title="Account Executive", location="Buenos Aires")],
            ("greenhouse", "fde"): [board_job("greenhouse", "fde", 1, title="Forward Deployed Engineer - LATAM", location="Sao Paulo")],
        },
        broken=[("lever", "broken")],
    )  # fmt: skip
    rows = [
        {"ats": ats, "slug": slug, "name": slug.title()}
        for ats, slug in [("ashby", "mural"), ("ashby", "double"), ("ashby", "ramp"),
                          ("lever", "sales"), ("greenhouse", "fde"), ("lever", "broken"),
                          ("lever", "missing")]
    ]  # fmt: skip
    ticks = []
    out = discovery.scan_directory(repo, boards, rows, clock, lambda *a: ticks.append(a))
    assert out == {"checked": 6, "added": 2, "gone": 1, "failed": 1}
    assert ("ashby", "mural") not in boards.calls  # already watched
    notes = {c.slug: c.note for c in repo.list_watched()}
    assert notes == {"mural": None, "double": "directory scan: argentin", "fde": "directory scan: sao paulo"}  # fmt: skip
    assert ticks[-1] == (6, 6, 2) and repo.list_postings() == []
    assert repo.get_discovery_setting("watchlist_scan") == {"at": NOW.isoformat(), **out}


def test_hide_company_blocks_it_and_hides_its_postings():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    for i, company in enumerate(["Spam Co", "Spam Co", "Good Co"]):
        repo.add_posting(discovery.prepare(posting(source_id=str(i), company=company), NOW))
    assert discovery.block_company(repo, "  Spam   Co ") == 2
    assert discovery.load_settings(repo)[1].blocked == ["Bluelight Consulting", "Spam Co"]
    assert {p.company: p.drop_reason for p in repo.list_postings()} == {"Spam Co": "blocked", "Good Co": None}  # fmt: skip
    assert discovery.block_company(repo, "spam co") == 0  # not listed twice
    assert discovery.load_settings(repo)[1].blocked == ["Bluelight Consulting", "Spam Co"]
    new = discovery.prepare(posting(company="Spam Co"), NOW)
    assert rule_drop(new, discovery.load_settings(repo)[1], clock.now()) == "blocked"
    with pytest.raises(ValueError):
        discovery.block_company(repo, "  ")


def test_the_shipped_watchlist_is_importable():
    rows = seeds.watchlist()
    assert len(rows) > 400 and {r["ats"] for r in rows} == set(discovery.ATS)
    assert not any("bluelight" in r["name"].lower() for r in rows)
    repo = MemoryRepo()
    assert discovery.import_companies(repo, rows, FixedClock(NOW)) == len(rows)
    directory = seeds.read_boards(
        "ats_vendor,company_name,board_slug,last_crawled\nashby,0x,0x,2026-07-12\n"
    )
    assert directory == [{"ats": "ashby", "slug": "0x", "name": "0x", "note": ""}]


def test_watchlist_summary_for_the_page():
    from jobtracker.api.schemas import companies_json

    rows = [
        WatchedCompany("ashby", "a", "A", jobs_total=9, jobs_kept=3, last_checked_at=NOW),
        WatchedCompany("lever", "b", "B", jobs_total=4, jobs_kept=0, last_checked_at=NOW),
        WatchedCompany("lever", "c", "C", enabled=False, jobs_kept=5),
    ]
    assert companies_json(rows) == {
        "total": 3, "enabled": 2, "by_ats": {"ashby": 1, "greenhouse": 0, "lever": 1},
        "with_jobs": 1, "jobs_kept": 3, "last_checked_at": NOW.isoformat(), "last_scan_at": None,
    }  # fmt: skip
    assert companies_json(rows, {"at": "2026-11-15T10:00:00+00:00"})["last_scan_at"] == "2026-11-15T10:00:00+00:00"  # fmt: skip


# --- Round 3: Workable's search, and adding one company by URL ---------------------------------


def workable_job(job_id, title="Senior Backend Engineer", **fields):
    return {
        "id": job_id, "title": title, "state": "published", "workplace": "remote",
        "url": f"https://jobs.workable.com/view/{job_id}/x", "employmentType": "Full-time",
        "description": "<p>About the role</p>", "requirementsSection": "<ul><li>Go</li></ul>",
        "benefitsSection": "", "created": "2026-01-10T16:31:39.874Z",
        "location": {"city": "Buenos Aires", "subregion": None, "countryName": "Argentina"},
        "company": {"title": "Maxana", "website": "http://example.test"},
        **fields,
    }  # fmt: skip


def test_workable_parsing():
    data = {
        "jobs": [
            workable_job("w1"),
            workable_job("w2", workplace="on_site", location={"city": "", "countryName": "Uruguay"}),
            workable_job("w3", workplace="hybrid", location=None, company=None),
            workable_job("w4", url="javascript:alert(1)"),
            "junk",
        ]
    }  # fmt: skip
    a, b, c = parse_workable(data)
    assert (a.source, a.source_id, a.company, a.publisher) == ("workable", "w1", "Maxana", "Workable")  # fmt: skip
    assert a.location == "Buenos Aires, Argentina (remote)"
    assert a.description == "About the role\n\n- Go" and a.employment_type == "Full-time"
    assert a.posted_at == datetime(2026, 1, 10, 16, 31, 39, 874000, tzinfo=UTC)
    assert (b.location, c.location, c.company) == ("Uruguay (on-site)", "Hybrid", "(unknown)")
    assert parse_workable({"jobs": None}) == [] and parse_workable([]) == []


def test_workable_follows_the_page_token_and_stops_on_a_repeat():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.url.params))
        token = request.url.params.get("pageToken")
        if token is None:
            return httpx.Response(200, json={"jobs": [workable_job("a")], "nextPageToken": "t1"})
        # every later page repeats the same job, as the API does with a token it doesn't know
        return httpx.Response(200, json={"jobs": [workable_job("a")], "nextPageToken": "t2"})

    source = WorkableSource(httpx.Client(transport=httpx.MockTransport(handler)))
    result = source.fetch({"query": "engineer", "location": "Argentina"})
    assert [p.source_id for p in result.postings] == ["a"]
    assert seen == [
        {"query": "engineer", "location": "Argentina"},
        {"query": "engineer", "location": "Argentina", "pageToken": "t1"},
    ]
    with pytest.raises(SourceError):
        source.fetch({})
    clean = discovery.clean_search_params
    assert clean("workable", {"query": " engineer ", "location": "Argentina", "x": 1}) == {"query": "engineer", "location": "Argentina"}  # fmt: skip
    assert clean("workable", {"location": "Uruguay"}) == {"location": "Uruguay"}
    for bad in [{}, {"query": " "}, {"query": 5}, {"location": "x" * 101}]:
        with pytest.raises(ValueError):
            clean("workable", bad)


def test_a_run_keeps_only_engineering_titles_from_workable_and_old_ones_too():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    repo.save_search(DiscoverySearch(source="workable", label="w", params={"location": "Argentina"}))  # fmt: skip
    old = datetime(2025, 8, 1, tzinfo=UTC)  # still listed, so still open
    source = FakeSource(
        [
            posting(source="workable", source_id="1", title="Backend Developer", location="Argentina (remote)", posted_at=old),
            posting(source="workable", source_id="2", title="Business Development Rep", location="Argentina (remote)"),
        ]
    )  # fmt: skip
    result = discovery.run_discovery(repo, {"workable": source}, None, clock)
    assert [(p.source_id, p.drop_reason) for p in result.new] == [("1", None)]
    assert "workable" in discovery.SEARCH_SOURCES and "workable" in discovery.OPEN_LISTINGS
    assert {x[0] for x in discovery.DEFAULT_SEARCHES} == {"getonbrd", "remoteyeah", "workable"}


def test_board_links_in_a_page():
    page = """
      <a href="https://jobs.ashbyhq.com/Silver/abc-123">Apply</a>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=gofundme"></script>
      <a href="https://job-boards.greenhouse.io/gofundme/jobs/1">x</a>
      <iframe src="https://jobs.lever.co/RyzLabs"></iframe>
      <a href="https://apply.workable.com/acme">not read</a>
    """
    assert find_boards(page) == [("ashby", "Silver"), ("greenhouse", "gofundme"), ("lever", "RyzLabs")]  # fmt: skip
    assert find_boards("https://boards.greenhouse.io/embed/job_board?for=acme&b=x") == [("greenhouse", "acme")]  # fmt: skip
    assert find_boards("see jobs.lever.co/acme.") == [("lever", "acme")]
    assert find_boards("https://example.test/careers") == []


def test_finding_a_board_from_a_company_site():
    pages = {
        "https://acme.test": '<a href="/about">About</a> <a href="/careers#open">Careers</a>'
        ' <a href="https://evil.test/jobs">Jobs</a> <a href="http://acme.test/jobs">Jobs</a>',
        "https://acme.test/careers": '<iframe src="https://jobs.lever.co/AcmeCo"></iframe>',
        "https://plain.test": "<p>We sell bread.</p>",
    }
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if str(request.url) in pages:
            return httpx.Response(200, html=pages[str(request.url)])
        return httpx.Response(404)

    finder = BoardFinder(httpx.Client(transport=httpx.MockTransport(handler)))
    assert finder.find("acme.test") == ("lever", "AcmeCo")
    assert seen == [
        "https://acme.test",
        "https://acme.test/careers",
    ]  # other sites, http: not followed
    assert finder.find("https://jobs.ashbyhq.com/Silver") == ("ashby", "Silver")
    assert len(seen) == 2  # a board URL needs no request
    assert finder.find("https://plain.test") is None
    assert finder.find("https://gone.test/") is None
    assert finder.find("http://acme.test/") is None and finder.find("ftp://x") is None


def test_watching_one_company_reads_its_board_first():
    repo, clock = MemoryRepo(), FixedClock(NOW)
    boards = FakeBoards(
        {
            ("lever", "RyzLabs"): [
                board_job("lever", "RyzLabs", 1, title="Full Stack Engineer", location="Argentina"),
                board_job("lever", "RyzLabs", 2, title="Account Executive", location="Argentina"),
                board_job("lever", "RyzLabs", 3, title="Software Engineer", location="New York"),
            ]
        }
    )  # fmt: skip
    assert discovery.watch_company(repo, boards, "lever", "RyzLabs", "RYZ Labs", clock) == (3, 1)
    [c] = repo.list_watched()
    assert (c.ats, c.slug, c.name, c.note) == ("lever", "RyzLabs", "RYZ Labs", "added by hand")
    assert repo.list_postings() == []
    with pytest.raises(ValueError, match="already watched"):
        discovery.watch_company(repo, boards, "lever", "RyzLabs", None, clock)
    with pytest.raises(SourceError):
        discovery.watch_company(repo, boards, "ashby", "missing", None, clock)
    with pytest.raises(ValueError):
        discovery.watch_company(repo, boards, "workday", "acme", None, clock)
    assert len(repo.list_watched()) == 1
