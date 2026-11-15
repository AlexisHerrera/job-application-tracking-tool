# Job Application Tracker: Phase 0 Plan

Status: **approved 2026-10-19**.

## 0. Decisions (from review)

- **AWS**: same account as the other project (SSO session `personal`, account 630773215521). Add a dedicated profile `jobtracker` → region **us-east-1**. No separate account, because the free tier is shared across an Organization anyway.
- **Email**: `alexysaguilar@gmail.com` is both the inbox and the only email the Access policy allows.
- **Storage**: Aurora DSQL in prod, Postgres in local compose. **No SqliteRepo.**
- **Languages**: recruiting mail comes in English **and** Spanish, so the heuristics are bilingual.
- **LinkedIn Easy Apply**: used sometimes. Keep "application sent" confirmations and drop alerts. Manual add always works.
- **Auto-create applications**: yes. They're flagged `needs_review` and shown in a "To review" list until confirmed.
- **Notion import**: dropped (32 rows, entered manually through the UI/CSV).
- **Cloudflare team**: `alexisherrera`. *(Superseded 2026-11-05: the login is Amazon Cognito, §19.)*

## 1. Big picture

```
            ┌── Cognito managed login (password + authenticator code) ──┐
            │   returns an ID token to the SPA (code + PKCE)            │
            ▼                                                           │
 browser ──https──▶ jobs.alexisherrera.dev (Route 53 alias) ──▶ CloudFront   (X-Id-Token header)
                                                                  │
                              ┌───────────────────────────────┬───┘
                              ▼ /*  (OAC)                     ▼ /api/*  (OAC → Function URL)
                        S3 (private)                   Lambda "api"  (FastAPI via Mangum)
                        React SPA                      validates the Cognito ID token, else 401
                                                              │
 EventBridge Scheduler ── every 15 min ──▶ Lambda "ingest" ───┤
                                              │  IMAP (app password, X-GM-RAW search)
                                              │  Anthropic API (Haiku-class, structured output)
                                              ▼               ▼
                                      SSM SecureString     Aurora DSQL (Postgres-compatible, serverless)
```

Both Lambdas sit **outside a VPC**, so they get outbound internet (IMAP, Anthropic, the Cognito signing keys) with no NAT gateway, and they reach DSQL, SSM and S3 over public AWS endpoints.

## 2. Storage evaluation (you asked for SQL vs DynamoDB)

| | **Aurora DSQL** (recommended) | DynamoDB on-demand | SQLite file on S3 | External Postgres (Neon etc.) |
|---|---|---|---|---|
| Query model | Real SQL: joins, aggregates, ad-hoc queries | Key/value. Access patterns are fixed up front, and stats would need scans | SQL | SQL |
| Cost at my scale | Always Free: 100k DPU/month + 1 GB | Effectively $0 | ~$0 | Free tier, but limits change and it's outside AWS |
| VPC / NAT | None needed (public endpoint, IAM auth) | None | None | None |
| DBeaver / DataGrip | **Yes.** DBeaver Community has the official AWS plugin (generates IAM tokens from your AWS profile). DataGrip uses a token as the password | DBeaver Community: no. DBeaver PRO/NoSQL Workbench: yes. DataGrip: no | Download the file first | Yes, natively |
| Concurrency | Optimistic. Retry on serialization error | Fine | **Unsafe**: ingest + API writing the same file means lost updates | Fine |
| Local dev parity | Plain `postgres` container in compose | DynamoDB Local | Same file | Same |

**Recommendation: Aurora DSQL in prod, Postgres 17 in docker compose locally.** You get the SQL database you prefer, a real GUI client, $0 at this volume, and nothing that conflicts with the no-RDS/no-NAT/no-IPv4 constraints.

DSQL constraints I'll design around (checked against the current AWS docs):
- One DDL statement per transaction, and DDL can't share a transaction with DML. The migration runner executes each statement on its own.
- `CREATE INDEX ASYNC` instead of `CREATE INDEX`. The runner rewrites this for DSQL only.
- No array columns, no triggers, no PL/pgSQL, no temp tables, no `TRUNCATE`. Lists go in child tables or `jsonb`, and all logic lives in Python.
- At most 3,000 modified rows per transaction. The backfill and the local→prod data copy write in batches.
- Foreign keys, `jsonb`, `uuid`, `timestamptz` and identity columns are supported. I'll use UUID primary keys because they distribute better. *(Re-checked 2026-11-04, §18: `jsonb` columns arrived in June 2026 and foreign keys in August 2026, so these hold today.)*
- Isolation is fixed at Repeatable Read with OCC, so every write path gets an idempotent retry wrapper.

Local Postgres is more permissive than DSQL. To keep them in step, a test lints every migration against the rules above, and in Phase 3 I'll run one smoke test against the real cluster.

Getting data from local into prod (the backfill runs in Phase 2, before AWS exists): `jobtracker db export` writes JSON and `jobtracker db import --target dsql` loads it in batches.

## 3. Repo layout

```
.
├── backend/
│   ├── pyproject.toml                # uv, Python 3.12, ruff, pytest
│   ├── src/jobtracker/
│   │   ├── core/                     # PURE domain. No boto3, no anthropic, no psycopg
│   │   │   ├── models.py             # dataclasses: Company, Application, Event, InterviewNote…
│   │   │   ├── stages.py             # stage machine, ghosted/follow-up computation
│   │   │   ├── filtering.py          # funnel: allowlist → heuristics → (LLM gate via port)
│   │   │   ├── extraction.py         # prompt + JSON schema + validation of LLM output
│   │   │   ├── calendar.py           # deterministic .ics / invitation parsing
│   │   │   ├── matching.py           # thread → domain → fuzzy → unassigned, alias learning
│   │   │   ├── pipeline.py           # orchestrates one email end-to-end via ports
│   │   │   ├── stats.py              # funnel, response rates, time-to-response, etc.
│   │   │   └── ports.py              # Protocols: Repository, MailSource, LLMClient, Clock
│   │   ├── adapters/
│   │   │   ├── db/                   # PostgresRepo (local + DSQL), migration runner, DSQL token auth
│   │   │   ├── imap_gmail.py         # IMAP + X-GM-RAW + X-GM-THRID, UID checkpointing
│   │   │   ├── anthropic_llm.py      # LLMClient over the Anthropic SDK (tool use / JSON schema)
│   │   │   └── ssm_secrets.py
│   │   ├── api/                      # FastAPI app + Cognito ID-token check
│   │   ├── cli/                      # Typer CLI: ingest, backfill, import, eval, db, app add…
│   │   └── lambdas/                  # ingest_handler.py, api_handler.py (thin)
│   ├── migrations/                   # 0001_init.sql …
│   └── tests/
│       ├── fixtures/emails/*.eml     # fake emails: Ashby/Lever/Greenhouse/Workable/ics/alerts…
│       └── test_core_is_pure.py      # fails if core imports boto3/anthropic/psycopg
├── frontend/                         # React + TS + Vite
├── infra/
│   ├── bootstrap/                    # state bucket (local state, run once)
│   ├── modules/                      # lambda, cdn, dsql, scheduler, budget, cloudflare_access…
│   └── prod/                         # root module, S3 backend with native lockfile
├── eval/                             # gitignored: labels.jsonl (real email metadata stays local)
├── docker-compose.yml
├── .env.example  backend/.env.example  frontend/.env.example
├── docs/plan.md
└── README.md
```

## 4. Data model (Postgres / DSQL)

Timestamps are stored as `timestamptz` in UTC and shown in `America/Buenos_Aires`. IDs are `uuid`.

**companies**: `id, name, normalized_name (unique), website, created_at`

**company_aliases**: `id, company_id → companies, kind (domain | address | display_name), value, learned_from (manual_assignment | application | seed), created_at`, unique on `(kind, value)`.
- Replaces `domains[]` and `aliases[]`, because DSQL has no array columns and this is easier to query anyway.
- Learning is ATS-aware. For `sluicebox.ai`, it learns the domain. For `no-reply@ashbyhq.com`, the domain and address are shared across all companies, so it learns the **display name** ("Sluicebox Hiring Team") instead, or the address when it is company-specific (e.g. `sluicebox@ashbyhq.com`).

**ats_providers**: `domain, provider (ashby | lever | greenhouse | workable | …), kind (ats | scheduler)`. Seeded data rather than code, so you can add one without a deploy. The funnel's allowlist = ATS domains ∪ every `company_aliases(kind=domain)`, so new companies join automatically.

**applications**: `id, company_id, needs_review (bool), role_title, job_url, job_description, source_ats, source_channel (direct | linkedin | referral | recruiter | other), seniority, stack (jsonb list), location, applied_at, current_stage, current_round, max_stage_reached, outcome (null | offer | rejected | withdrawn), last_event_at, next_interview_at, origin (manual | email | import), created_at, updated_at`
- `current_stage`, `max_stage_reached`, `last_event_at` and `next_interview_at` are a **projection** recomputed from events. They are never edited by hand.
- **ghosted is not stored.** It's computed at read time (`no events for GHOST_DAYS`, default 14, and not terminal), so it clears itself when a new email arrives.

**events** (append-only, never updated except for assignment):
`id, application_id (nullable → unassigned inbox), kind (email | manual | calendar), message_id (unique, nullable for manual), gm_thread_id, in_reply_to, references, from_address, from_name, subject, snippet (≤300 chars), received_at, event_type, stage_implied, round, interview_at, needs_reply, replied_at, summary, confidence, extraction (jsonb), model, filter_path, match_method (thread | domain | fuzzy | manual | created), assigned_by (auto | manual), created_at`
- `event_type`: `application_received, recruiter_outreach, screening_invite, interview_invite, interview_scheduled, interview_rescheduled, assessment, offer, rejection, info_request, withdrawal, other`.
- A manual stage change (e.g. "I withdrew") is itself an event, so the history stays complete.
- `replied_at` is set automatically when the ingester sees **my own message** later in the same Gmail thread (All Mail includes Sent), which clears it from pending follow-ups.

**processed_messages**: `message_id, uid, verdict (dropped | job | error), stage_dropped (exclude | heuristic | llm), processed_at`. This is the idempotency ledger. For non-job mail it stores **only** the message-id and verdict: no subject, no body.

**mail_sync_state**: `mailbox, uidvalidity, last_uid, updated_at`. If UIDVALIDITY changes, the next run re-scans, and dedupe by Message-ID keeps that safe.

**interview_notes**: `id, application_id, round, interview_at, interview_type (recruiter | technical | system_design | behavioral | take_home | onsite | other), interviewers, questions (jsonb list), self_rating 1–5, went_well, went_wrong, topics_to_study (jsonb list), created_at, updated_at`

**study_reports**: `id, created_at, model, input_summary, content_md`. Stored so you can compare reports over time.

## 5. Email pipeline

**Fetch**: connect to Gmail IMAP and locate All Mail through the `\All` special-use flag, not by name, because the folder is called "[Gmail]/Todos" in Spanish-locale accounts. Search with `UID <last+1>:*` plus `X-GM-RAW "-category:promotions -category:social -in:chats"`. The fetch pulls `X-GM-THRID`, headers, text body and `text/calendar` parts. Each message is deduped by Message-ID against `processed_messages`. The checkpoint advances only after a message commits.

**Funnel**:
1. **Hard excludes** run first: LinkedIn/Indeed/Glassdoor job alerts, "jobs you may like", newsletters (`List-Unsubscribe` + digest patterns). There's a rule-based exception for LinkedIn Easy Apply confirmations ("Your application was sent to X") if you use Easy Apply (see questions).
2. **Allowlist**: the sender domain is an ATS/scheduler domain or a known company domain → pass.
3. **Heuristics** (EN + ES keywords, scheduling links like Calendly/GoodTime/Ashby scheduling, `.ics` attachments, `Re:` on a known thread) → candidate.
4. **LLM gate**: a tiny yes/no prompt, run only on candidates from step 3.

**Extraction**: one structured-output call with a fixed JSON schema (company, role, event_type, stage_implied, round, interview_at, needs_reply, summary, confidence). Bodies are stripped of quoted replies and signatures and then truncated, to about 4k chars to start. The model comes from `LLM_MODEL` and defaults to a Haiku-class model. Output is validated against enums, and invalid output → confidence 0 → unassigned inbox. Email content is untrusted, so the LLM has no side-effecting tools and only fills fields. `.ics` / `text/calendar` parts are parsed with `icalendar` and **override** any LLM-extracted time.

**Matching cascade**: (1) Gmail thread id / In-Reply-To / References matches a known event → (2) sender domain, address or display-name alias → a company with exactly one active application. If the company has several, fuzzy-match the role among them only → (3) generic ATS sender: fuzzy-match company + role (`rapidfuzz`, normalized names without "Inc/Labs/HQ") against active applications above a threshold → (4) otherwise **unassigned**.
- When an `application_received` email has high confidence and no match, a new application is **created automatically** (`origin=email`), after a duplicate check.
- A manual assignment writes the alias (see the ATS-aware rule above) and reprocesses other unassigned events from the same sender.

**Stages**: `applied → screening → interviewing(round n) → offer | rejected | withdrawn`, with `ghosted` computed. Stages only move forward unless the new event is terminal, so a late "thanks for applying" never moves you backwards.

**Follow-ups**: `needs_reply && replied_at is null`, plus active applications with no news for `FOLLOWUP_DAYS` (default 7, configurable) that haven't reached `GHOST_DAYS` yet.

## 6. Auth

*(As planned with Cloudflare Access. Replaced by Amazon Cognito on 2026-11-05; see §19. The OAC, 401 and dev-bypass rules below still hold.)*

- The API middleware validates `Cf-Access-Jwt-Assertion` with PyJWT: an RS256 signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (JWKS cached, refetched on an unknown `kid`), plus `aud`, `iss`, `exp`/`nbf`, and the `email` claim equal to the allowed email. Anything else gets **401**. The JWT check is mandatory regardless of the layers below.
- **Defense in depth (proposal):** put the Function URL behind CloudFront OAC with `AuthType=AWS_IAM`, so a direct call to the Function URL gets 403 from AWS before the code even runs.
  - Gotcha: with OAC, POST/PUT/PATCH need an `x-amz-content-sha256` header with the body hash. The frontend fetch wrapper will add it.
- The static SPA on the `cloudfront.net` hostname stays reachable without Access. It holds no data and no secrets, and every `/api/*` call still needs the JWT.
- **Dev bypass**: `AUTH_DEV_BYPASS=true` is honored only when `APP_ENV=local`. The app **refuses to start** if the bypass is set while `AWS_LAMBDA_FUNCTION_NAME` exists, and Terraform never sets either variable.

## 7. Local development (Phase 1 focus)

`docker compose up` starts:
- `db`: postgres:17 with a named volume. It's exposed on `localhost:5432`, so DBeaver/DataGrip work locally from day one.
- `migrate`: a one-shot service that runs the migration runner.
- `api`: FastAPI under `uvicorn --reload`, with `backend/src` bind-mounted. Hot reload.
- `web`: the Vite dev server with HMR and `frontend/` bind-mounted. It proxies `/api` → `api`, so it's same-origin like prod.
- `ingest`: **only with `--profile ingest`**, because it reads your real inbox. It runs the same handler the Lambda runs, in a loop.

The CLI (`uv run jobtracker …`) talks to the same DB. Tests: core unit tests use an in-memory fake repo (fast, no Docker), and repo/integration tests run against the compose Postgres.

## 8. Cost (single user, steady state)

| Item | Expected |
|---|---|
| Lambda (~2,900 ingest runs/mo + API), arm64 | Always Free (1M req / 400k GB-s) |
| EventBridge Scheduler | Free tier |
| Aurora DSQL | Always Free (100k DPU + 1 GB). The budget alert catches surprises |
| S3 + CloudFront | Always Free tier |
| SSM Standard SecureString (aws/ssm key) | $0 |
| CloudWatch Logs (14-day retention) | Free tier |
| Terraform state bucket (S3 native locking, no lock table) | cents |
| Route 53 hosted zone | $0.50/mo **until Phase 4 deletes it** |
| Anthropic API | Most mail never reaches the LLM. I'll verify current Haiku pricing in Phase 1; expected well under $1/mo, with a backfill spike |
| AWS Budget | Alert at $5/month (actual + forecast) |

## 9. Phase deliverables (I stop after each one)

0. **This plan** and your answers to the questions below.
1. **Core + local**: the core package, PostgresRepo + migrations, IMAP adapter, funnel, extraction, `.ics` parsing, matching + alias learning, stats, CLI, docker compose with hot reload, and a **minimal web UI** (applications list, add/import form, unassigned inbox). The manual-load requirement is day one, so the UI starts now and gets polished in Phase 5. All tests use fake fixture emails. No real inbox, no paid API calls without your OK.
2. **Backfill + eval**: Notion CSV import, then backfill over a date range against your real inbox **after your OK** (into local Postgres). Imported applications are matched, never duplicated. Then the labeling CLI and an eval report:
   - Filter precision/recall overall and per funnel stage. Recall needs **random samples of dropped mail** too, so the sample is stratified.
   - Event-type accuracy with a confusion matrix, and matching accuracy.
   - Prompt tuning only against your labeled real emails.
3. **AWS infra**: Terraform bootstrap + prod (both Lambdas, Scheduler, DSQL, SSM, S3, CloudFront + OAC, an ACM cert in us-east-1, Budget, log retention). Plus the data copy from local into DSQL.
4. **Login + domain** *(was Cloudflare; changed 2026-11-05, §19)*: Cognito user pool and managed login, the SPA's sign-in, the API's token check, and `jobs.alexisherrera.dev` in Route 53 with the ACM certificate validated. Terraform does all of it; I verify with `dig` and curl.
5. **Dashboard**: the full UI, mobile-friendly. Stats page and "what should I study" report.
6. **Deploy + verify**: an end-to-end check, including 401 without a valid JWT on the `cloudfront.net` hostname and on the Function URL. With OAC, the Function URL returns 403.
7. *(Optional)* Chrome extension.

## 10. Phase 1 notes (as built)

- **Schema additions** vs §4: `events.company_hint_id` (an unassigned email whose company is known but whose application is ambiguous), `events.dismissed` ("not a job email" in the inbox), `applications.notes`, and `events.refs` (References, space-separated). See `backend/src/jobtracker/adapters/db/migrations/`.
- **Local Postgres runs on port 5433**, because another project's container already uses 5432.
- **First incremental run** continues after the highest UID in `processed_messages` (what a backfill already handled), so mail between the backfill and the first run isn't skipped. With nothing processed yet it stores the mailbox's current UID and processes nothing; history is the `backfill` command's job. *(Changed 2026-10-19; it used to always start at "now".)*
- **Job boards** (LinkedIn, Indeed, Glassdoor, …) and ATS domains never become a company's domain alias.
- **Failure policy**: a transient LLM error stops the run without advancing the checkpoint, so the next run retries. A refusal or malformed output is recorded and skipped, so one bad email can't block the queue.
- **Not done yet**: the DSQL connection factory (IAM token auth) and Lambda packaging are Phase 3 *(done, §18)*. The stats page and the "what should I study" report are Phase 5. The API already serves `/api/stats`.

## 11. Post-review additions (2026-10-19)

- **Salary**: `applications.salary_min` / `salary_max` (yearly), `salary_currency`, and `benefits` (free text). Migration `0003`.
- **Paste assistant** replaces the CSV card in the UI. `POST /api/paste` sends the text to the LLM (structured output, `LLM_PASTE_EFFORT`, default medium) and returns, per extracted record, options (update candidate(s) / create new) with per-field diffs labelled `fill | append | change`. It writes nothing. The UI applies only the ticked changes through the regular create/PATCH/stage endpoints. Overwrites (`change`) start unticked and are listed explicitly before apply.
- **Campaigns** (`campaigns`: name, started_on, ended_on, notes; migration `0004`): membership by applied date (local tz), computed at read time. They can't overlap, and creating one ends an ongoing earlier one the day before. `?campaign=<id|all>` scopes `/api/applications` and `/api/stats`; `/api/dashboard` includes the current campaign's summary. The first real campaign is "Sep 2026" starting 2026-09-15 (the user's first interview was ~2026-09-21, which is a check for the backfill).

## 12. Frontend redesign (2026-10-19, before the eval)

The user asked to improve the UI before the Phase 2 eval, which moves to the end of Phase 2.

- **Stack**: Tailwind v4 + shadcn/ui (Radix, "nova" preset, components copied into `frontend/src/components/ui/`), lucide icons, sonner toasts, `@dnd-kit/core` for the board, `d3-sankey` for the flow chart. The theme is a small local provider (`src/lib/theme.tsx`, class on `<html>`, applied in `index.html` before first paint).
- **Data refresh**: every mutation calls `useRefresh().bump()` and every `useAsync` reloads. No client cache; data is hundreds of rows.
- **Applications**: Board (columns = statuses with counts; ghosted is computed, so it isn't a drop target; columns collapse) and All (sortable table + status chips with counts). Drag = `POST /stage`, optimistic, with undo. Cards and rows open a side sheet (`?open=<id>`), and `/applications/:id` renders the same `ApplicationView`, where every property edits inline (salary included).
- **Review queue** (`ReviewDialog`): keyboard-first walk through `needs_review` applications.
- **Follow-ups**: `stats.awaiting_reply` hides reply requests on closed or on-hold applications and requests followed by any later event on the same application. `POST /api/events/{id}/replied` clears one by hand.
- **Flow**: `stats.flow` (in `/api/stats`) builds the sankey from the progress stages each application actually reached (from its events, so a skipped screening isn't invented) plus where it stands now: in progress / no reply yet / on hold / ghosted / rejected / withdrawn / offer. The chart (`FlowChart.tsx`) lays it out one column per stage, with each stage's exits in the next column, so nothing crosses. A skipped stage passes through an invisible waypoint drawn as one continuous band. Colors (`--flow-*` in `index.css`) were checked with the dataviz palette validator: an indigo ramp for progress, neutral grays for "no answer", hue only for offer / on hold / rejected, and every node labelled with its count and share.
- **Scan inbox now**: `POST /api/scan` runs `run_incremental` in the API process (local only, `APP_ENV=local`), guarded by a Postgres advisory lock (409 if a scan is running). `GET /api/scan` gives `last_scan_at` (`mail_sync_state.updated_at`, now touched on every run). Aurora DSQL has no advisory locks, so in Phase 3 the button should invoke the ingest Lambda (reserved concurrency 1) instead. *(Done in Phase 3, §18; the lock became a lease in DSQL, because the account can't reserve concurrency.)*
- **Fill from a recruiter chat** (`PasteFill.tsx`, inbox *New application*): reuses `POST /api/paste` and takes the record's *create new* option (all extracted fields, salary already yearly) to fill the form, which is the review step. Filled fields are tagged, replacements listed, undo restores; a strong existing match (score ≥ 80) offers *assign to it instead*.
- **Salary input** (`SalaryInput.tsx`): live thousands separators, `k`/`m` shorthand, currency list, per year / per month (stored yearly), and a preview of what's saved.

## 13. Phase 2 prompt work (2026-10-20)

- **Paste, unknown company**: a record with a role but no hiring company (typical of an agency post) is kept with `company = null`; only records with neither company nor role are dropped. It never matches an existing application (a role alone is too weak). The inbox fill keeps the form's company; *Paste anything* asks for it. The schema has an `agency` slot so an agency name has somewhere to go besides `company`, and it ends up in notes.
- **Paste regression**: synthetic fixtures in `backend/tests/fixtures/paste/` (offline, FakeLLM). Real pastes and their approved `<name>.expected.json` stay in the gitignored `eval/paste/`; `jobtracker eval paste` runs the real prompt over them (paid) and writes `<name>.actual.json`.
- **Scope change (2026-10-20)**: the app stays **local** for now (no prod release planned). The Phase 2 eval moves from gate/extraction precision-recall to **filling application details from emails**: stages, matching and events are cheap to do by hand with few applications; filling the details isn't. One call per application (all its emails, oldest first) through the paste prompt scoped to that application plus an emails note; the stage is dropped from the proposal.
- **`jobtracker app fill-details`** (no UI: the user preferred one script over a button per application): re-fetches each application's emails by Message-ID (`X-GM-RAW rfc822msgid:`, read-only), fills only empty fields plus additions to stack/notes (the review screen's pre-ticked defaults), and lists would-be overwrites without applying them. Bodies are never stored. The PATCH logic moved to `services.update_fields`, shared with the API.
- **Review = corrections in the app**: after the script runs, the user fixes what's wrong inline; whatever is left untouched counts as correct in the snapshot.
- **Details eval** (`jobtracker eval details collect | snapshot | run`, `backend/src/jobtracker/evals/details_eval.py`): ground truth is what the user saved after reviewing, snapshotted per application. Scored per field as correct / wrong fill / missed / correctly empty; wrong fills matter most. Long text uses fuzzy similarity, stack uses list overlap. Each run saves `reports/<time>.json` and prints the change in wrong fills and misses against the previous run.

## 14. Google Calendar sync and per-interview notes (2026-10-20)

- **Why**: a second source for interviews (how many, what's next, what just happened) and notes per interview, not per process.
- **Auth**: OAuth Desktop client, scope `calendar.readonly`, browser consent from the CLI (`jobtracker calendar login`). The refresh token lives in `oauth_credentials` in the local DB, so the API container needs no file mount. The consent screen is still in *Testing* (7-day token expiry) until the user publishes it; README has the steps. The secret iCal URL was considered and rejected: whole-calendar bearer URL, no incremental sync, undocumented freshness.
- **Sync**: `events.list` on `GOOGLE_CALENDAR_ID` (default `primary`) with `singleEvents` + `showDeleted`; a full sync from the first campaign's start (else 180 days), then `syncToken`; HTTP 410 → full sync. Runs from `calendar sync`, from `ingest` (each loop), and from the scan button. No push notifications: they need a public HTTPS endpoint.
- **Schema** (migration `0007`): `interviews` (application nullable → review queue, source calendar | email | manual, status scheduled | cancelled, calendar ids, attendees jsonb, `event_id` → the invite email), `calendar_sync_state`, `oauth_credentials`, and `interview_notes.interview_id` + `body` (free text).
- **One row per interview** (`core/interviews.py`): `services.recompute` turns every interview time in an application's emails into a row (`sync_email_interviews`); a calendar event in the same slot (±90 min, same application) takes that row over. A `rescheduled` email cancels the earlier time in its thread. Rows from emails that moved or were dismissed are deleted unless they have notes.
- **Matching** a calendar event: an assigned invite email within ±10 min → attendee address / company domain alias → a company name (≥4 chars) in the title; several active applications at that company → role vs. title. Unmatched events are kept only if the title reads like an interview or an ATS/scheduler is involved; everything else is never stored. Manual assignment learns the attendees' domains.
- **Projection**: with interviews, `next_interview_at` comes from scheduled interview rows, and a past interview counts toward `last_event_at` (the ghosted timer). Stage is unchanged: interviews never move it.
- **UI**: the application page's *Interviews & notes* (interview list → filter notes to one interview; add by hand; edit round/type; hide); dashboard *Upcoming* and *Just happened* (last 14 days, flags missing notes), an *Interviews done* tile, and *Calendar interviews to match* in the inbox. The scan button also syncs the calendar when connected.
- **Old notes** have no `interview_id` and show as *General* until edited to point at an interview.
- **Invite UID** (migration `0008`, same day): the pipeline stores the `.ics` UID on email events (`events.ical_uid`). Emails sharing a UID are one interview row (the newest time wins, an `.ics` CANCEL cancels it), and a calendar event with that `iCalUID` matches the application (`invite`) and takes the row over whatever the times. This came from a real case: an invite for the 12th, moved to the 8th in the calendar, left a phantom. Emails processed before 0008 have no UID.
- **General talks**: `interviews.general` + `interviews.notes`. A recruiter or agency talk about roles, tied to no application. Out of the review queue, listed in upcoming / just happened and on the new **Interviews** page, never counted in `interviews.counts`. Its notes are inline text because `interview_notes.application_id` is NOT NULL (dropping that isn't DSQL-safe). Marking one general leaves existing notes on their application as general notes.
- **Agencies**: `nowit.io` (Now IT, recruiting for Tapi) added to `ats_providers` as an agency.


## 15. Notes editor and process timeline (2026-10-20)

- **Notes editor** (`frontend/src/NotesEditor.tsx`): a large dialog over any page (`?interview=<id>`, `?note=<id>`, `?note=new:<application id>`), plus its own pages (`/interviews/:id`, `/notes/:id`), like an application's sheet and page. Tiptap (pinned 3.31.4) with notes **stored as Markdown** in `interview_notes.body`, so they stay readable for the study report. Autosave (debounced, serialized; the last change is saved on close). The side panel keeps the structured fields (rating, interviewers, topics, questions, went well/wrong). An interview with several notes shows tabs. A general talk edits `interviews.notes`. Clicking an interview anywhere (drawer, Interviews page, dashboard) opens it. New endpoints: `GET /api/interviews/{id}` (with application and notes) and `GET /api/notes/{id}`.
- **Process plan** (migration `0009`, `process_steps`): the steps the recruiter described, entered by hand per application. Each has a position, a name, a kind (`interview | take_home | other`, guessed from the name: "challenge" becomes a take-home, but "challenge defense" stays an interview), `optional` ("4–5 rounds"), `link` (`auto | manual`) + `interview_id` (no FK: email interviews can be deleted by a recompute), and `done_at` (marked done by hand).
- **Timeline** (`core/process.py`, built on read, returned as `timeline` in `GET /api/applications/{id}`): Applied → steps → outcome.
  - Hand links win. Every other *interview* step takes the next unused interview in time order, after the previous matched step and before the next hand-linked one. Take-homes never take an interview.
  - A hand link to nothing means "hasn't happened yet". A hand link to an interview that's gone (cancelled, hidden, reassigned) falls back to automatic.
  - A pending step before one that happened counts as done with no date (the take-home before its defense, a call off the calendar). If it's optional, it counts as skipped.
  - Interviews no step took appear between the steps, by time ("not in the plan"), and can be assigned to a step from the timeline.
  - With no plan, the interviews are the steps. With nothing at all, it's just "Applied", then the outcome once closed.
  - The outcome (rejected / withdrawn / offer / ghosted / on hold) sits where the process stopped; planned steps after it show as not reached.
  - The timeline never moves the stage, and marking a take-home done doesn't reset the ghosted timer.
- **AI reads the process** (same day): the paste/fill schema has `process_steps` (name, kind, optional) and the prompt asks for the hiring process in order. It's proposed as a *fill* only when the application has no plan. An existing plan is never replaced, since its links and done marks would be lost. Every apply path goes through `update_fields` (PATCH, `fill-details`) or `create_application` (POST, including the inbox form, which shows the steps before saving). `fill-details` skips applications that already have details unless `--all`.
- **Flow chart**: exits sit next to the stage they left, so an outcome reached from two stages showed up twice as "Rejected 2 · 13%". When that happens, each label now says which stage ("Rejected after applying", "Rejected after interviews"). Unifying them into one node would have meant bands crossing the chart.

## 16. Dashboard order and chart drill-down (2026-10-20)

- **Upcoming interviews up top**: when any are scheduled, they sit right under the KPI tiles (moved below them after review), the next one up front (day, time, Notes, Join call) and the rest as rows. With none, the card goes back to the lower grid as "None scheduled". A month calendar sits to the right (only then, and only from `lg`), spanning the KPI tiles and the upcoming card, since a month is about as tall as both (stretching the upcoming card to a calendar's height left it mostly empty). Interview days only, prev/next month, each day linking to the calendar page on that day.
- **Chart drill-down**: `stats.flow.paths` gives each application's walk (`applied → interviewing → rejected`). Clicking a node or a flow opens `/applications?view=all&flow=<key>`, where the key is a node id (`interviewing`, `rejected@interviewing`) or a flow (`applied->interviewing`), matched by `inFlow` in `FlowChart.tsx`. The filter shows as a removable chip and applies to the board too. The chart's how-to-read text is gone.
- **How interviews went** (`core/insights.py`, `GET /api/insights?campaign=`), on the dashboard after the to-do lists. Every interview that happened gets an outcome: `advanced` if a later interview (or an offer) followed, else the application's status (rejected / withdrew / no answer when ghosted / waiting). Grouped by type (set by hand, else guessed from the title, else "not set"), with the mean self-rating from notes for advanced vs. not. Each type opens to its interviews with a type picker; the notes editor's header has the same picker. *Tried and dropped after review (2026-10-20)*: step-by-step conversion and a weekly pace card (not useful), and grouping by round (the first round is a recruiter call in one process and a technical one in another, so round numbers don't compare).
- **Calendar page** (`/calendar`, `GET /api/activity?campaign=`): *Month* shows interviews (filled when done, outlined when scheduled; general talks gray) and per-day counts of applied / first reply / rejected / withdrew / offer, with a side panel for the selected day. *Processes* draws each application from applied to its final answer (or today): solid while moving, faint since its last news, gray once closed with an end cap for the outcome, plus first-reply ticks and interview dots that open the notes editor. First replies are amber, not the board's sky: the palette validator failed sky against applied's blue.

## 17. Calendar through a service account (2026-11-03)

- **Why**: "Publish app" needs a public home page and privacy policy URL on an authorized domain. The user doesn't want them on the resume site (`alexisherrera.dev`), and `jobs.alexisherrera.dev` is private and not deployed. Staying in *Testing* means a new login every 7 days, and an OAuth login can't be renewed from a Lambda anyway.
- **How**: a service account with **no IAM roles**; the user shares the calendar with it ("See all event details"). The key is a setting, `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 of the JSON, one line with nothing to escape), like the other secrets: `.env` locally, an SSM SecureString in Phase 3. `GOOGLE_CALENDAR_ID` must then be the calendar's real ID: `primary` would be the account's own empty calendar, so that combination is a config error.
- **`jobtracker calendar use-service-account KEY_FILE`** checks access (`calendars.get`: name only, no events), writes both values into `.env` (`chmod 600`), and moves stored interviews from the old ID (`primary`) to the new one, dropping the old sync token. The next sync is a full one that updates the same rows (event IDs are per calendar, not per reader), so notes stay attached.
- **Which login**: the service account when configured, else the stored OAuth login (kept as a fallback). `GET /api/calendar` reports `auth`. Error messages say which one failed: an unshared calendar is a 404 naming the account to share with.
- **Lambda ingest** now syncs the calendar after the mail, service account only. A calendar error is logged and returned, never fails the mail run.
- **Trade-off accepted**: a key that never expires, stored next to the other local secrets. To cut access, unshare the calendar or delete the key; rotation is a new key plus the same command. Events marked private aren't visible to the account.

## 18. Phase 3 as built (2026-11-04)

Branch `phase-3`. Nothing has been applied to AWS yet: every `terraform apply` waits for a reviewed plan.

**DSQL re-checked against the current docs** (user guide + release notes, 2026-11-04), migration by migration:
- **Still fine as written**: `jsonb` columns (`applications.stack`, `events.extraction`, `interviews.attendees`, `oauth_credentials.data`, notes' lists) are supported since June 2026, but not indexable (we don't index them). Foreign keys (`REFERENCES`) are supported since August 2026, including `NO ACTION`. `ADD COLUMN IF NOT EXISTS <name> <type>` and `ON CONFLICT` are supported. No migration file changed.
- **`CREATE INDEX` must be `CREATE INDEX ASYNC`** (the runner already rewrote it). New: an async build returns a job id, and the runner now waits for it (`sys.wait_for_job`), so `ON CONFLICT` and the next statements see a valid index. A failed build stops the run and says to drop the `INVALID` index.
- **OCC**: a DDL bumps the catalog version, so the next statement can get `40001 / OC001`. On DSQL the runner retries each statement (all are idempotent). The API maps any `SerializationFailure` (`OC000`, usually a write racing the ingest run) to **409 "try again"**. Its transaction rolled back, so a retry is safe. This is simpler than §2's "retry wrapper on every write path". The ingest run already stops without advancing the checkpoint, and the next run redoes that email.
- **Limits that matter here**: 3,000 rows and 10 MiB per transaction (the copy writes ≤500 rows / ~4 MiB per batch), 5 minutes per transaction (one email's processing, LLM call included, is one transaction), 60 minutes per connection (we open one per request / run), 1 KiB index keys (`message_id`, alias values: far below), 1 MiB per `text`/`jsonb` value, one database named `postgres`, `C` collation, Repeatable Read only.
- **Not in DSQL and not used**: advisory locks (the scan button changes, below), `TRUNCATE`, temp tables, triggers, PL/pgSQL, sequences (allowed now, but we keep UUIDs). The migration lint (`test_guardrails.py`) now also rejects `ADD COLUMN … DEFAULT/NOT NULL/REFERENCES`, `ADD CONSTRAINT` without `NOT VALID`, `CONCURRENTLY`, extensions and custom types.

**Connection factory** (`adapters/db/connect.py`): with `DSQL_ENDPOINT` set, `PostgresRepo.open(settings)` signs an IAM token with boto3 (local signing, 15 min, only needed for the handshake) and connects with `sslmode=verify-full` against certifi's bundle. Otherwise it uses `DATABASE_URL`, so local and docker compose work exactly as before. The official `aurora-dsql-python-connector` was skipped: it's ~10 lines with boto3, which we need for SSM anyway.

**Database roles**: migrations and grants run as `admin` from the laptop (your SSO profile, `dsql:DbConnectAdmin`). Each Lambda logs in as its own role (`jobtracker_api`, `jobtracker_ingest`), mapped to its IAM role with `AWS IAM GRANT`, with `SELECT, INSERT, UPDATE, DELETE` on the public tables plus default privileges for future ones (`jobtracker db grant-roles`). The Lambdas can't run DDL.

**Lambdas** (`infra/modules/lambda_function`, `infra/prod/lambdas.tf`): one zip for both (`infra/scripts/build-lambda.sh`: `uv export` → Linux arm64 wheels for 3.12 → 38 MB zipped, under the 50 MB direct-upload limit; uvicorn/typer left out). It was smoke-tested in the `public.ecr.aws/lambda/python:3.12-arm64` image: `/api/health` 200, `/api/applications` without a JWT 401. `api`: 1024 MB, 60 s. `ingest`: 512 MB, 600 s, no reserved concurrency (see the lease below), async invokes with 0 retries and a 10-minute max event age. Each has its own role (trust limited to that function ARN in this account), a 14-day log group created before the function, and an inline policy: `dsql:DbConnect` on the cluster, `ssm:GetParameters` on its own parameter ARNs, and for `api` `lambda:InvokeFunction` on `ingest`. Cross-checked with `iam-policy-autopilot` (it finds the SSM and Lambda calls; `DbConnect` is hand-added because token signing makes no API call).

**Scheduler**: `rate(15 minutes)`, created **DISABLED** (`ingest_schedule_enabled = false`) until the secrets are in SSM and the data is copied. A run is never retried (the next one resumes from the checkpoint). It lives in its own schedule group, `jobtracker`: Scheduler's trust condition (`aws:SourceArn`) can only name a group, never a schedule, and the first apply failed on exactly that ("The execution role you provide must allow AWS EventBridge Scheduler to assume the role").

**Secrets**: SSM SecureStrings `/jobtracker/prod/{GMAIL_APP_PASSWORD, ANTHROPIC_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY}` with the `aws/ssm` key. **Terraform doesn't manage them.** The provider reads a parameter's decrypted value back into state on every refresh, even with `ignore_changes`. `jobtracker aws push-secrets` writes them from `.env` instead, so they're never on a command line, in Terraform or in the Lambda configuration. The Lambdas get only `SSM_PARAMETER_PREFIX` + `SSM_SECRETS` (names) and read the values once per cold start (`adapters/ssm_secrets.py`). `api` gets the Anthropic key (paste assistant) and the Google key (calendar status / sync button), never the Gmail password. In prod `GOOGLE_CALENDAR_ID` is the Gmail address, and the OAuth fallback is off (the API ignores a stored login when `APP_ENV=prod`).

**Auth until Phase 4**: `CF_ACCESS_AUD` is a placeholder (`not-configured-until-phase-4`), so the verifier starts and every `/api/*` call is 401 (no token, or a token whose `aud` can't match). No bypass exists in prod: Terraform never sets `AUTH_DEV_BYPASS`, and the app refuses it inside Lambda anyway.

**CloudFront** (`cdn.tf`): a private S3 bucket (SSE-S3, owner-enforced, TLS-only policy) and the Function URL (`AuthType=AWS_IAM`), both through OAC. The Lambda permission grants both `InvokeFunctionUrl` and `InvokeFunction` (`invoked_via_function_url`), limited to this distribution, as the current CloudFront docs require. `/api/*`: caching disabled, all viewer headers except Host, 60 s origin timeout. SPA routes go through a CloudFront Function (paths without a file extension → `/index.html`). Custom error pages would also have rewritten the API's own 403/404. The managed security-headers policy is on both behaviors. Served on `*.cloudfront.net` with CloudFront's certificate for now.
- **Frontend**: every write request (POST/PUT/PATCH/DELETE) now sends `x-amz-content-sha256`, with the hash of `""` when there's no body (Lambda rejects unsigned payloads). Before, it was only sent with a body.

**ACM**: `jobs.alexisherrera.dev`, DNS validation, deliberately no `aws_acm_certificate_validation`, so it stays `PENDING_VALIDATION` and nothing waits. The CNAMEs are the `acm_validation_records` output, for Phase 4.

**Budget**: $5/month, email alerts when actual or forecasted spend passes 100%. **Logs**: 14 days on both function log groups.

**Scan button in AWS** (§12): DSQL has no advisory locks, so with `INGEST_FUNCTION_NAME` set (prod) `POST /api/scan` invokes the ingest Lambda synchronously (`{"trigger": "scan"}`, one attempt, wait 50 s) and returns its report in the same shape as locally. A run already going (the lease is taken, below) → 409 "already running"; Lambda throttling → 502 "try again in a minute". A function error → 502. Still running after 50 s → `running: true`, and the UI says new mail will show up when it's done (the run carries on). The ingest run syncs the calendar too. Locally nothing changed: in-process run + advisory lock.

**Data copy** (`jobtracker db copy-to-dsql`, `adapters/db/copy.py`): reads local Postgres in one read-only Repeatable Read transaction (a consistent snapshot; it can't write locally). It writes DSQL in FK order, ≤500 rows / ~4 MiB per transaction, each batch retried on OCC. `ON CONFLICT DO NOTHING` by default; `--overwrite` updates existing rows. It includes **`processed_messages` and `mail_sync_state`**, so the first Lambda run continues after the last local UID and never re-reads or re-pays for old mail. It excludes `oauth_credentials` (the refresh token stays local) and `schema_migrations`. It refuses to run if the two databases' migrations differ, and a test fails if a new table isn't listed. After the copy, use one side only: if local `ingest` / scan keeps running, both pay for the same new mail and diverge.

**Layout vs §3**: `infra/modules/` has only `lambda_function` (used twice). DSQL, CDN, scheduler, budget and cert are single files in `infra/prod/`, since each is used once.

**One ingest run at a time: a lease, not reserved concurrency** (changed 2026-11-04, after the first read-only checks): the account's Lambda concurrency limit is **10**, and AWS won't reserve any while that leaves fewer than 100 unreserved, so `reserved_concurrency = 1` would fail the apply. Instead migration `0010_ingest_lease.sql` adds `ingest_lease (name, holder, acquired_at, expires_at)`. `handlers.ingest` takes it with one conditional upsert (`ON CONFLICT … DO UPDATE … WHERE expires_at <= now OR holder = me RETURNING`) *before* it connects to Gmail; no row back, or a DSQL OCC failure (two runs writing the same key at once: only one commits), means another run holds it, and the run returns `{"busy": true}` without reading mail or calling the LLM. The holder is the Lambda request ID; the lease lasts the invocation's remaining time plus 60 s, so one left by a crashed or timed-out run frees itself about a minute after Lambda kills it. It's released in `finally`, and only by its holder. Locally nothing changed: the scan button still uses the advisory lock (the table exists but stays empty), and `db copy-to-dsql` skips it. A quota increase to 1,000 is still possible later but not needed.

**Applied 2026-11-04** (31 resources; the user runs each `terraform apply` on a saved plan). Checked right after, from outside: the schedule is `DISABLED`, the cluster `ACTIVE` with deletion protection; through CloudFront `/api/health` 200, `/api/applications` 401, an empty-body `POST` with the empty-payload hash 401 from the app (so OAC signs it and Lambda accepts it); the Function URL called directly 403; `/` 403 until the SPA is deployed.

**First migrate on DSQL** found that `sys.wait_for_job` is a procedure: `SELECT` fails with "is a procedure… use CALL", and `CALL sys.wait_for_job('<id>')` answers one row, `succeeded` (bool). The runner now calls it that way (the job id is checked against `^[a-z0-9]+$` because it goes in as a literal). The failed run had created only `schema_migrations`, `companies` and one finished index and recorded nothing, so the re-run picks up from there.

**First `grant-roles`** created `jobtracker_api` and its IAM mapping, then failed on `GRANT USAGE ON SCHEMA public` ("feature not supported on system entity"): DSQL's `public` belongs to `pg_database_owner`, and its ACL already gives PUBLIC `USAGE` (`=U/pg_database_owner`). `grant-roles` now issues that grant only if `has_schema_privilege` says a role lacks it, and sets `ALTER DEFAULT PRIVILEGES … ON TABLES` without `IN SCHEMA public` (it covers `admin`'s new tables in any schema). Tables are owned by `admin`, so the table grants are `admin`'s to give.

**Data in DSQL (2026-11-04)**: `db migrate --dsql` applied 0001–0010 (about 4 minutes, mostly serial index builds; 28 indexes, all valid); `grant-roles` made `jobtracker_api` and `jobtracker_ingest` (DML on all 16 tables, nothing else, default privileges for `admin`'s future tables); `push-secrets` wrote the three SecureStrings (aws/ssm, Standard; the Google key is 3,160 bytes of the 4 KB limit); `copy-to-dsql` copied 640 rows, including 519 processed messages and the checkpoint `[Gmail]/Todos` UIDVALIDITY 655123241, last UID 29416 (the `[Gmail]/All Mail` row is a stale one from before locale-independent mailbox detection), plus the calendar sync token. The local database had to get `0010` first: the copy refuses when the migration lists differ.

**First run in AWS (manual invoke, 2026-11-04)**: continued from UID 29416 (`started_fresh: false`), saw 3 new messages, all dropped by the heuristics, **0 LLM calls**; last UID 29429; calendar incremental (`full_sync: false`, 1 event seen, skipped). 22 s billed, 216 of 512 MB used, no errors in the log; the lease row was gone afterwards. This proves the ingest role's IAM login to DSQL, SSM secrets at cold start, IMAP from Lambda and the service-account calendar. At ~22 s a run, every 15 minutes is about 32k GB-s a month, 8% of Lambda's free 400k.

**Schedule on**: `ingest_schedule_enabled` now defaults to `true` (a `-var` would be reverted by the next plan without it). First 24 h (to 2026-11-05): 88 runs, 8 messages seen, all dropped, 0 LLM calls, 0 errors, none busy; longest run 44 s, at most 218 MB; last UID 29443.

**SPA deployed (2026-11-05)** with `infra/scripts/deploy-frontend.sh`: `/`, `/index.html` and a deep link 200 `no-cache`; hashed assets `max-age=31536000, immutable`; `/api/applications` still 401.

**Not verified yet**: the lease refusing a second run under DSQL's OCC. *(The `api` role's DSQL login was verified on 2026-11-05 with the first real sign-in, §19.)*

## 19. Phase 4: Cognito instead of Cloudflare (2026-11-05)

**Why the change.** Cloudflare Access only protects hostnames that Cloudflare proxies, and on the free plan that means moving the whole `alexisherrera.dev` zone to Cloudflare's nameservers (partial/CNAME setup is Business and up, subdomain zones Enterprise). The zone is in Route 53, registered there, and another project's Terraform (`tapi.alexisherrera.dev`) already manages records in it; more AWS pages are coming. Moving DNS would push every future record out of Terraform-on-Route 53. Cognito keeps DNS where it is: this stack only adds its own records.

**Login** (`infra/prod/cognito.tf`):
- User pool `jobtracker`, Essentials tier (free up to 10,000 monthly active users; managed login needs it), deletion protection on. Sign-in with email, case-insensitive. **Sign-up off**: the only user is `owner_email`, created by Terraform, which makes Cognito email a temporary password (Terraform never sees a password).
- **MFA required, authenticator app (TOTP) only.** Email codes would need SES; SMS costs money. Managed login asks for a new password and shows the QR code at the first sign-in.
- Password: 12+ characters, upper, lower, number. "Forgot password" sends a code to the verified email (Cognito's default sender).
- Managed login (v2) on `https://alexisherrera-jobs.auth.us-east-1.amazoncognito.com`. An app client made through the API has no style until a `aws_cognito_managed_login_branding` exists (Cognito's defaults here), and its pages don't load without one.
- App client `jobtracker-web`: public (no secret), authorization code + PKCE, scopes `openid email`, returns only to `https://jobs.alexisherrera.dev/auth/callback`, logout to `/`. ID and access tokens 60 minutes, refresh token 7 days, revocation on.

**API** (`api/auth.py`): validates the **ID token** in `X-Id-Token`: RS256 against the pool's JWKS (cached, refetched on an unknown `kid`), `iss` = the pool, `aud` = the app client, `token_use = id`, `exp`/`iat`/`sub` present, and `email` = `ALLOWED_EMAIL` with `email_verified = true`. Anything else → 401. Not `Authorization`: OAC overwrites it with the SigV4 signature for the Function URL. `GET /api/auth/config` (public) tells the SPA the authority, client ID, login domain and app URL, or `{"mode": "none"}` with the local dev bypass. The bypass rules (§6) are unchanged.

**SPA** (`auth.ts`, `AuthGate.tsx`, `oidc-client-ts` 3.5.0): before rendering, load the config; on any host other than `APP_URL` (the bare cloudfront.net name), move to `APP_URL`, since Cognito only returns to registered URLs; finish the redirect on `/auth/callback` and go back to the page you asked for; otherwise sign in when there's no valid session. Tokens live in localStorage (the page loads no third-party script) and renew with the refresh token. A 401 signs in again once; a second 401 right after (e.g. a valid login for another email) shows the error instead of looping. **Sign out** revokes the refresh token, clears the tokens and calls Cognito's `/logout`.

**Domain** (`infra/prod/dns.tf`): reads the existing `alexisherrera.dev` zone (doesn't own it), adds ACM's validation CNAME and waits for `ISSUED`, then CloudFront gets `aliases = [jobs.alexisherrera.dev]` with that certificate (SNI, TLS 1.2_2021), and `jobs` A/AAAA alias records point at the distribution. `tapi`'s records are untouched. The certificate was requested on 2026-11-04 21:18 UTC; ACM gives up on DNS validation after 72 hours, so the apply has to happen before 2026-11-07 21:18 UTC (otherwise the certificate has to be replaced).

**Applied 2026-11-05** (9 added, 3 changed; the bucket policy came out identical). Checked from outside: `jobs` A/AAAA → CloudFront, `tapi` unchanged; certificate `CN=jobs.alexisherrera.dev` issued by Amazon (renews through the kept CNAME); `/` and `/api/health` 200, `/api/auth/config` 200 with the pool, `/api/applications` 401 without a token, the Function URL directly 403, the login page 200. The pool's discovery document lists a `revocation_endpoint`, so sign-out's revoke works. Then the user signed in (temporary password → new password → authenticator) and the dashboard loaded with real data: the first time the `jobtracker_api` role logged in to DSQL. No errors in the API's log.

**Gaps**: there's no self-service reset for a lost authenticator (use an app that backs up its codes). The SPA shell is public, as before; it holds no data.


## 20. Job discovery page (2026-11-11)

Status: **approved 2026-11-11** (consultancies hidden, marketplaces dropped). **Phase (a) built 2026-11-11, reviewed and committed 2026-11-12** (see "Phase (a) as built" at the end). Next steps: `docs/handoff-job-discovery.md`.

A **Discover** page that lists new open positions from a few sources, filtered first by cheap rules and then by one Haiku call per new posting, sorted by fit. Small on purpose: no eval framework, no tracing tables, no MCP or RAG (rejected 2026-11-11 as overengineering for this little data).

### Sources (checked 2026-11-11)

**JSearch** (OpenWebNinja, Google for Jobs: LinkedIn, Indeed, Glassdoor, JobLeads, BeBee…). Verified with two real calls:
- `GET https://api.openwebninja.com/jsearch/search-v2` with header `x-api-key: $JSEARCH_API_KEY`. Params: `query`, `cursor` (from `data.cursor`), `num_pages` (1–20, **each page of up to 10 jobs is one request**), `country` (ISO code, **defaults to `us`**), `language`, `date_posted` (`all|today|3days|week|month`), `work_from_home`, `employment_types` (`FULLTIME,CONTRACTOR,PARTTIME,INTERN`), `job_requirements`, `radius`, `exclude_job_publishers`, `fields`. The response header `x-rapidapi-billing: Queries=1; Requests=1` reports what a call cost.
- Response: `data.jobs[]` with `job_uid` (short, e.g. `WNJ2-ewtTS8bMOHoAAAAAA==`; `job_id` is a ~400-char token), `job_title`, `employer_name`, `employer_website`, `job_publisher`, `job_location`, `job_city`, `job_country`, `job_is_remote`, `job_employment_type`, `job_posted_at` (text), `job_posted_at_datetime_utc`, `job_min_salary`/`job_max_salary`/`job_salary_period`/`job_salary_string`, `job_description` (seen up to 5,500 chars, often a ~480-char snippet), `job_apply_link`, `apply_options[]`.
- **Argentina quirks** (`country=ar`): `language` must stay the default `es`; `language=en` returned **0 jobs**. Then `job_posted_at` is Spanish text (`hace 4 días`) and `job_posted_at_datetime_utc` is null, `job_employment_type` is Spanish (`Tiempo completo`), `job_is_remote` was `false` even for titles that say "Remote LATAM", and no salary came back. So the parser reads `hace N horas/días/semanas` (and the English forms), ignores `job_is_remote`, and leaves remote/location judgment to the LLM.
- The first `ar` page was 10 real but noisy results: mostly reposts through JobLeads/BeBee/Expertini, several from nearshore consultancies (AgileEngine, Stefanini, Softgic, Truelogic) and recruiters (Pragmatike, Hire Hangar).
- **Quota**: the user's plan has **200 free requests a month**; 2 were used for this check. Paid usage is $0.003/request (from OpenWebNinja's pricing manifest).
- Not used: `job-details` (one request per id even when batched) and the salary endpoints.

**remoteyeah.com** RSS (free, `robots.txt` allows all). Per-category feeds from `https://remoteyeah.com/rss-feeds`; items have `guid` (stable slug), `title`, `company`, `location`, `tags`, ISO `pubDate`, `link` (strip `utm_*`/`ref`), and a CDATA HTML `description`. `location` is clean enough to filter on for free: the full-stack feed today had "United States" ×7, "Worldwide" ×2, "Europe", "Latin America, Brazil", "Europe, Latin America", "Mexico", "India", empty… Behind Cloudflare: a fetch from Lambda is untested (phase b).

### What the filter looks for

Kept as **editable text** in the database (the page has an editor), so the criteria change without a deploy. Initial version, from the user's answers on 2026-11-11:

- **Candidate**: Buenos Aires, Argentina. ~4 years of experience: Senior Software Engineer at a security startup (Python API + React: phishing / fake-app detection, a GitHub App for npm supply-chain scanning), 3 years full stack at a litigation-funding fintech (React, TypeScript, Express, Next.js; an internal financial platform with $25M+ volume and bank reconciliation; Python scraping pipelines over 2M+ cases, MySQL/MongoDB), earlier .NET APIs. Informatics Engineering, UBA. English for work, Spanish native, a little Portuguese (not enough to work in it).
- **Roles**: software / full stack / backend engineer; also AI-flavoured roles (AI product engineer, AI engineer, forward deployed engineer, product / founding engineer). **Never drop a posting because it's about AI**; the user tailors the CV for those.
- **Seniority**: semi senior or senior. Requires **up to 5 years** → fine; 6+ → no. Junior / intern → no. Staff / principal / lead → maybe.
- **Stack**: TypeScript, React, Node.js, Next.js, Python, SQL (MySQL, Postgres), AWS. Mainly Java, .NET, PHP, Ruby, native mobile, DevOps/SRE, data science or QA roles → no.
- **Location (the main check)**: can they hire someone living in Buenos Aires?
  - yes: hires in Argentina, LATAM, the Americas or worldwide; remote, hybrid or onsite anywhere in the Buenos Aires area; any contract (employee, contractor, EOR) and any currency, ARS included.
  - Brazil-friendly → usually Argentina too, so maybe; **no** if it's onsite in Brazil or needs working Portuguese.
  - no: US-only, US work authorization, onsite outside Buenos Aires, Europe/India/elsewhere only.
  - A salary above ~$100k/year with no LATAM mention signals a US-local role → lean no (location signal, not a salary rule).
- **Salary**: no salary filter for now. Most LATAM roles pay $40–90k/year. The rule list has a salary floor field, empty to start.
- **Employer**: recruiting agencies and talent marketplaces (Turing, Toptal, Crossover, and recruiters posting for unnamed clients) → dropped: they add noise. Nearshore consultancies (BairesDev, Globant, Stefanini, AgileEngine…) rarely hire → **hidden** (stored, shown only with "show hidden").
- Fintech first, but anything that fits the experience counts.

### Pipeline (one run)

1. **Collect** each enabled saved search (`discovery_searches`): JSearch → 1 page, `date_posted=3days` (overlaps the previous day, so nothing slips between runs); remoteyeah → the whole feed. Sources are adapters behind a port, `JobSource.fetch(search) -> list[Posting]`, outside `core/`.
2. **Rules, no LLM** (`core/discovery.py`, pure; the lists are editable on the page):
   - skip what's already stored: unique `(source, source_id)` (JSearch `job_uid`, remoteyeah `guid`);
   - skip cross-source and repost duplicates: same normalized company (`normalize_company`) + title (`rapidfuzz` ≥ 90) seen in the last 30 days;
   - drop titles matching the exclude words, matched on word boundaries (`\bjava\b` doesn't hit "JavaScript"): junior, jr, intern, trainee, java, .net, c#, php, ruby, ios, android, devops, sre, qa, data scientist…;
   - drop companies on the agency/marketplace list; hide companies on the consultancy list (`drop_reason = consultancy`), both editable;
   - drop remoteyeah items whose `location` names only places outside {Argentina, LATAM/Latin America, South America, Americas, Brazil, Worldwide/Anywhere}; an empty location passes;
   - drop postings older than 21 days;
   - flag companies that already have an application in the tracker (shown as a badge, not dropped).
3. **LLM** (Haiku 5.5, low effort, through `LLMClient.complete_json` with a JSON schema), only for postings that pass the rules. System prompt = the criteria text; user message = the posting (title, company, location, salary, publisher, description up to 4,000 chars). Output:
   - `verdict` `match|maybe|no`, `score` 0–100, `reasons` (≤3 short lines);
   - `location_fit` `yes|no|unclear`, `seniority`, `years_required` (int or null), `employer_kind` `direct|consultancy|agency|unclear`, `ai_related` (bool), `stack_overlap` (≤8 skills).
   - The posting text is **untrusted input**, same as emails: no tools, enums validated and unknown values mapped to `unclear`, strings cut, nothing from the model ever runs or is followed as a link. The page only renders `http(s)` links, `rel="noopener noreferrer"`.
   - `employer_kind = agency` → verdict `no`; `consultancy` → hidden like the rule above (catches consultancies not on the list).
   - The model and a `prompt_version` are stored per posting. Changing the criteria doesn't re-score old postings unless you press "re-score" (re-runs the LLM on the `new` ones).
4. **Store** every collected posting, the rule-dropped ones included (`drop_reason`), so a wrong rule can be noticed and fixed. The page hides them by default.

### Data (migrations `0011`–`0013`, DSQL rules as usual)

- `job_postings`: `id uuid PK`, `source`, `source_id`, `search_id`, `url`, `title`, `company`, `company_normalized`, `location`, `employment_type`, `salary_text`, `salary_min`, `salary_max`, `salary_period`, `publisher`, `posted_at`, `description` (≤8,000 chars), `fetched_at`, `drop_reason`, `ai_verdict`, `ai_score`, `ai_result jsonb`, `ai_model`, `prompt_version`, `status` (`new|interested|dismissed|applied`), `application_id` (FK, nullable), `updated_at`. Unique `(source, source_id)`; indexes on `fetched_at` and `company_normalized`.
- `discovery_searches`: `id`, `source` (`jsearch|remoteyeah`), `label`, `params jsonb` (JSearch: query/country/language/work_from_home/date_posted; remoteyeah: feed URL), `enabled`, `created_at`.
- `discovery_settings`: `key text PK`, `value jsonb`, `updated_at`. Keys: `criteria` (the text above), `rules` (title excludes, agency list, consultancy list, location allowlist, max age, salary floor), `jsearch_monthly_cap` (default **190**).
- `discovery_runs`: `id`, `started_at`, `finished_at`, `trigger`, `jsearch_requests`, `fetched`, `new`, `dropped`, `llm_calls`, `error`. The monthly JSearch count is a `sum(jsearch_requests)` for the month. A run skips JSearch (remoteyeah still runs) once the count reaches the cap.

### Starting searches (to tune after the first week)

JSearch, 6 a day × 30 = **~180 of the 200 free requests**:
- `country=ar`: "senior full stack engineer", "senior backend engineer", "software engineer fintech", "ai engineer". No "remote" in the query: hybrid in Buenos Aires works too.
- `country=us`, `work_from_home=true`: "software engineer latam", "forward deployed engineer".
- No `country=br` search: Brazil-local postings are mostly Portuguese-speaking roles; Brazil-friendly remote roles still show up through remoteyeah and the US "latam" search.

remoteyeah (free): `remote-full-stack-engineer-jobs.xml`, `remote-backend-engineer-jobs.xml`, `remote-software-engineer-jobs.xml`, `remote-ai-native-engineer-jobs.xml`, `remote-artificial-intelligence-engineer-jobs.xml`, `remote-solutions-engineer-jobs.xml` (where forward-deployed roles tend to land).

### Code, API and page

- `core/discovery.py`: `Posting`, rules, Spanish/English relative-date parsing, the prompt and the result parser. `adapters/jsearch.py` (httpx, 20 s timeout, the key never logged), `adapters/remoteyeah.py` (httpx + `defusedxml`, since the feed is untrusted XML). `services.run_discovery(repo, llm, sources, clock)`.
- CLI: `jobtracker discover run [--source jsearch|remoteyeah] [--no-llm] [--dry-run]` (`--dry-run` prints what it would store and makes no LLM calls), `jobtracker discover searches` (list / add / disable), `jobtracker discover seed` (the starting searches and criteria above).
- API: `GET /api/discover` (filters: verdict, status, source, include dropped), `PATCH /api/discover/{id}` (status), `POST /api/discover/{id}/apply` (creates the application through `services.create_application` with company, role, `job_url`, `job_description`, `location`, salary when known, `source_channel = "discover"`, and links it), `GET/PUT /api/discover/settings`, `GET/POST/PATCH /api/discover/searches`, `POST /api/discover/run` (local only at first).
- Page `/discover` (route and nav item next to the others): a list sorted by score, with verdict and status filters. Each row shows title, company, location, salary, posted date, source/publisher, the reasons, badges (AI, "already in tracker"), and the link. Buttons **Interested / Not for me / Applied**. A side panel edits the criteria text, the rule lists and the searches, and shows the last run and this month's JSearch count.

### Cost

- JSearch: within the free 200/month, with a hard cap at 190. Paid would be ~$0.54/month at this volume.
- LLM: Haiku 5.5 is $0.10 / $0.50 per million input/output tokens. A posting is ~2k tokens in and ~300 out, about **$0.0004**. Even at 100 new postings a day that's ~$1.20/month. Measure it after the first run.
- Lambda (phase b): one short daily run, nothing noticeable.

### Phases

- **(a) Local**: migrations, sources, rules, LLM filter, CLI and the page, against local Postgres; tests use recorded JSearch/remoteyeah fixtures (no network). Then **one real run after the user's OK** (≤6 JSearch requests plus a few cents of Haiku), into the local database. Stop for review.
- **(b) AWS**: `ingest` handler gets `{"trigger": "discover"}` with its own lease name; a second daily schedule in `infra/prod/scheduler.tf` (09:00 Buenos Aires); `JSEARCH_API_KEY` added to `ssm_secrets.SECRET_NAMES` and `local.secrets` in `infra/prod/lambdas.tf`, pushed with `jobtracker aws push-secrets`. Check that remoteyeah answers from Lambda; if Cloudflare blocks it, that source runs from the laptop with `jobtracker discover run --source remoteyeah --dsql`. The user runs the apply.
- **(c) Later** (boards and the ATS watchlist became §21): more boards, LinkedIn job-alert emails as a source (they're dropped by the funnel today), public ATS boards (Greenhouse/Lever/Ashby JSON) for a watchlist of fintechs, and a browser scraper only for a site that really needs one.

### Open questions

- Whether `job_uid` stays the same across days: verified after the first two real runs. The title + company dedupe covers it if not.

### Phase (a) as built (2026-11-11)

- **Code**: migration `0011_discovery.sql` (all four tables in one file); `core/discovery.py` (rules, relative dates, prompt + schema + validation, `run_discovery`, `seed`, `apply_to`, `clean_search_params`); `adapters/jsearch.py`, `adapters/remoteyeah.py`; `DiscoveryRepo` / `JobSource` ports, implemented by `PostgresRepo` and the test fakes; `jobtracker discover seed|searches|run`; `/api/discover*` routes; the `/discover` page (nav: Discover).
- **Changes from the design above**:
  - `jsearch_monthly_cap` lives inside the `rules` setting.
  - Seniority words (`junior`, `intern`…) are a list separate from stack words, because titles about AI skip the stack words only (the user tailors the CV for AI roles).
  - The location rule applies to remoteyeah only: JSearch locations aren't reliable.
  - The LLM's `employer_kind = consultancy` hides a posting too, and re-scoring gives it a second chance.
  - Postings that fail to score stay unscored, and the next run scores them (up to 150 a run, stopping after 3 LLM failures).
  - Page runs take a separate advisory lock, local only. In prod, `POST /api/discover/run` answers 501 until phase (b).
- **remoteyeah's feeds aren't well-formed XML** (bare `&` in titles and URLs): they're escaped before parsing with `defusedxml` (new dependency). Titles come as "Remote … at Company", and both ends are stripped.
- **Applied** creates the application with `source_channel = "discover"` and the AI's stack overlap. The boards that postings link to (JobLeads, BeBee, Expertini, remoteyeah, ZipRecruiter…) were added to `JOB_BOARD_DOMAINS`, so a LinkedIn or JobLeads link never becomes a company's email domain.
- **Live check, no DB** (2026-11-11): the six remoteyeah feeds had 145 items. The rules hid 103 for location, 20 for title words and 1 as an agency; 21 would go to the LLM.
- **First real run** (2026-11-12, local): 241 fetched, 239 new, 189 hidden, 62 Haiku calls, 6 JSearch requests, 0 errors; 1 match, 18 maybe, 31 no. `JSEARCH_API_KEY` isn't in `ssm_secrets.SECRET_NAMES` yet (phase b).

### Search and filters (2026-11-14)

The user wanted to look through what was collected before tuning the criteria: filters for title, job board, location, seniority, technology, company size, sector, salary and posting date.

- **Storage**: migration `0012_posting_search.sql` adds plain columns to `job_postings`: `seniority`, `years_required`, `location_fit`, `work_mode`, `employer_kind`, `company_size`, `sector`, `technologies`, `ai_related`, `salary_usd_min`, `salary_usd_max`. `discovery.sync_search_fields` copies them from `ai_result` whenever a posting is prepared or scored. `technologies` is one text column, `|TypeScript|React|` (DSQL has no arrays), matched with `lower(technologies) LIKE '%|react|%'`.
- **LLM**: the verdict schema gained `technologies` (≤15, aliases folded: NodeJS → Node.js, Postgres → PostgreSQL…), `work_mode`, `company_size` (startup <50 / small 50–250 / medium 250–1k / large 1k+, from the posting or the model's knowledge of the company), `sector` (a fixed list of 16 plus unclear) and the stated salary (`salary_min`, `salary_max`, ISO `salary_currency`, `salary_period`; never estimated). `PROMPT_VERSION` is `2026-11-14.1`.
- **Salary in USD a year**: the LLM's reading when its currency is USD; otherwise the source's own numbers, taken as USD (JSearch only had salaries on US listings). Other currencies aren't converted: an ARS salary shows as text but doesn't pass a USD minimum.
- **Query**: `PostingQuery` (core/models). `PostgresRepo.search_postings` builds the WHERE in SQL with paging (50 a page) and a total; `discovery.matches` / `sort_postings` say the same in Python for the test repo, and `test_postgres` checks the two agree. Facets (the values each dropdown offers, with counts) come from `facet_postings` (every row, no description) and `discovery.facets`: each dropdown counts what all the other filters let through, its own choice left out (technologies count within the current choice). Counting over the whole view instead showed "Fintech (1)" for a posting the default status filter hid (2026-11-14). Sorts: best fit, newest, best paid.
- **API**: `GET /api/discover` takes `q` (title or company), `location`, `publisher`, `seniority`, `company_size`, `sector`, `work_mode`, `location_fit`, `employer_kind`, `tech` (all of, comma-separated), `ai`, `salary_min`, `posted_days`, `sort`, `limit`, `offset`, besides the old `verdict`/`status`/`source`/`hidden`. It returns `{postings, total, counts, facets}`. The fixed 30-day window is gone; paging replaces it.
- **Re-score without collecting**: `POST /api/discover/rescore {include_hidden}` (local only, like `/run`) → `discovery.rescore`: resets the scores of postings fetched in the last 21 days, any status, and scores them again. No JSearch requests. `include_hidden` also scores the rule-hidden ones (not duplicates): they stay hidden, but their verdict and fields show whether a rule hides something worth seeing. Limit 500 calls (~$0.0005 each). It replaces the side panel's "Run and re-score recent": "Re-score recent", with a "hidden ones too" checkbox.
- **Scoring runs 6 LLM calls at a time** (`SCORE_WORKERS`; the Anthropic client is thread-safe, the database is only written from the calling thread). Three failures still stop the rest.
- **Page**: the filters live in the URL, so they survive opening an application and coming back. The text boxes wait 300 ms. Clicking a technology on a card adds it to the filter; the ones on the CV (`stack_overlap`) are highlighted. The default view is now "All" instead of "Matches". A banner offering the re-score for postings scored with the older prompt was tried and removed: too much code for a one-time step.
- **Progress while it runs**: `run_discovery` and `rescore` take an `on_progress` callback that gets a `discovery.Progress` after every search and every LLM answer: the phase (collecting → scoring → done), searches done / total and the one being fetched, found / new / hidden, scored / to score, errors. The API keeps the latest one in memory (page runs are local only, one process) and serves it at `GET /api/discover/progress` with elapsed times. While the POST waits, the page polls it every second and shows the two steps with a bar and a time estimate (from how long the finished units took). If the page is reloaded mid-run, it finds the run still going and refreshes the list when it ends.


## 21. More sources: company boards and getonbrd (2026-11-14)

Status: **round 1 built and committed 2026-11-14.** Rounds 2–6 are independent enough to run in separate sessions; each one starts from this section and `docs/handoff-job-discovery.md`.

### Why

JSearch's results are mostly reposts through aggregators (JobLeads, WhatJobs, BeBee) and spam (Bluelight Consulting). The user's good leads came from somewhere else: an agency board (silver.dev), a LATAM job portal (getonbrd), and company career pages (Ramp, HomeVision, GoFundMe, RYZ Labs). Most of those career pages sit on three applicant tracking systems with a public JSON API, so a **watchlist of companies** replaces keyword searches.

### What was measured (2026-11-14)

- An open directory of 9,935 company boards (LastRound AI on DataHub, **CC BY 4.0**, August 2026 snapshot; copy in `backend/seeds/ats_directory_2026-08.csv`) was scanned through the public APIs in about 20 minutes with 10 connections. 7,724 boards were live (885 gave 404), holding ~270,000 jobs, ~56,000 with an engineering title.
- Engineering roles located in Argentina: 100 companies. Tagged LATAM / Americas / South America: 101. Only Brazil, Mexico, Colombia etc.: 217. Only "worldwide / anywhere": 44.
- Bluelight Consulting alone had 510 of the matching postings.
- silver.dev is an Ashby board (`Silver`); RYZ Labs is a Lever board (`RyzLabs`); GoFundMe is Greenhouse (`gofundme`).

### Sources checked

| Source | Access | Decision |
|---|---|---|
| Ashby `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | public JSON | round 1 |
| Greenhouse `boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | public JSON | round 1 |
| Lever `api.lever.co/v0/postings/{slug}?mode=json` (slug is case-sensitive) | public JSON | round 1 |
| getonbrd `www.getonbrd.com/api/v0/categories/{id}/jobs` | public JSON | round 1 |
| Workable `jobs.workable.com/api/v1/jobs?query=…&location=Argentina` | public JSON, 85 results | round 3 |
| Hacker News "Who is hiring" (Algolia API) | public, ~3 LATAM posts a month | round 3, to find companies |
| YC company list `yc-oss.github.io/api/companies/hiring.json` | public, 1,485 hiring | round 3, to find companies |
| WeRemoto, a16z portfolio board | plain HTML | maybe later |
| Himalayas, Remotive, RemoteOK, We Work Remotely | public | skipped: mostly US-only or no location |
| Wellfound, Built In, Kaszek portfolio board | bot challenge | only through the user's browser, if the rest falls short |
| JSearch | paid API | **switched off** in round 1 |

### Round 1: collect (built)

Goal: collect as much as possible. How to score this volume with the LLM is round 2, so a run can now skip scoring.

- **Watchlist**: table `discovery_companies` (migration `0013`): `ats` (`ashby|greenhouse|lever`), `slug`, `name`, `enabled`, `note` (how it got here), `last_checked_at`, `last_status`, `jobs_total`, `jobs_kept`. Unique `(ats, slug)`.
- **Seed**: `adapters/seeds/ats_watchlist.csv`, the companies from the scan with at least one engineering role in Argentina, LATAM, a neighbouring country or worldwide (Bluelight left out). `jobtracker discover seed` and the page's seed action import it; existing rows are kept.
- **Adapter** `adapters/ats_boards.py`: one `fetch_board(ats, slug, name)` for the three systems, returning every job on the board as a `JobPosting` with `source` = the ATS and `source_id` = `slug:job id`.
- **What is stored from a board** (`discovery.board_keep`): only jobs with an engineering title whose location passes `rules.location_allow`, or is empty or a bare "Remote". The rest is counted on the company row and not stored: a board like Ramp's has 180 jobs and none for LATAM. The usual rules then apply (hidden with a reason). The "older than 21 days" rule doesn't apply to boards: a job listed on the board is open.
- **Run**: after the saved searches, `run_discovery` reads every enabled company, 8 at a time. A board that answers 404 is disabled with `last_status = "gone"`.
- **getonbrd**: `adapters/getonbrd.py`, a saved search per category (`programming`, `machine-learning-ai`). Location is built from the remote fields ("Remote (anywhere)", "Remote (Chile, Peru)", "Chile (hybrid)"), so the location rule works on it. Salary is USD a month.
- **Location rule**: now applies to every source except JSearch (it was remoteyeah only).
- **Block list**: `rules.blocked`, default `["Bluelight Consulting"]`, drop reason `blocked`. "Hide company" on a card adds the company and hides its stored postings (`POST /api/discover/block`).
- **JSearch off**: migration `0013` disables the saved JSearch searches, and the defaults no longer include them. The adapter and the monthly cap stay until round 5.
- **Collect only**: `POST /api/discover/run` takes `score` (the page has a "Collect only" button); the CLI already had `--no-llm`.
- **CLI**: `jobtracker discover companies list|add|import|scan`. `scan <directory.csv>` checks every board in a directory file that isn't watched yet and adds the ones with an engineering role in Latin America (about 20 minutes for the full directory; run it monthly).
- Not done: marking a posting closed when it leaves its board (round 4).

### Round 2: scoring strategy for the larger volume

Status: **built and committed 2026-11-15; the user ran "Score pending" (194 scored, 3 failed on rate limits, see 5. below).** The user's answers (2026-11-14): hide managers, support / sales and infrastructure-type titles and let the LLM judge data and security engineers; hide onsite Brazil; keep talent marketplaces dropped; score in two steps.

**What was measured** (2026-11-14, read-only queries on the local database after the user's first collect-only run):

- 1,984 postings stored (plus 47 from JSearch), 969 visible, **921 visible and unscored**, at 299 companies. Descriptions average 4,800 characters.
- By the location text: Argentina / Buenos Aires 227, LATAM / Americas 192, worldwide 212, Brazil only 280, no location 10.
- Brazil only: 143 don't say "remote" (onsite or hybrid in Brazil), and 52 have a description in Portuguese.
- By title: 73 managers or directors; 41 support, sales or customer-success engineers; 35 infrastructure, Linux, kernel, embedded or network; 60 data or analytics engineers; 25 security engineers. About 570 are plain software, full stack, backend, frontend or AI roles.
- Canonical has 93 of the 921 (Supabase 29, CI&T 35). No role is stored twice under the same company and title.
- A regex for "N years" finds 6 or more in 172 descriptions, but it also catches "10 years in business": not reliable enough for a rule.

**The finding: cost isn't the problem, reading is.** Scoring all 921 is about $0.45 at the plan's ~$0.0005 a call, and about 6 minutes at 6 calls at a time. So nothing here is built to save LLM money:

- No cheaper first pass on title + location: it would save about 20 cents once, and add a second prompt to keep in step with the first.
- No Batch API: half price on cents, and the results arrive hours later with no progress on the page.
- What needs to shrink is the list the user reads. Free rules cut what is certainly not wanted, the LLM scores everything else, and the order of scoring puts the best location first.

**1. Free rules, before any LLM call** (each hides with a reason, nothing is deleted)

- **Role words**: a new list `rules.role_exclude` ("Role words" on the page), separate from the stack words because AI titles don't skip it ("AI Support Engineer" is still support). Default: `manager`, `director`, `head of`, `vp`, `support engineer`, `sales engineer`, `customer success`, `technical account`, `pre-sales`, `presales`, `infrastructure engineer`, `network engineer`, `linux`, `kernel`, `embedded`, `firmware`. Solutions and forward deployed engineers aren't on it. `systems engineer` and `kubernetes` were tried and removed: on the real postings they hid "Distributed Systems Engineer" and "Senior Software Engineer - Python/Golang - Kubernetes". A saved rules setting without the key gets the default list, so the user's database needs no edit.
- **Onsite in Brazil** → `location: brazil onsite` (`discovery.brazil_onsite`): Brazil is the only allowed place the location names, it names more than the country, and neither the location nor the title says remote. A bare "Brazil" is kept: it usually means anywhere in the country. Not for JSearch.
- **Description in Portuguese** → `language: portuguese` (`discovery.in_portuguese`): at least 5 common Portuguese words in the first 3,000 characters and more than a third of the English count. Spanish passes.
- **The rules run again before scoring**: `score_pending` passes the visible, new, unscored postings through `rule_drop` once more (without the "too old" rule), so a rule added after a posting was stored hides it instead of costing a call. That is how the 921 already stored get the new rules.
- On the 921 (simulated with the real code, read-only, 2026-11-15): 83 onsite Brazil, 143 by role words, 22 Portuguese → **673 left to score**: Argentina 206, LATAM 160, worldwide 158, Brazil 139, no location 10.
- Not a rule: years of experience (unreliable from a regex), a cap per company ("Hide company" covers it), and "anywhere" inside a US-only location ("U.S. Anywhere" passes the location list; the LLM says no).

**2. Scoring order and limits**

- `score_pending` sorts by `discovery.location_tier` (Argentina → LATAM / Americas → worldwide → not stated → the rest), newest first inside a tier, then applies the limit. No new column: `unscored_postings` lost its `limit` argument and returns every pending row.
- `RUN_SCORE_LIMIT` is 1,000 (was 150). `RESCORE_LIMIT` stays 500.
- **Score without collecting**: `run_discovery(collect=False)` reads no source. `POST /api/discover/run` takes `collect` (422 when `collect` and `score` are both false); its progress has `kind = "score"`. The page shows "Score pending (N)" when something waits (`unscored` in `GET /api/discover/settings`, from `count_unscored`). CLI: `discover run --no-collect [--limit N]`.
- Every scoring adds a run note with the calls and the tokens in and out (`LLMUsage`). No dollar figure: the price isn't in the code.

**3. Prompt and criteria** (`PROMPT_VERSION` `2026-11-14.2`)

- `apply_verdict` no longer forces "no" for `employer_kind = agency`; the system prompt says the field only describes who posted. The `agencies` rule list still drops the talent marketplaces.
- The system prompt: a location that names the candidate's city or country is `location_fit = yes`.
- The whole stored description goes to the model (`LLM_DESCRIPTION_CHARS` = 8,000, was 4,000).
- `DEFAULT_CRITERIA` gained the Argentina bonus, "a recruiter hiring for a client is fine", and "per-task AI-training gigs score lower". **The user's saved criteria still have the old Employers paragraph**: they edit it on the page before scoring.

**4. First scoring, in two steps** (the user runs both; paid, about $0.40 in all at the plan's price)

1. `discover run --no-collect --limit 210`: hides the ~250 by the new rules, then scores the Argentina tier. The user reads the verdicts and corrects the criteria and rules.
2. "Score pending" for the rest, then "Re-score recent" only if the criteria changed.

**5. Rate limits (2026-11-15, after the first "Score pending")**

The run scored 194 and stopped after 3 `RateLimitError`s: 6 calls at a time with about 4,900 input tokens each went over the account's input tokens per minute, and the SDK's 3 quick retries gave up within seconds. The errors only showed in `docker compose logs api`.

- **Prompt caching**: `AnthropicLLM` marks the system prompt (`cache_control: ephemeral`). It is the same for every call in a run (criteria and instructions; for email, the extraction rules). Cache reads cost a tenth and don't count toward the input-token limit. `LLMUsage.cached_tokens` counts them, and the run note shows `(+N cached)`: if it stays 0 on a large run, caching isn't working.
- **Wait out a 429**: after the SDK's retries, the adapter waits `retry-after` (capped at 60 s, 20 s when missing) and tries again, up to 4 times, then raises `LLMRateLimited` (an `LLMError`). The 3-failure stop is unchanged.
- **Errors in the run note**: `LLM errors: <kind> ×N`, so the page shows what failed.
- Not done: lowering `SCORE_WORKERS`. Measure the first large run with caching first.

### Round 3: grow the watchlist

- A resolver: company name or website → careers page → ATS and slug (how RYZ Labs' Lever board was found), fed by company names from silver.dev, getonbrd, remoteyeah, HN and the YC list.
- More systems: Workable search first, then Teamtailor, Recruitee, SmartRecruiters, BambooHR.
- A monthly `companies scan` of the directory.

### Round 4: quality of what's stored

Mark postings closed when they leave the board; dedupe the same role listed in several locations; show a company's watch status on the page.

### Round 5: AWS and cleanup

Run boards from the Lambda (phase (b) of §20), copy `discovery_companies` to DSQL (already in `db copy-to-dsql`), remove the JSearch adapter, cap and secret.

### Round 6: a proper page for criteria, rules, searches and the watchlist (asked 2026-11-14)

Independent of rounds 2–5; it can go first. Today all of this lives in the "Criteria & searches" side sheet on Discover (`SettingsSheet`, `Watchlist` and `Searches` in `frontend/src/pages/Discover.tsx`), which has outgrown a sheet: one long scroll with the criteria text, seven rule lists, the watchlist summary and the searches.

- A route of its own (for example `/discover/settings`, linked from Discover's header in place of the sheet), with sections or tabs: **Criteria**, **Rules**, **Sources** (saved searches and the company watchlist), **Runs**.
- **Company watchlist** as a real table: search by name, filter by ATS and status, turn a company on or off, add one by ATS and slug, and see what the last check found (`jobs_kept` / `jobs_total`, `last_status`, `note`). Needs `GET /api/discover/companies` (paged), `POST` and `PATCH`; today the API only returns the summary and the list is edited from the CLI.
- **Rules**: each list as its own editor instead of seven textareas in a row; the block list shows what "Hide company" added and lets one entry be removed.
- **Runs**: the last runs with their notes and errors (`discovery_runs`), not only the latest one.
- Split `Discover.tsx` (over 1,000 lines) while moving this out: the page keeps the list, the filters and the run buttons.
- To decide with the user before building: tabs or one long page, and whether "Re-score recent" stays on Discover or moves here.
