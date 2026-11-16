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

1. **Check the first scheduled run and digest in prod.** A run from the page in prod worked (2026-11-16 17:06 UTC: remoteyeah got through Cloudflare, prompt caching works). Still unchecked: a run with trigger `schedule` (02/08/14/20 Buenos Aires) and how long it takes, and the first 09:00 digest (`discovery_settings` key `digest` gets a `sent_at`).
2. **Monthly directory scan** (`jobtracker discover companies scan`, about 20 minutes): too long for one Lambda run (15 minutes at most), so it stays a laptop command. Against prod it also needs a `--dsql` option.
3. **DSQL's per-transaction limits** (3,000 rows, 10 MiB): `reset_scores` (Re-score) and `reapply_rules` (saving the rules) each change their rows in one transaction. That's about 800 rows today, but it grows with the postings: batch them before it gets close.

### Tuning (with you, from what the scored postings show)

- **Data and security engineers** are left to the AI on purpose: decide from their verdicts whether they become role words.
- **getonbrd**: only 10 of 347 postings were visible after the rules. Most are hybrid or onsite in Chile, or "remote inside the country" with no country given: check the location rule isn't too strict there.
- **AI-marked consultancies** are hidden: check that list (Discover → Hidden) for false positives.
- **Fake-looking postings** (e.g. "Javascript Engineer - Remote, Latin America" via remotejobs.dedyn.io and victorytuitions.in to Bluelight Consulting): drop postings whose apply link goes through known redirect or aggregator domains.
- **Rate limits**: lower `SCORE_WORKERS` (6) only if 429s keep stopping runs ("stopped scoring after 3 LLM failures" in the run notes).

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
