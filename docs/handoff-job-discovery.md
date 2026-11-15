# Handoff: job discovery page

Updated 2026-11-15. The design and its history are in `docs/plan.md` §20 and §21. Read those first; this file covers only what's done, what's next, and the traps.

## Status

**Phase (a) is done and merged into `main`** (2026-11-12). The worktree and branch it was built on are gone.

- Backend: migration `0011_discovery.sql`, `core/discovery.py`, `adapters/jsearch.py`, `adapters/remoteyeah.py`, the `/api/discover*` routes, the `jobtracker discover seed|searches|run` CLI, and tests (`tests/test_discovery.py`, plus discovery cases in `test_api.py` and `test_postgres.py`).
- Frontend: `/discover` page (`frontend/src/pages/Discover.tsx`) with a "Criteria & searches" side panel, in the nav as **Discover**.
- The user reviewed the page and said it "works excellent".

**First real run** (local DB, 2026-11-12 18:48 UTC, from the page):
- Collected 241 postings, 239 new. Used 6 JSearch requests and made 62 Haiku calls, with 0 errors. It took about 2.5 minutes.
- Hidden 189 in all:
  - by the rules: 136 for location, 33 for title words, 4 duplicates, 2 agencies, 2 consultancies;
  - by the LLM: 12 more consultancies.
- Visible 50, which the LLM rated 1 match, 18 maybe, 31 no. The user applied to 1 and dismissed 2.
- **Only one "match"**, so the criteria may be too strict, or the searches too broad. The first thing to look at with the user is which "no" and hidden postings they would actually want.

## Search and filters (2026-11-14, on `main`)

Committed and pushed; reviewed by the user. They asked for it before tuning the criteria, to see what's OK and what isn't. The design is in `docs/plan.md` §20, "Search and filters".
- Migration `0012_posting_search.sql` is applied to the local DB (`docker compose up` runs the `migrate` service). It isn't on DSQL yet: phase (b) runs `db migrate --dsql` before copying.
- Runs and re-scores show live progress on the page (steps, bars, time left) from `GET /api/discover/progress`.
- The user re-scored the 62 visible postings with the new prompt. The 177 rule-hidden ones have never been scored, so the new filters can't see them. "Re-score recent" in the Criteria & searches panel, with "hidden ones too" ticked, covers them for about $0.12. **The user presses that button**; Claude doesn't run it.

## New sources, round 1 (2026-11-14, built and committed; the user hasn't loaded the watchlist or run it yet)

The design, the measurements and rounds 2–5 are in `docs/plan.md` §21. Read that first. The user also asked (2026-11-14) for the criteria, rules, searches and watchlist to move out of the side sheet into a proper page: that is round 6 there.

What exists now:
- **Company watchlist**: table `discovery_companies` (migration `0013`), read by every run through `adapters/ats_boards.py` (Ashby, Greenhouse, Lever public JSON). Only engineering titles in an allowed location (or no location, or a bare "Remote") are stored: `discovery.board_keep`.
- **getonbrd**: `adapters/getonbrd.py`, saved searches by category.
- **Block list**: `rules.blocked` (default Bluelight Consulting), "Hide company" on a card, `POST /api/discover/block`.
- **JSearch is off**: migration `0013` disables the saved JSearch searches when it is applied (`docker compose up` runs it). The adapter, the cap and the key are still there; removing them is round 5.
- **Collect only**: a button on the page, `score: false` on `POST /api/discover/run`, `--no-llm` on the CLI.
- **CLI**: `jobtracker discover companies list|add|import|scan`, and `discover run --source boards`.
- The starting watchlist (454 companies) ships in `backend/src/jobtracker/adapters/seeds/ats_watchlist.csv`; the full directory it came from is `backend/seeds/ats_directory_2026-08.csv` (CC BY 4.0, see `backend/seeds/README.md`).

What the user has to do (Claude doesn't touch the real database):
1. `docker compose up --build`, which applies migration `0013`.
2. On the page: Criteria & searches → Company boards → **Load the starting watchlist** (or `uv run jobtracker discover seed` from `backend/`). It also adds the two getonbrd searches.
3. **Collect only**. The first run reads ~460 boards and stores a few thousand postings, all unscored. See "First real numbers" below.

First real numbers (2026-11-14, a collect-only run into an in-memory repo: no database, no LLM):
- 131 seconds for 8 searches and 454 boards, 0 errors, no board gone.
- 1,831 postings stored: Greenhouse 644, Ashby 376, getonbrd 347, Lever 258, remoteyeah 206.
- 898 hidden by the rules: location 447, title 256, duplicate 79, old 57, consultancy 36, agency 20, blocked 3.
- **933 visible, at 304 companies**: Greenhouse 425, Ashby 278, Lever 183, remoteyeah 37, getonbrd 10. Descriptions average 4,800 characters.
- Much of the visible set is Brazil-only (Nubank, VTEX, BTG Pactual, CI&T) or "worldwide" at one company (Canonical, ~80 roles). That is the first thing for round 2 to cut before any LLM call.
- getonbrd: only 10 of 347 visible. Most are hybrid or on-site in Chile, or "remote inside the country" with no country given; check that the rule isn't too strict there.

Traps:
- `PostgresRepo.list_companies` already existed for the email pipeline's company hints. The watchlist methods are `list_watched` / `save_watched`.
- The location rule now applies to every source but JSearch, and the 21-day rule doesn't apply to board postings.
- A board that answers 404 is switched off (`last_status = "gone"`); other errors leave it on.
- `create_app(discovery_factory=…)` in tests gets no real boards and no seed watchlist unless `boards_factory` is passed.
- Postings that leave a board aren't marked closed yet (round 4).

## Round 2: scoring the larger volume (2026-11-15, committed)

Update 2026-11-15: the user ran "Score pending": 194 scored, 3 failed on rate limits. The fix (prompt caching, waiting out 429s, error kinds in the run note) is plan §21 round 2, point 5. Those 3 postings are still pending, and the next "Score pending" picks them up.

The design, the measurements and what changed from the proposal are in `docs/plan.md` §21, "Round 2". In short:
- The user ran the first collect-only run: **921 visible postings wait for a score** in the local database.
- New rules: `rules.role_exclude` (managers, support / sales, infrastructure-type titles; AI titles don't skip it), onsite in Brazil, description in Portuguese. `score_pending` runs the rules again on what waits, so the stored 921 get them: about 250 are hidden and **673 are left**.
- Scoring goes best location first (Argentina, LATAM, worldwide, not stated, Brazil); the run limit is 1,000.
- "Score pending (N)" on the page, `discover run --no-collect [--limit N]` on the CLI. The run note has the calls and tokens.
- Prompt `2026-11-14.2`: an agency isn't a forced "no", a location in Argentina is a fit, the model gets the whole description.

What the user has to do:
1. `docker compose up --build` (no migration in this round).
2. On the page, Criteria & searches: replace the "Employers:" paragraph of the criteria and add the Argentina line (the new wording is `DEFAULT_CRITERIA` in `core/discovery.py`). The saved text still says recruiters aren't wanted.
3. From `backend/`: `uv run jobtracker discover run --no-collect --limit 210` (about $0.10): the Argentina tier.
4. Read the verdicts, fix the criteria and rules, then "Score pending" for the rest (about $0.25).

Traps:
- The rules run again only on visible postings with status new and no verdict. A scored posting isn't hidden by a new rule; "Re-score recent" doesn't run the rules either.
- `unscored_postings` has no limit any more: the caller sorts and cuts.
- `data` and `security` engineers are left to the LLM on purpose; decide from their verdicts whether they become role words.

## Later: tune the criteria

Feedback from 2026-11-14:
- Done in round 2 (2026-11-15): staffing intermediaries are fine (no forced "no" for an agency), per-task AI-training gigs rank lower, a Buenos Aires location scores higher. The first is in the code; all three are in the default criteria text, which the user still has to copy into their saved criteria.
- **Fake-looking postings**: "Javascript Engineer - Remote, Latin America" (Remote Quest Jobs) went through redirect sites (remotejobs.dedyn.io, victorytuitions.in) to talents.vaia.com / **Bluelight Consulting**. The user thinks Bluelight posts fake openings. Ideas: a "hide this company" action from the card (adds it to a block list in the rules), and dropping postings whose apply link goes through known redirect or aggregator domains.

## Quota and cost

- JSearch: the user's plan has **200 free requests a month**, and each page of 10 jobs is one request. The app counts only its own runs (`discovery_runs.jsearch_requests`). Two manual test calls on 2026-11-11 aren't counted, so November is really at 8. The cap is 190 (`rules.jsearch_monthly_cap`), editable on the page.
- 6 JSearch searches a day come to about 180 a month.
- Haiku 5.5: 62 calls is a few cents.
- Ask the user before any run that spends either one (CLAUDE.md).

## Running it locally

- From the repo root: `docker compose up --build`. **`--build` matters** whenever `pyproject.toml` changes: the dev image installs packages at build time, and the first run failed with `No module named 'defusedxml'` because compose reused an image built before that package was added. Migration `0011` is already applied to the local `jobtracker` database.
- `.env` has `JSEARCH_API_KEY` and `ANTHROPIC_API_KEY`.
- CLI from `backend/`: `uv run jobtracker discover run [--dry-run] [--no-llm] [--source jsearch|remoteyeah] [--rescore]`. A dry run still spends JSearch requests and records its run row, but stores no postings and makes no LLM calls.

## Next: phase (b), AWS (not started)

1. **Secret:**
   - add `JSEARCH_API_KEY` to `ssm_secrets.SECRET_NAMES` (`backend/src/jobtracker/adapters/ssm_secrets.py`) and to `local.secrets` in `infra/prod/lambdas.tf`;
   - the user pushes it with `jobtracker aws push-secrets --only JSEARCH_API_KEY`.
   - It never goes in Terraform or on a command line.
2. **Handler:** have `handlers.ingest` route `{"trigger": "discover"}` to `discovery.run_discovery`.
   - Give it its own lease name: the ingest lease is `LEASE`, and `repo.acquire_lease` takes any name. The page's advisory lock (`try_discovery_lock`) is local-only, and DSQL has no advisory locks.
   - It doesn't need the Gmail secrets, so don't make it require them.
   - Or use a separate small handler in the same zip.
3. **Schedule:** a second EventBridge schedule in `infra/prod/scheduler.tf`, daily at about 09:00 Buenos Aires (12:00 UTC), input `{"trigger": "discover"}`, in the existing `jobtracker` schedule group.
   - About 62 LLM calls took around 2.5 minutes locally, and the ingest Lambda's timeout is 600 s.
   - `score_limit` is 150 per run; keep an eye on duration.
4. **Page in prod:** `POST /api/discover/run` returns 501 when `APP_ENV=prod`; the UI hides "Run now" via `can_run`. Optional: invoke the Lambda like the scan button does (`adapters/lambda_ingest.py`).
5. **Data:** `db copy-to-dsql` already copies the four new tables, and `discovery_runs` comes along, so the month's JSearch count is carried over.
   - Run `db migrate --dsql` first. The copy refuses to run when the two migration lists differ.
6. **remoteyeah from Lambda:** not tested. The site is behind Cloudflare; a 403 or 503 shows up as a run note ("blocked by Cloudflare?"). If it's blocked, run that source from the laptop with `discover run --source remoteyeah` against DSQL (needs a `--dsql` option on the command, which doesn't exist yet).
7. The user runs `terraform apply`; Claude plans and summarizes (memory: user-runs-applies).

## Smaller open items and ideas

- **Tune with the user**:
  - the criteria text, the rule lists and the searches, all on the page;
  - remoteyeah's location rule hides a lot (136); the hidden view shows each reason;
  - the LLM marks some companies as consultancies, and those are hidden. Check that list for false positives.
- **`job_uid` stability** across days hasn't been checked. After the second daily run, look for the same company and title stored twice from JSearch with different `source_id`s. The title + company duplicate check should catch that case anyway.
- Re-scoring ("Run and re-score recent") also runs the searches, so it spends JSearch requests. A score-only button would be cheap to add (`reset_scores` + `score_pending`).
- Runs are synchronous on the page, about 2.5 minutes. That's fine locally; in prod it would go through the Lambda (phase b).
- More sources: see `docs/plan.md` §21, rounds 3–5. LinkedIn job-alert emails are still an idea from §20.

## Rules that apply (CLAUDE.md and memory)

- Build in phases and stop for review. Ask before paid calls (JSearch, LLM), anything touching AWS, or the real inbox.
- The user reviews the UI themselves: no screenshots or browser. Run `npm run typecheck` and `npm run build`, then hand over.
- Never mutate the real local `jobtracker` DB in tests; the Postgres tests use `jobtracker_test`.
- Migrations stay DSQL-compatible (`test_guardrails.py` lints them).
- Backend checks: `cd backend && uv run ruff check src tests && uv run ruff format src tests && uv run pytest -q`.
