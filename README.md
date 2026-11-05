# Job Tracker

A personal, near-zero-cost tracker for job applications. It reads Gmail over IMAP, picks out job-process emails (confirmations, interviews, rejections…), attaches them to the right application, and shows stats so you know what to practice.

Design and decisions: [`docs/plan.md`](docs/plan.md).

```
backend/    Python 3.12 package `jobtracker` (core domain + adapters + API + CLI), uv / ruff / pytest
frontend/   React + TypeScript + Vite dashboard (Tailwind v4 + shadcn/ui)
infra/      Terraform: bootstrap (state bucket) + prod stack, build/deploy scripts
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

**In prod (Aurora DSQL):** there are no passwords; you sign in with your AWS SSO profile (`jobtracker`) as `admin`. The endpoint is `terraform output dsql_endpoint` in `infra/prod`.
- DBeaver Community: *Help → Install New Software → Add* `https://awslabs.github.io/aurora-dsql-dbeaver-plugin/update-site/`, install "Aurora DSQL Connector for JDBC", restart. Then *New connection → Aurora DSQL*, endpoint = cluster endpoint, user `admin`, AWS profile `jobtracker`. Tokens are generated for you.
- DataGrip: PostgreSQL driver, SSL required, and an auth token (`aws dsql generate-db-connect-admin-auth-token --hostname <endpoint> --profile jobtracker`) as the password. Tokens expire, so regenerate when needed.

### Tests and lint

```bash
cd backend
uv run pytest          # Postgres integration tests run when `docker compose up db` is running, else skip
                       # (throwaway databases jobtracker_test / jobtracker_copy_*; never `jobtracker`)
uv run ruff check . && uv run ruff format --check .
cd ../frontend && npm run typecheck
```

All tests use **fake fixture emails** (`backend/tests/fixtures/emails`). They never touch Gmail or the Anthropic API.

## Deploying to AWS

Everything lives in us-east-1, account 630773215521, through the AWS profile `jobtracker` (SSO session `personal`). Design and decisions: [`docs/plan.md` §18](docs/plan.md). Requirements: Terraform ≥ 1.10, AWS CLI v2, uv.

⚠️ Each step below touches the AWS account. `terraform apply` only ever runs a plan file you've read.

### 0. AWS profile (once)

```bash
aws configure sso --profile jobtracker
#   SSO session name: personal          (reuses the existing session)
#   account: 630773215521 · role: AdministratorAccess
#   default region: us-east-1 · output: json
aws sso login --sso-session personal
aws sts get-caller-identity --profile jobtracker
```

### 1. State bucket (once)

```bash
cd infra/bootstrap
terraform init
terraform plan -out tfplan      # read it
terraform apply tfplan
```

It creates `jobtracker-tfstate-630773215521`, versioned, encrypted and private. Prod's state uses S3's native lockfile (no DynamoDB table). The bootstrap's own state is the local `terraform.tfstate` here (gitignored, holds only the bucket). If it's lost, `terraform import aws_s3_bucket.state jobtracker-tfstate-630773215521`.

### 2. Prod stack

```bash
infra/scripts/build-lambda.sh   # → infra/build/lambda.zip (no AWS access)
cd infra/prod
terraform init
terraform plan -out tfplan      # read it
terraform apply tfplan
terraform output next_steps     # the commands for step 3, with the real endpoint and role ARNs
```

This creates the DSQL cluster (deletion protection on), both Lambdas, the ingest schedule (**disabled**), the Function URL (IAM auth), CloudFront + OAC, the private SPA bucket, the ACM certificate (pending until Phase 4 adds its DNS records: `terraform output acm_validation_records`), the $5 budget alert and 14-day log groups. Rebuild the zip and plan again to ship backend code.

### 3. Database, secrets, data (from `backend/`)

```bash
uv run jobtracker db migrate --dsql <endpoint>          # as admin, waits for each index build
uv run jobtracker db grant-roles --dsql <endpoint> \
  --role jobtracker_api=<api role ARN> --role jobtracker_ingest=<ingest role ARN>
uv run jobtracker aws push-secrets                      # .env → SSM SecureStrings (asks first)
uv run jobtracker db copy-to-dsql --dsql <endpoint> --dry-run   # counts only
uv run jobtracker db copy-to-dsql --dsql <endpoint>             # the copy (asks first)
```

- `push-secrets` writes `GMAIL_APP_PASSWORD`, `ANTHROPIC_API_KEY` and `GOOGLE_SERVICE_ACCOUNT_KEY` to `/jobtracker/prod/…` with the `aws/ssm` key. Terraform never sees them; re-run after rotating one (`--only NAME`). The Lambdas read them at cold start, so a new value takes effect on the next cold start (or redeploy).
- `copy-to-dsql` only reads the local database. Re-running only adds missing rows; `--overwrite` updates existing ones from local. It brings the mail checkpoint (`processed_messages`, `mail_sync_state`) so the Lambda continues after the last mail the local app processed. The local Google OAuth login is never copied.
- **After copying, pick one side.** If the local app keeps scanning, both pay for the same new mail and drift apart.

### 4. Turn on the schedule

First run it once by hand and read the report (it continues from the copied checkpoint):

```bash
aws lambda invoke --profile jobtracker --function-name jobtracker-ingest \
  --cli-binary-format raw-in-base64-out --payload '{"trigger":"manual"}' \
  --cli-read-timeout 700 /tmp/ingest-out.json && cat /tmp/ingest-out.json
```

Then the schedule. `ingest_schedule_enabled` defaults to `true` in `variables.tf` (a one-off `-var` would be undone by the next plan without it); to pause ingest, set it to `false` and apply:

```bash
cd infra/prod
terraform plan -out tfplan && terraform apply tfplan
```

From then on the ingest Lambda reads the inbox every 15 minutes.

### 5. Frontend

```bash
AWS_PROFILE=jobtracker infra/scripts/deploy-frontend.sh   # build, upload to S3, invalidate
```

Until Phase 4 (Cloudflare Access) the API answers **401 to every call**, which is correct: there's no login yet, and no bypass exists in AWS. The Function URL answers 403 to anything not signed by CloudFront.

### Costs

Everything is meant to stay in the free tiers (Lambda, DSQL's 100k DPU + 1 GB, CloudFront, S3, SSM Standard, Scheduler). The budget emails `alexysaguilar@gmail.com` when actual or forecasted monthly spend passes $5. Anthropic usage is billed separately by Anthropic.

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

### Google Calendar (read-only)

Free: the Calendar API has no charge at this volume, and no billing account is needed.

The app reads your calendar as a **service account** you share it with. There's no consent screen, the access never expires, and it works the same once deployed (the Lambda can't open a browser). The account gets **no project roles**: sharing the calendar is its only access.

1. At https://console.cloud.google.com create a project (e.g. `jobtracker`) and, under *APIs & Services → Library*, enable the **Google Calendar API**.
2. *IAM & Admin → Service accounts → Create service account* (e.g. `calendar-reader`). Leave both "grant access" steps empty.
3. On the account: *Keys → Add key → Create new key → JSON*. Leave the download in `~/Downloads`, outside the repo.
4. In Google Calendar: *Settings → your calendar → Share with specific people or groups*, add the account's address with **See all event details**. Events you mark *private* stay hidden from it. Copy the *Calendar ID* from *Integrate calendar* (your Gmail address for the main calendar).
5. From `backend/`: `uv run jobtracker calendar use-service-account ~/Downloads/<key>.json`. It checks the access by reading the calendar's name (no events), then writes `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 of the key) and `GOOGLE_CALENDAR_ID` into `.env`, which becomes owner-only. If you synced before under `primary`, those interviews move to the new ID, so nothing is duplicated.
6. Delete the downloaded key, reload the API (`docker compose up -d --force-recreate api`), and run `uv run jobtracker calendar sync`. The first sync reads from the first campaign's start (else six months back); after that, only changes.

**To cut access**: unshare the calendar, or delete the key in Google Cloud. To rotate it: create a new key, run step 5 again, delete the old one.

**In AWS**: `GOOGLE_SERVICE_ACCOUNT_KEY` goes into SSM as a SecureString with the other secrets (`jobtracker aws push-secrets`), `GOOGLE_CALENDAR_ID` is your Gmail address, and only the service account is used (no OAuth fallback). The ingest Lambda syncs the calendar after the mail. A calendar error is logged and never fails the mail run.

**Fallback, OAuth login** (`jobtracker calendar login`, local only): an OAuth *Desktop app* client (`client_secret*.json` in the repo root, gitignored) with the `calendar.readonly` scope, and your Gmail as a test user. While the consent screen is in *Testing*, Google expires the login after 7 days. Publishing it needs a public home page and privacy policy. The service account is used whenever it's configured. Revoke an old login at https://myaccount.google.com/permissions and run `jobtracker calendar logout`.

## CLI

Run from `backend/` with `uv run jobtracker …` (it reads `../.env`), or inside the container with `docker compose exec api jobtracker …`.

| Command | What it does |
|---|---|
| `db migrate` | Apply migrations (compose runs this automatically) |
| `db migrate --dsql ENDPOINT` | ⚠️ AWS: apply migrations to Aurora DSQL as `admin` (profile `jobtracker`) |
| `db grant-roles --dsql ENDPOINT --role NAME=ARN …` | ⚠️ AWS: one DSQL login role per Lambda, mapped to its IAM role, DML only |
| `db copy-to-dsql --dsql ENDPOINT [--dry-run] [--overwrite]` | ⚠️ AWS: copy the local data (read-only) into DSQL in batches, mail checkpoint included |
| `aws push-secrets [--only NAME]` | ⚠️ AWS: write the secrets from `.env` into SSM SecureStrings |
| `app add --company X --role Y [--applied-at 2026-08-01 --stage rejected]` | Add an application |
| `app import file.csv` | Bulk import (`company,role,applied_at,stage,job_url,company_domain,source_channel,seniority,stack,location,notes`) |
| `app fill-details [--only COMPANY] [--all] [--dry-run]` | ⚠️ Reads each application's own emails again (read-only) and fills its **empty** fields: stack, location, salary, benefits, the job post… One paid call per application, asks first. Never overwrites: what the emails say differently is listed as *kept*. By default only applications with no details yet |
| `app list`, `stats` | Quick look from the terminal |
| `process-eml FILE…` | Run the pipeline on local `.eml` files (dry run by default) ⚠️ paid LLM calls for job-like mail |
| `backfill [--since 2026-09-15] [--until …] [--dry-run] [--limit N]` (defaults to the current campaign's start) | ⚠️ Reads your **real inbox** over a date range, with paid LLM calls. Idempotent |
| `ingest [--dry-run] [--loop 900]` | ⚠️ Incremental run from the last processed UID (what the Lambda does every 15 min) |
| `campaign create --name "Sep 2026" --start 2026-09-15`, `campaign list` | Job-search campaigns (an ongoing earlier one ends the day before) |
| `calendar use-service-account KEY_FILE [--calendar-id ID]` | Connect Google Calendar through a service account it's shared with (no expiry). Checks access, then writes the key and ID into `.env` |
| `calendar login` / `logout` | Fallback: connect with a browser consent (expires in 7 days while in Testing) / forget that login |
| `calendar sync [--full]` | Pull calendar changes and match them to applications. Free: no AI. `ingest` and **Scan inbox & calendar** run it too when connected |
| `calendar list` | The interviews the app knows about |
| `dev seed` | Fake sample data (local only) |
| `eval paste [DIR] [--only NAME]` | ⚠️ Runs the paste prompt over the real pastes in `eval/paste/*.txt` (one paid call each, asks first) and checks each against its approved `.expected.json` |
| `eval details collect` → `snapshot` → `run` | The details eval (files in `eval/details/`): `collect` ⚠️ re-reads each application's emails from Gmail (read-only, no AI); `snapshot` saves the fields you reviewed in the app as the expected result; `run` ⚠️ runs the prompt over the collected emails (one paid call per application, asks first) and reports wrong fills / misses per field, compared with the previous run |

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
- **Scan inbox now** (sidebar) runs the same incremental ingest as `jobtracker ingest` and shows what it found. ⚠️ It reads your real inbox and makes paid LLM calls for job-like mail. Locally it runs inside the API; in AWS it invokes the ingest Lambda (which the schedule runs every 15 minutes). If a run is already going it says so, and a long one finishes in the background.
- **Salary** is typed as a range that formats while you type (`90k`, `90000` → `90,000`), with a currency and *per year / per month* switch. A preview shows exactly what is saved (always yearly; monthly × 12), and it warns when a figure looks like the wrong period.
- Light, dark or system theme from the sidebar.

## Campaigns

A campaign is a job-search period (start date, optional end). Applications belong to the campaign whose range contains their applied date. That's computed, not stored, so editing a campaign's dates re-sorts its applications. The header picker scopes the applications list and stats. Each campaign shows its days running, applications per week, and days to the first interview.

## Interviews and the calendar

An **interview** is one row whatever told us about it: a Google Calendar event, the time in an invite email, or one you add by hand. When the calendar event for an email's interview shows up (same application, within 90 minutes), it takes that row over, so notes stay attached and nothing counts twice.

- **What gets stored from the calendar**: only events that match an application, plus events whose title reads like an interview ("interview", "entrevista", "technical", "recruiter"…) or that were booked through an ATS or scheduler. Those unmatched ones go to the **Inbox** to be assigned. Other events (the dentist) are never stored. Descriptions are read in memory for matching and never saved.
- **Matching**: an assigned invite email for the same event (same `.ics` UID, which survives moves, else the same time) → an attendee's company domain or address → a company name in the title. Assigning one by hand remembers the attendees' domain for that company.
- **Invite emails** with the same UID are one interview: an "updated invitation" moves it, an `.ics` cancellation cancels it, and the calendar event with that UID takes it over even if it was moved. UIDs are recorded for mail processed from 2026-10-20 on; older emails still link by time only.
- **Cancelled or declined** events mark the interview cancelled. It's kept, with its notes, but not counted. A "rescheduled" email in the same thread cancels the old time too.
- **Notes** belong to one interview or are general. On the application page, click an interview to see only its notes; *All notes* shows everything. The dashboard lists interviews from the last two weeks and flags the ones without notes.
- **General talks**: a recruiter or agency call about roles in general (*General talk, no application* in the Inbox). It belongs to no application and isn't counted as an interview. Its notes are a text field on the **Interviews** page, which lists every interview, upcoming and past.
- Interviews feed *next interview*, and past ones count as activity for the ghosted timer. They don't change the stage: emails and your drags still do that.

## How email processing works (short version)

1. **Gmail search** pre-excludes Promotions/Social (`IMAP_QUERY`).
2. **Funnel**: hard excludes (job alerts, "jobs you may like") → allowlist (ATS domains plus your companies' domains, which grows as you add applications) → bilingual EN/ES keyword heuristics. Only heuristic candidates hit a tiny LLM yes/no gate.
3. **Extraction** with structured output (company, role, event type, interview time, needs-reply…). `.ics` invites override the LLM's interview time.
4. **Matching**: same Gmail thread → sender alias → fuzzy company + role → otherwise the **Inbox** page for one-click assignment. Assigning teaches the sender alias so the next email resolves automatically. "Thanks for applying" emails from unknown companies create an application flagged **to review**.
5. Stages are recomputed from the event history. `ghosted` (no news for `GHOST_DAYS`) is computed, never stored.

Privacy: non-job emails store only their Message-ID and a verdict. Job emails store the extracted fields plus a ≤280-character snippet, never full bodies. Logs never include email content.
