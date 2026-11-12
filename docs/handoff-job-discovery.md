# Handoff: job discovery page

Updated 2026-11-12. The design and its history are in `docs/plan.md` §20. Read that first; this file covers only what's done, what's next, and the traps.

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
- More sources (phase c in §20): other boards, LinkedIn job-alert emails, public Greenhouse/Lever/Ashby boards for a fintech watchlist. Add a browser scraper only for a site that really needs one.

## Rules that apply (CLAUDE.md and memory)

- Build in phases and stop for review. Ask before paid calls (JSearch, LLM), anything touching AWS, or the real inbox.
- The user reviews the UI themselves: no screenshots or browser. Run `npm run typecheck` and `npm run build`, then hand over.
- Never mutate the real local `jobtracker` DB in tests; the Postgres tests use `jobtracker_test`.
- Migrations stay DSQL-compatible (`test_guardrails.py` lints them).
- Backend checks: `cd backend && uv run ruff check src tests && uv run ruff format src tests && uv run pytest -q`.
