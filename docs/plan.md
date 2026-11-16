# Job application tracker: what's left

Only open work is listed here. When something is done, it comes out of this file. The design and history of everything already built (phases 0–4, the Discover page and its sources, rounds 1–3 and 6, the frontend refactor) are in git: `git show 95af9fb:docs/plan.md` and `git show 95af9fb:docs/handoff-job-discovery.md`.

## Discover

### Review screen (one posting at a time)

Built: the one-by-one screen (`pages/discover/review/`), discard reasons stored per posting (`job_postings.discard_reason`, `discard_note`, migration 0014; the codes are `discovery.DISCARD_REASONS`), the indigo theme. Left:

- **What the discards say**: a count per reason, split by source, publisher, seniority and company, with the rule or criteria change each one points to ("12 × asks too much, 9 of them senior with 8+ years: lower `max_years`"). `closed`, `fake` and `no_apply` say more about the source than about the criteria.
- **Closed by hand → closed for good**: a posting discarded as `closed` or `fake` could hide its duplicates at the same company (ties in with round 4).

### Round 4: quality of what's stored

- Mark postings closed when they leave their board (today a posting stays open forever once stored).
- Dedupe the same role listed in several locations at one company.
- Show a company's watch status on the Discover page (e.g. on a posting from a watched or unwatched company).

### Round 5: AWS

Built, not deployed yet: JSearch is gone (migration 0015 drops its saved searches; its postings stay). A `jobtracker-discover` Lambda (`handlers.discover`: `run`, `rescore`, `digest`) has its own lease, and scoring stops 2 minutes before the 900 s timeout. It runs every 6 hours (02, 08, 14 and 20 h Buenos Aires), and a daily digest goes out at 09:00 (`core/digest.py`): Gmail SMTP from and to your address, the matches and maybes not sent yet, nothing on an empty day. The page's Run now, Score pending and Re-score work in prod: an async invoke, with the progress kept in DSQL (`core/discovery_progress.py`). New: `db copy-to-dsql --only discovery`. Left:

1. **Deploy**, in this order (from `backend/`; you run the apply):
   1. `../infra/scripts/build-lambda.sh`
   2. `uv run jobtracker db migrate --dsql <endpoint>` (0011–0015; the API's new code needs these tables), and `uv run jobtracker db migrate` locally too (0015 deletes the 6 JSearch searches; the copy wants both databases on the same migrations)
   3. `uv run jobtracker db copy-to-dsql --dsql <endpoint> --only discovery --dry-run`, then without `--dry-run`
   4. `terraform plan -out tfplan` in `infra/prod`, then you run `terraform apply tfplan`
   5. `uv run jobtracker db grant-roles …` with the new `jobtracker_discover` role (the `next_steps` output prints the command)
   6. `../infra/scripts/deploy-frontend.sh`
   7. A first run from the page (about 170 postings waiting, ~$0.09), then check the run note for remoteyeah and the duration.
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

## Rest of the app

- **"What should I study" report** (Phase 5, never built). The `study_reports` table exists since migration 0001 (`id, created_at, model, input_summary, content_md`), so reports can be compared over time. Inputs: interview notes (questions, topics to study, what went wrong, self-rating) and the job descriptions. It's a paid LLM call, so ask first.
- **Chrome extension** (Phase 7, optional).
- **Ingest lease under DSQL's OCC**: never verified that a second run at the same time is refused.
- **Frontend bug**: react-router 7's functional `setParams` gets the params of the last render, so two `patch` calls in a row from `lib/useSearchParamsPatch.ts` overwrite each other. Today each change goes in one call.
