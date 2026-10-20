# Job Tracker

A personal, near-zero-cost tracker for job applications. It reads Gmail over IMAP, picks out job-process emails (confirmations, interviews, rejections…), attaches them to the right application, and shows stats so you know what to practice.

Design and decisions: [`docs/plan.md`](docs/plan.md).

```
backend/    Python 3.12 package `jobtracker` (core domain + adapters + API + CLI), uv / ruff / pytest
frontend/   React + TypeScript + Vite dashboard (Tailwind v4 + shadcn/ui)
infra/      Terraform (Phase 3)
```

## Local development

Requirements: Docker, [uv](https://docs.astral.sh/uv/), Node 22+.

```bash
cp .env.example .env           # fill in later; the UI works without Gmail/Anthropic keys
docker compose up --build      # db + migrations + API (hot reload) + Vite (HMR)
docker compose exec api jobtracker dev seed   # optional: FAKE sample data for the UI
```

- Web UI: http://localhost:5173 (Vite proxies `/api` to the API, same origin like prod)
- API: http://localhost:8000/api/health
- Postgres: `localhost:5433`, database/user/password `jobtracker` (5433 so it doesn't clash with other local Postgres containers; override with `DB_PORT`)

Locally, `AUTH_DEV_BYPASS=true` skips Cloudflare Access. The app **refuses to start** with that flag when `APP_ENV` isn't `local` or when running inside Lambda.

Editing anything under `backend/src` reloads the API; editing `frontend/src` hot-reloads the page.

### Looking at the data with a SQL client

**Locally (DBeaver / DataGrip):** a new PostgreSQL connection with host `localhost`, port `5433`, database `jobtracker`, user `jobtracker`, password `jobtracker`.

**In prod (Aurora DSQL, from Phase 3):** there are no passwords; you sign in with your AWS SSO profile.
- DBeaver Community: *Help → Install New Software → Add* `https://awslabs.github.io/aurora-dsql-dbeaver-plugin/update-site/`, install "Aurora DSQL Connector for JDBC", restart. Then *New connection → Aurora DSQL*, endpoint = cluster endpoint, user `admin`, AWS profile `jobtracker`. Tokens are generated for you.
- DataGrip: PostgreSQL driver, SSL required, and an auth token (`aws dsql generate-db-connect-admin-auth-token --hostname <endpoint> --profile jobtracker`) as the password. Tokens expire, so regenerate when needed.

### Tests and lint

```bash
cd backend
uv run pytest          # Postgres integration tests run when `docker compose up db` is running, else skip
uv run ruff check . && uv run ruff format --check .
cd ../frontend && npm run typecheck
```

All tests use **fake fixture emails** (`backend/tests/fixtures/emails`). They never touch Gmail or the Anthropic API.

## Getting the credentials

### Gmail app password (IMAP)

App passwords require 2-Step Verification.

1. Go to https://myaccount.google.com/security and turn on **2-Step Verification** if it's off.
2. Go to https://myaccount.google.com/apppasswords, create an app password named `jobtracker`, and copy the 16-character password.
3. In Gmail, open *Settings → See all settings → Forwarding and POP/IMAP* and make sure **IMAP is enabled**. Under *Labels*, keep **All Mail** visible in IMAP ("Show in IMAP").
4. Put the address and password in `.env` as `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD`.

The ingester opens All Mail **read-only** (`EXAMINE` + `BODY.PEEK`), so it never marks anything as read. Revoking the app password at the same page cuts access immediately.

### Anthropic API key

1. Sign in at https://console.anthropic.com, open *Settings → Billing*, and add credit (a few dollars lasts a long time with Haiku).
2. *Settings → API keys → Create key*, named `jobtracker`.
3. Put it in `.env` as `ANTHROPIC_API_KEY`. The model is set by `LLM_MODEL` (default `claude-haiku-5-5`).
4. Optional: set a monthly spend limit under *Settings → Limits*.

## CLI

Run from `backend/` with `uv run jobtracker …` (it reads `../.env`), or inside the container with `docker compose exec api jobtracker …`.

| Command | What it does |
|---|---|
| `db migrate` | Apply migrations (compose runs this automatically) |
| `app add --company X --role Y [--applied-at 2026-08-01 --stage rejected]` | Add an application |
| `app import file.csv` | Bulk import (`company,role,applied_at,stage,job_url,company_domain,source_channel,seniority,stack,location,notes`) |
| `app list`, `stats` | Quick look from the terminal |
| `process-eml FILE…` | Run the pipeline on local `.eml` files (dry run by default) ⚠️ paid LLM calls for job-like mail |
| `backfill [--since 2026-09-15] [--until …] [--dry-run] [--limit N]` (defaults to the current campaign's start) | ⚠️ Reads your **real inbox** over a date range, with paid LLM calls. Idempotent |
| `ingest [--dry-run] [--loop 900]` | ⚠️ Incremental run from the last processed UID (what the Lambda does every 15 min) |
| `campaign create --name "Sep 2026" --start 2026-09-15`, `campaign list` | Job-search campaigns (an ongoing earlier one ends the day before) |
| `dev seed` | Fake sample data (local only) |

The first `ingest` run (or **Scan inbox now**) continues right after the newest email a `backfill` already processed, so nothing in between is skipped. With no backfill it only records the mailbox's current position. Use `backfill` for history; Message-ID dedupe makes overlaps harmless.

## Adding applications by hand

- **Paste anything** (Add page, or "Paste more info" on an application): paste emails, Slack or LinkedIn messages, a job post or your notes. The AI (`LLM_MODEL` at `LLM_PASTE_EFFORT`) proposes one record per application and matches each one to an existing application or offers to create it. **Nothing is saved until you review it:**
  - **fills empty** fields are preselected
  - **adds to** (stack, notes, a new email domain) is preselected and never removes anything
  - **⚠ will modify** (overwrites a value you already have, or changes the stage) starts **unchecked**. Anything you tick is listed under "You will modify existing data" before you apply.
  The pasted text is sent to Anthropic for extraction and is not stored. Each "Read with AI" is one paid call (fractions of a cent with Haiku).
- **Inbox → New application**: paste the recruiter's LinkedIn chat into *Fill from a recruiter chat* and the AI fills the form (fields it filled are tagged *from chat*, anything it replaced is called out, *Undo fill* restores). If the chat matches an application you already have, it offers to assign the email to that one instead. Nothing is saved until *Create and assign*; one paid AI call per read.
- **Form**: the classic fields, plus a yearly salary range (a single figure is stored as min = max), currency and other benefits. Monthly or hourly salaries found in pasted text are converted to yearly (×12 / ×2080), and the review screen says so.
- **CSV**: still available from the CLI (`app import`) for bulk loads.

## Using the dashboard

- **Applications** has two views (the choice is remembered): **Board**, where dragging a card to another column changes its stage (undo from the toast), and **All**, a sortable list with status chips and counts. Click any card or row to open it in a side panel; every field there edits in place (click, type, Enter). Esc closes the panel.
- **Review** (dashboard or Applications header) walks through the applications created automatically from emails, one at a time: <kbd>Enter</kbd> looks right, <kbd>S</kbd> skip, <kbd>D</kbd> twice deletes (its emails go back to the inbox), <kbd>E</kbd> edits the role. Cards that need review also have a ✓ button on the board.
- **Waiting on your reply** lists only open requests on active processes: closed or on-hold applications and requests the conversation already moved past are left out. **Done** clears one by hand.
- **Where applications went** is a sankey of the campaign: each application through the stages it reached, ending where it stands today (also available as a table).
- **Scan inbox now** (sidebar, local only for now) runs the same incremental ingest as `jobtracker ingest` and shows what it found. ⚠️ It reads your real inbox and makes paid LLM calls for job-like mail. In AWS the scheduled Lambda does this every 15 minutes; the button will be rewired then (Phase 3).
- **Salary** is typed as a range that formats while you type (`90k`, `90000` → `90,000`), with a currency and *per year / per month* switch. A preview shows exactly what is saved (always yearly; monthly × 12), and it warns when a figure looks like the wrong period.
- Light, dark or system theme from the sidebar.

## Campaigns

A campaign is a job-search period (start date, optional end). Applications belong to the campaign whose range contains their applied date. That's computed, not stored, so editing a campaign's dates re-sorts its applications. The header picker scopes the applications list and stats. Each campaign shows its days running, applications per week, and days to the first interview.

## How email processing works (short version)

1. **Gmail search** pre-excludes Promotions/Social (`IMAP_QUERY`).
2. **Funnel**: hard excludes (job alerts, "jobs you may like") → allowlist (ATS domains plus your companies' domains, which grows as you add applications) → bilingual EN/ES keyword heuristics. Only heuristic candidates hit a tiny LLM yes/no gate.
3. **Extraction** with structured output (company, role, event type, interview time, needs-reply…). `.ics` invites override the LLM's interview time.
4. **Matching**: same Gmail thread → sender alias → fuzzy company + role → otherwise the **Inbox** page for one-click assignment. Assigning teaches the sender alias so the next email resolves automatically. "Thanks for applying" emails from unknown companies create an application flagged **to review**.
5. Stages are recomputed from the event history. `ghosted` (no news for `GHOST_DAYS`) is computed, never stored.

Privacy: non-job emails store only their Message-ID and a verdict. Job emails store the extracted fields plus a ≤280-character snippet, never full bodies. Logs never include email content.
