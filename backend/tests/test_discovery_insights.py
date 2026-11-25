from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

from jobtracker.core import criteria, discard_hints, discovery_insights
from jobtracker.core.discard_hints import Context
from jobtracker.core.discovery import Rules
from jobtracker.core.matching import normalize_company
from jobtracker.core.models import PostingStatus
from tests.conftest import TZ
from tests.fakes import posting

TODAY = date(2026, 11, 16)
# 15:00 in Buenos Aires (UTC-3) on TODAY.
NOON = datetime(2026, 11, 16, 18, 0, tzinfo=UTC)
PROFILE = criteria.DEFAULT_PROFILE  # max_years 5, staff/principal/lead at most a maybe
RULES = Rules()


def reviewed(status=PostingStatus.DISMISSED, reason=None, at=NOON, **fields):
    p = posting(
        status=status, discard_reason=reason, reviewed_at=at, fetched_at=at - timedelta(days=1),
        **fields,
    )  # fmt: skip
    p.company_normalized = normalize_company(p.company)  # as a run stores it
    return p


def discarded(reason, n, **fields):
    return [reviewed(reason=reason, **fields) for _ in range(n)]


def ctx(group, kept=(), profile=PROFILE, rules=RULES):
    return Context(kept=list(kept), reviewed=list(group) + list(kept), profile=profile, rules=rules)


def texts(reason, group, **kw):
    return [h["text"] for h in discard_hints.hints_for(reason, group, ctx(group, **kw))]


def test_days_are_buenos_aires_days_and_the_window_ends_today():
    days = discovery_insights.window(TODAY, 3)
    assert days == [date(2026, 11, 14), date(2026, 11, 15), TODAY]
    late = datetime(2026, 11, 16, 2, 30, tzinfo=UTC)  # 23:30 on the 15th in Buenos Aires
    rows = [
        posting(source="getonbrd", fetched_at=late),
        posting(source="getonbrd", fetched_at=late, drop_reason="title: java"),
        posting(source="ashby", fetched_at=NOON, drop_reason="location"),
        posting(source="ashby", fetched_at=NOON),
        posting(source="ashby", fetched_at=NOON, drop_reason="title: php"),
        posting(source="ashby", fetched_at=NOON - timedelta(days=5)),  # before the window
    ]
    out = discovery_insights.new_postings(rows, days, TZ)
    assert (out["total"], out["queue"], out["hidden"]) == (5, 2, 3)
    assert out["days"] == [{"queue": 0, "hidden": 0}, {"queue": 1, "hidden": 1}, {"queue": 1, "hidden": 2}]  # fmt: skip
    assert [(s["source"], s["queue"], s["hidden"]) for s in out["sources"]] == [("ashby", 1, 2), ("getonbrd", 1, 1)]  # fmt: skip
    assert out["sources"][1]["days"][1] == {"queue": 1, "hidden": 1}
    assert out["hidden_by"] == [("title", 2), ("location", 1)]


def test_reviews_per_day_by_what_they_are_now():
    days = discovery_insights.window(TODAY, 7)
    rows = [
        reviewed(PostingStatus.INTERESTED),
        reviewed(PostingStatus.APPLIED, at=NOON - timedelta(days=2)),
        reviewed(reason="closed"),
        reviewed(at=NOON - timedelta(days=10)),  # reviewed before the window
        posting(status=PostingStatus.NEW, fetched_at=NOON),  # still in the queue
    ]
    got = discovery_insights.reviewed_in(rows, days, TZ)
    assert len(got) == 3
    out = discovery_insights.reviews(got, days, TZ)
    assert (out["total"], out["saved"], out["applied"], out["discarded"]) == (3, 1, 1, 1)
    assert out["days"][-1] == {"saved": 1, "applied": 0, "discarded": 1}
    assert out["days"][-3] == {"saved": 0, "applied": 1, "discarded": 0}


def test_discards_by_reason_with_splits_verdicts_and_notes():
    senior = [
        reviewed(reason="too_senior", source="greenhouse", publisher="Greenhouse", company="Contoso",
                 seniority="senior", years_required=8, ai_verdict="no", discard_note="10+ years"),
        reviewed(reason="too_senior", source="greenhouse", publisher="Greenhouse", company="CONTOSO",
                 seniority="staff_plus", years_required=7, ai_verdict="match"),
        reviewed(reason="too_senior", source="workable", publisher="Workable", company="Fabrikam",
                 seniority="senior", ai_verdict=None, at=NOON - timedelta(hours=1), discard_note="lead"),
    ]  # fmt: skip
    rows = [*senior, reviewed(reason="closed", source="workable"), reviewed(reason=None),
            reviewed(PostingStatus.APPLIED, source="workable")]  # fmt: skip
    out = discovery_insights.discards(rows, ctx(rows))
    assert (out["total"], out["without_reason"]) == (5, 1)
    first, second = out["reasons"]
    assert (first["reason"], first["count"], first["about"]) == ("too_senior", 3, "criteria")
    assert (second["reason"], second["about"]) == ("closed", "source")
    assert first["splits"]["source"] == [["greenhouse", 2], ["workable", 1]]
    assert first["splits"]["company"] == [["Contoso", 2], ["Fabrikam", 1]]  # one name per company
    assert first["splits"]["seniority"] == [["senior", 2], ["staff_plus", 1]]
    assert first["verdicts"] == {"match": 1, "maybe": 0, "no": 1, "unscored": 1}
    assert first["detail"] == {"kind": "years", "values": [[7, 1], [8, 1]]}
    assert [n["note"] for n in first["notes"]] == ["10+ years", "lead"]  # newest first
    quality = {r["source"]: r for r in out["sources"]}
    assert quality["workable"] == {"source": "workable", "reviewed": 3, "kept": 1, "discarded": 2,
                                   "closed": 1, "fake": 0, "no_apply": 0, "duplicate": 0}  # fmt: skip


def test_already_applied_is_an_application_reason_without_tuning_hints():
    rows = discarded("already_applied", 2, ai_verdict="match")
    out = discovery_insights.discards(rows, ctx(rows))
    (row,) = out["reasons"]
    assert (row["reason"], row["about"], row["count"]) == ("already_applied", "application", 2)
    assert row["hints"] == []
    assert out["sources"][0]["duplicate"] == 0


def test_summary_counts_the_window_and_keeps_the_all_time_saved_for_the_checks():
    old_save = reviewed(PostingStatus.INTERESTED, at=NOON - timedelta(days=60), years_required=4)
    group = discarded("too_senior", 3, years_required=4, title="Engineer")
    out = discovery_insights.summary(
        [old_save, *group], today=TODAY, days=30, tz=TZ, profile=PROFILE, rules=RULES, waiting=12
    )
    assert out["days"][0] == "2026-10-18" and out["days"][-1] == "2026-11-16"
    assert (out["reviews"]["total"], out["reviews"]["waiting"]) == (3, 12)
    # The save from two months ago isn't a review in the window, but a change mustn't hide it.
    assert "it would also make a no of 1 you saved or applied to" in out["discards"]["reasons"][0]["hints"][0]["text"]  # fmt: skip


def test_too_senior_points_at_max_years_and_seniority():
    group = [
        *discarded(
            "too_senior", 4, years_required=5, title="Staff Engineer", seniority="staff_plus"
        ),
        *discarded("too_senior", 3, years_required=4, title="Staff Backend Engineer"),
        *discarded("too_senior", 2, years_required=9, ai_verdict="match"),
    ]
    got = texts("too_senior", group, kept=[reviewed(PostingStatus.APPLIED, title="Lead Engineer")])
    assert got == [
        "7 of the 9 ask for 4+ years: lower “Most years of experience asked” from 5 to 3.",
        "2 of the 9 ask for more than 5 years, which the criteria already make a no, yet the AI said match or maybe: score them again.",
        "“staff” in 7 titles: add it to the seniority words (Rules), which hide a title before the AI reads it.",
        "4 of the 9 are staff level or above, as the AI read them: move staff, principal and lead from “At most a maybe” to “A no”.",
    ]  # fmt: skip
    # "lead" is in a title applied to, so it's never offered; no limit set → set one.
    no_limit = replace(PROFILE, max_years=None)
    first = texts("too_senior", discarded("too_senior", 2, years_required=6), profile=no_limit)[0]
    assert first == "Both ask for 6+ years: set “Most years of experience asked” to 5 (no limit now)."  # fmt: skip


def test_too_junior_points_at_words_and_levels():
    group = discarded("too_junior", 3, title="Associate Software Engineer", seniority="mid")
    assert texts("too_junior", group) == [
        "“associate” in 3 titles: add it to the seniority words (Rules), which hide a title before the AI reads it.",
        "All 3 are mid-level, as the AI read them: add “mid” to “A no”.",
    ]  # fmt: skip


def test_stack_names_what_sets_the_discards_apart():
    group = [
        *discarded("stack", 3, title="Java Developer", technologies=["Java", "React", "Spring"]),
        *discarded("stack", 1, technologies=["Kotlin", "React"]),
    ]
    kept = [reviewed(PostingStatus.INTERESTED, technologies=["React", "Spring"])]
    # React is in the stack; Spring is as common among what was saved.
    no_java = replace(PROFILE, stack_no=[])
    assert texts("stack", group, kept=kept, profile=no_java) == [
        "Java in 3 of the 4: add it to “Roles mainly in these are a no”.",
    ]
    # Already a no in the criteria (the default has Java) and not a stack word yet → the stack
    # words, from the titles. With the default rules (java a stack word) there's nothing to add.
    assert texts("stack", group, kept=kept) == []
    rules = replace(RULES, title_exclude=["php"])
    assert texts("stack", group, kept=kept, rules=rules) == [
        "“Java” is in 3 titles and already a no in the criteria: add it to the stack words (Rules) to hide those before the AI reads them.",
    ]  # fmt: skip


def test_role_words_skip_what_is_wanted_or_was_saved():
    group = [
        *discarded("role", 2, title="Solutions Engineer"),
        *discarded("role", 2, title="Data Engineer"),
        reviewed(reason="role", title="Product Engineer"),
    ]
    kept = [reviewed(PostingStatus.APPLIED, title="Data Platform Engineer")]
    # "data" was applied to; "product" is in the AI roles wanted.
    assert texts("role", group, kept=kept) == [
        "“solutions” in 2 titles: add it to the role words (Rules), which hide a title before the AI reads it.",
    ]  # fmt: skip


def test_location_names_the_allow_entry_that_let_them_through():
    group = [
        *discarded("location", 3, location="Remote - Americas", location_fit="yes"),
        reviewed(reason="location", location="Remote, Latin America or Americas"),  # two entries
    ]
    kept = [reviewed(PostingStatus.INTERESTED, location="Americas only")]
    assert texts("location", group, kept=kept) == [
        "“americas” alone let 3 of the 4 through: take it off the locations (Rules), though it would also catch 1 you saved or applied to.",
        "The AI thought 3 of the 4 could hire you: add where they were really limited to under “No”.",
    ]  # fmt: skip


def test_work_mode_salary_and_contract():
    hybrid = discarded("work_mode", 2, work_mode="hybrid")
    assert texts("work_mode", hybrid) == [
        "Both were hybrid, as the AI read them: add “hybrid outside Buenos Aires” under “No”.",
    ]
    # The default criteria already name onsite.
    assert texts("work_mode", discarded("work_mode", 2, work_mode="onsite")) == []

    pay = [
        *(reviewed(reason="salary", salary_usd_max=s) for s in (30_000, 42_000, 80_000)),
        reviewed(reason="salary"),
    ]
    kept = [reviewed(PostingStatus.APPLIED, salary_usd_max=60_000)]
    assert texts("salary", pay, kept=kept) == [
        "2 of the 4 pay at most USD 42k a year: raise “Minimum salary” (none now) to USD 45k.",
    ]
    asks = replace(PROFILE, salary_min_usd=50_000)
    assert texts("salary", pay, kept=kept, profile=asks) == [
        "2 of the 4 pay at most USD 42k a year, and the criteria already ask for USD 50k: a salary floor of USD 45k (now none) hides those before the AI reads them, when the source states the pay.",
    ]  # fmt: skip
    near = [reviewed(PostingStatus.APPLIED, salary_usd_max=43_000)]
    assert texts("salary", pay, kept=near)[0].endswith("to USD 43k; the lowest you saved or applied to pays USD 43k.")  # fmt: skip

    contracts = [*discarded("contract", 2, employment_type="Contract"), reviewed(reason="contract", employment_type="Full time")]  # fmt: skip
    assert texts("contract", contracts) == [
        "2 of the 3 were listed as “Contract”: the location notes say any contract type is fine: narrow that down.",
    ]  # fmt: skip


def test_company_and_intermediary_name_companies():
    group = [
        *discarded("company", 2, company="Contoso"),
        reviewed(reason="company", company="Initech"),
    ]
    assert texts("company", group) == [
        "Contoso (2): add it to the blocked companies (Rules), or use “Hide company” on a posting.",
    ]
    # One discard is enough to name an intermediary; the list follows what the AI said it was.
    one = [reviewed(reason="intermediary", company="Uptalent", employer_kind="agency")]
    assert texts("intermediary", one) == ["Add Uptalent to the agencies and talent marketplaces (Rules)."]  # fmt: skip
    two = [*one, reviewed(reason="intermediary", company="Nearshore Co", employer_kind="consultancy"),
           reviewed(reason="intermediary", company="Turing")]  # already an agency  # fmt: skip
    assert texts("intermediary", two) == [
        "Add Uptalent to the agencies and talent marketplaces (Rules).",
        "Add Nearshore Co to the consultancies (Rules).",
    ]
    # The default notes call Silver.dev and G2i fine: the notes disagree with the discards.
    fine = [*discarded("intermediary", 2, company="Silver.dev", employer_kind="agency"), reviewed(reason="intermediary", company="G2i Inc.")]  # fmt: skip
    assert texts("intermediary", fine) == [
        "The other notes call Silver.dev (2) and G2i Inc. fine, yet you discarded them as an intermediary: take them out of the notes, then add them to the agencies if they keep coming.",
    ]  # fmt: skip


def test_posting_reasons_speak_of_the_source():
    group = [*discarded("closed", 3, source="workable"), *discarded("closed", 2, source="ashby"),
             reviewed(reason="closed", source="lever")]  # fmt: skip
    others = [reviewed(PostingStatus.INTERESTED, source="workable") for _ in range(7)]
    c = Context(kept=others, reviewed=group + others, profile=PROFILE, rules=RULES)
    assert [h["text"] for h in discard_hints.hints_for("closed", group, c)] == [
        "Workable: 3 of the 10 reviewed from it were closed; Ashby boards: 2 of 2.",
    ]
    assert discard_hints.hints_for("closed", group, c)[0]["where"] == "sources"
    fake = discarded("fake", 2, company="Bluelight Partners", source="remoteyeah")
    assert texts("fake", fake) == [
        "remoteyeah: 2 of the 2 reviewed from it looked fake.",
        "Bluelight Partners (2): block it (Rules) to stop seeing their postings.",
    ]


def test_one_discard_or_no_pattern_gives_no_hint_unless_the_ai_liked_them():
    assert texts("too_senior", discarded("too_senior", 1, years_required=4)) == []
    assert texts("other", discarded("other", 3)) == []
    liked = discarded("other", 3, ai_verdict="maybe")
    assert texts("other", liked) == [
        "The AI scored all 3 a match or maybe, so the criteria don't rule these out yet: say why under Other notes.",
    ]  # fmt: skip
    # Source reasons never get the criteria fallback.
    assert texts("no_apply", discarded("no_apply", 1, ai_verdict="match")) == []
