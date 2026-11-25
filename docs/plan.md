# Job application tracker: what's left

Open work only; remove an item once it's done. History and design of what's built: `git show 95af9fb:docs/plan.md` and `git show 95af9fb:docs/handoff-job-discovery.md`.

## Discover

- [ ] Mark postings closed when they leave their board (today a stored posting stays open forever). The form endpoints in `adapters/ats_forms.py` answer 404 for a closed posting: one cheap check per posting (4 of the top 20 matches were closed on 2026-11-24).
- [ ] A posting discarded as `closed` or `fake` also hides its duplicates at the same company.
- [ ] Dedupe the same role listed in several locations at one company.
- [ ] Show a company's watch status on the Discover page (watched or not, on its postings).
- [ ] Drop fake-looking postings whose apply link goes through known redirect or aggregator domains (e.g. remotejobs.dedyn.io, victorytuitions.in → Bluelight Consulting).
- [ ] Monthly directory scan (`jobtracker discover companies scan`, ~20 min) against prod: needs a `--dsql` option; stays a laptop command (too long for Lambda's 15 min).
- [ ] Batch `reset_scores` (Re-score) and `reapply_rules` (saving the rules) before they near DSQL's per-transaction limits (3,000 rows, 10 MiB; ~800 rows today).

## Apply

The Questions, Experience and Facts pages are built (migration 0017, `core/apply.py`). The questions come from `jobtracker apply collect-questions`, never from the repo (it's public). Next:

- [ ] Fill in Experience and Facts, answer the questions (you). The answers are the examples the drafts below learn the format from.
- [ ] "Draft an answer" on the Questions page: paste a question (and optionally pick the posting, for "why us"), get a draft from your Experience, your answers in that category and their style notes, edit, copy. One paid call per draft (prompt-cache the experience), so ask first. A free "Copy prompt" alternative to paste into claude.ai.
- [ ] Collect new questions on their own: `apply collect-questions` after each discovery run, or when a posting is marked applied.
- [ ] Applications with no `job_url` (recruiters, direct) have no form to read: paste their questions by hand when you meet them.
- [ ] "Most likely to apply" ranking: learn from what you applied to versus dismissed (with `discard_reason`), on top of the AI score.
- [ ] Filling forms: a Chrome extension that matches a form's fields to saved answers and facts (no tokens for questions you've answered), or Claude in Chrome for one form to measure its real cost first. You always press submit.

## Tuning (from what the scored postings show)

- [ ] Data and security engineers: decide from their AI verdicts whether they become role words.
- [ ] getonbrd: only 10 of 347 postings pass the rules (mostly hybrid/onsite in Chile, or "remote inside the country" with no country); check the location rule isn't too strict.
- [ ] AI-hidden consultancies: check Discover → Hidden for false positives.
- [ ] Lower `SCORE_WORKERS` (6) only if 429s keep stopping runs ("stopped scoring after 3 LLM failures" in the run notes).

## Rest of the app

- [ ] "What should I study" report (Phase 5): the `study_reports` table exists (migration 0001); inputs are interview notes and job descriptions. Paid LLM call, so ask first.
- [ ] Verify the ingest lease under DSQL's OCC refuses a second concurrent run.
- [ ] Frontend: two `patch` calls in a row from `lib/useSearchParamsPatch.ts` overwrite each other (react-router 7's functional `setParams` gets the last render's params). Today each change uses one call.

## Maybe later

- LinkedIn job-alert emails as a source (the email funnel drops them today).
- WeRemoto and the a16z portfolio board (plain HTML pages).
- Wellfound, Built In, Kaszek portfolio board: bot challenges, so only through your browser, and only if other sources fall short.
- Add a company by its website from the page (today only `jobtracker discover companies add <url>`); fetching a typed URL needs more care than a local command.
