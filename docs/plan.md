# Job application tracker: what's left

Only open work is listed here. When something is done, it comes out of this file. The design and history of everything already built (phases 0–4, the Discover page and its sources, rounds 1–3 and 6, the frontend refactor) are in git: `git show 95af9fb:docs/plan.md` and `git show 95af9fb:docs/handoff-job-discovery.md`.

## Discover

### Review screen (one posting at a time)

- **What the discards say** (`job_postings.discard_reason`, codes in `discovery.DISCARD_REASONS`): a count per reason, split by source, publisher, seniority and company, with the rule or criteria change each one points to ("12 × asks too much, 9 of them senior with 8+ years: lower `max_years`"). `closed`, `fake` and `no_apply` say more about the source than about the criteria.
- **Closed by hand → closed for good**: a posting discarded as `closed` or `fake` could hide its duplicates at the same company (ties in with round 4).

### Round 4: quality of what's stored

- Mark postings closed when they leave their board (today a posting stays open forever once stored).
- Dedupe the same role listed in several locations at one company.
- Show a company's watch status on the Discover page (e.g. on a posting from a watched or unwatched company).

### Round 5: AWS

1. **Check the first runs in prod** (`jobtracker-discover`, every 6 hours, and the 09:00 digest): duration, the run notes, the first digest.
2. **remoteyeah from Lambda** is untested. The site is behind Cloudflare; a 403 or 503 shows up as a run note. If it's blocked, run that source from the laptop against DSQL (`discover run --source remoteyeah` needs a `--dsql` option, which doesn't exist yet).
3. **Monthly directory scan** (`jobtracker discover companies scan`, about 20 minutes): too long for one Lambda run (15 minutes at most), so it stays a laptop command. Against prod it also needs a `--dsql` option.
4. **DSQL's per-transaction limits** (3,000 rows, 10 MiB): `reset_scores` (Re-score) and `reapply_rules` (saving the rules) each change their rows in one transaction. That's about 800 rows today, but it grows with the postings: batch them before it gets close.
5. Remove `JSEARCH_API_KEY` from `.env` (nothing reads it any more).

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

## Anthropic login (README, *Anthropic login*)

1. **Try the local login**: `ant auth login`, `docker compose up -d`, then "Read with AI" locally.
2. **Then delete the old keys** by hand: `/jobtracker/prod/ANTHROPIC_API_KEY` in SSM, and the API keys in the Console.
3. **Redeploy the Lambdas** so prod runs the same code (only the functions' code changes).

## Rest of the app

- **"What should I study" report** (Phase 5, never built). The `study_reports` table exists since migration 0001 (`id, created_at, model, input_summary, content_md`), so reports can be compared over time. Inputs: interview notes (questions, topics to study, what went wrong, self-rating) and the job descriptions. It's a paid LLM call, so ask first.
- **Chrome extension** (Phase 7, optional).
- **Ingest lease under DSQL's OCC**: never verified that a second run at the same time is refused.
- **Frontend bug**: react-router 7's functional `setParams` gets the params of the last render, so two `patch` calls in a row from `lib/useSearchParamsPatch.ts` overwrite each other. Today each change goes in one call.
