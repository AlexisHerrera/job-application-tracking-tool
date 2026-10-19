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
- **Cloudflare team**: `alexisherrera`.

## 1. Big picture

```
                    ┌──────────────── Cloudflare (DNS + Access, OTP to my email) ────────────────┐
 browser ──https──▶ │ jobs.alexisherrera.dev  ── adds Cf-Access-Jwt-Assertion ──▶ CloudFront     │
                    └─────────────────────────────────────────────────────────────┬──────────────┘
                                                                                  │
                              ┌───────────────────────────────┬───────────────────┘
                              ▼ /*  (OAC)                     ▼ /api/*  (OAC → Function URL)
                        S3 (private)                   Lambda "api"  (FastAPI via Mangum)
                        React SPA                      validates CF Access JWT, else 401
                                                              │
 EventBridge Scheduler ── every 15 min ──▶ Lambda "ingest" ───┤
                                              │  IMAP (app password, X-GM-RAW search)
                                              │  Anthropic API (Haiku-class, structured output)
                                              ▼               ▼
                                      SSM SecureString     Aurora DSQL (Postgres-compatible, serverless)
```

Both Lambdas sit **outside a VPC**, so they get outbound internet (IMAP, Anthropic, Cloudflare certs) with no NAT gateway, and they reach DSQL, SSM and S3 over public AWS endpoints.

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
- Foreign keys, `jsonb`, `uuid`, `timestamptz` and identity columns are supported. I'll use UUID primary keys because they distribute better.
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
│   │   ├── api/                      # FastAPI app + Cloudflare Access JWT middleware
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
4. **Cloudflare (guided)**: your 8 steps, one at a time, with me verifying each (`dig`, curl). Terraform handles the DNS records, the ACM validation records, and the Access app + policy.
5. **Dashboard**: the full UI, mobile-friendly. Stats page and "what should I study" report.
6. **Deploy + verify**: an end-to-end check, including 401 without a valid JWT on the `cloudfront.net` hostname and on the Function URL. With OAC, the Function URL returns 403.
7. *(Optional)* Chrome extension.
