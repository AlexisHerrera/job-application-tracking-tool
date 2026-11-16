# Job application tracker: what's left

Only open work is listed here. When something is done, it comes out of this file. The design and history of everything already built (phases 0–4, the Discover page and its sources, rounds 1–3 and 6, the frontend refactor) are in git: `git show 95af9fb:docs/plan.md` and `git show 95af9fb:docs/handoff-job-discovery.md`.

## On your side, if not done yet

- **Criteria as fields** (Discover settings → Criteria): until you save the fields once, the AI keeps reading your old criteria text. That text sits in "Other notes": trim it down to what the fields don't cover, then save.
- **Round 3 defaults** (Discover settings → Sources → "Add missing defaults"): adds the two Workable searches (engineer, developer in Argentina) and 5 companies. Then **Collect only**, filter by source → Workable, and hide the staffing firms you don't want (Uptalent.io, Pavago, Workana, Huzzle are the big ones) before **Score pending** (about 170 calls, under $0.10).

## Discover

### Round 4: quality of what's stored

- Mark postings closed when they leave their board (today a posting stays open forever once stored).
- Dedupe the same role listed in several locations at one company.
- Show a company's watch status on the Discover page (e.g. on a posting from a watched or unwatched company).

### Round 5: AWS and cleanup

The app runs discovery only locally. In prod, `POST /api/discover/run` answers 501 and the page hides the run buttons (`can_run`).

1. **Remove JSearch**: the adapter (`adapters/jsearch.py`), the monthly cap (`rules.jsearch_monthly_cap`, `discovery_runs.jsearch_requests` stays), the saved JSearch searches, `JSEARCH_API_KEY`. Its results were mostly reposts and spam, and it's switched off since round 1. With it gone, no new secret is needed in SSM.
2. **Handler**: `handlers.ingest` routes `{"trigger": "discover"}` to `discovery.run_discovery`, or a small handler in the same zip. It needs its own lease name (`repo.acquire_lease` takes any name; the page's advisory lock is local only, and DSQL has no advisory locks), and it doesn't need the Gmail secrets.
3. **Schedule**: a second EventBridge schedule in `infra/prod/scheduler.tf`, daily at about 09:00 Buenos Aires (12:00 UTC), input `{"trigger": "discover"}`, in the existing `jobtracker` group. Watch the duration: reading ~460 boards took about 130 s locally, scoring runs 6 calls at a time, `RUN_SCORE_LIMIT` is 1,000, and the ingest Lambda times out at 600 s.
4. **Data**: `db migrate --dsql` first (migrations 0011–0013 aren't on DSQL; the copy refuses when the migration lists differ), then `db copy-to-dsql`, which already copies the discovery tables, `discovery_companies` included.
5. **remoteyeah from Lambda** is untested. The site is behind Cloudflare; a 403 or 503 shows up as a run note. If it's blocked, run that source from the laptop against DSQL (`discover run --source remoteyeah` needs a `--dsql` option, which doesn't exist yet).
6. **Page in prod** (optional): have "Run now" invoke the Lambda, like the scan button does (`adapters/lambda_ingest.py`).
7. **Monthly directory scan** (`jobtracker discover companies scan`, about 20 minutes): too long for one Lambda run (15 minutes at most), so it stays a laptop command unless it's split up.
8. You run `terraform apply`; Claude plans and summarizes.

### Tuning (with you, from what the scored postings show)

- **Data and security engineers** are left to the AI on purpose: decide from their verdicts whether they become role words.
- **getonbrd**: only 10 of 347 postings were visible after the rules. Most are hybrid or onsite in Chile, or "remote inside the country" with no country given: check the location rule isn't too strict there.
- **AI-marked consultancies** are hidden: check that list (Discover → Hidden) for false positives.
- **Fake-looking postings** (e.g. "Javascript Engineer - Remote, Latin America" via remotejobs.dedyn.io and victorytuitions.in to Bluelight Consulting): drop postings whose apply link goes through known redirect or aggregator domains.
- **Rate limits**: on the next large scoring run, check that the run note shows `(+N cached)` (prompt caching works). Lower `SCORE_WORKERS` (6) only if 429s keep stopping runs.

### Maybe later

- LinkedIn job-alert emails as a source (the email funnel drops them today).
- WeRemoto and the a16z portfolio board (plain HTML pages).
- Wellfound, Built In, the Kaszek portfolio board: bot challenges, so only through your browser, and only if the other sources fall short.
- Adding a company by its website from the page (today only `jobtracker discover companies add <url>`): fetching a URL typed into a page needs more care than a local command.

## Rest of the app

- **"What should I study" report** (Phase 5, never built). The `study_reports` table exists since migration 0001 (`id, created_at, model, input_summary, content_md`), so reports can be compared over time. Inputs: interview notes (questions, topics to study, what went wrong, self-rating) and the job descriptions. It's a paid LLM call, so ask first.
- **Chrome extension** (Phase 7, optional).
- **Ingest lease under DSQL's OCC**: never verified that a second run at the same time is refused.
- **Frontend bug**: react-router 7's functional `setParams` gets the params of the last render, so two `patch` calls in a row from `lib/useSearchParamsPatch.ts` overwrite each other. Today each change goes in one call.
