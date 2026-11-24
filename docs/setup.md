# Setup, deploy and operations

How to run the app locally, deploy it to AWS, connect Gmail, Google Calendar and Anthropic, and use the CLI. What the app is and does: the [README](../README.md).

Open work: [`plan.md`](plan.md). The design and decisions behind what's built are in git: `git show 95af9fb:docs/plan.md`.

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

Locally, `AUTH_DEV_BYPASS=true` skips the login (Cognito in prod). The app **refuses to start** with that flag when `APP_ENV` isn't `local` or when running inside Lambda.

Editing anything under `backend/src` reloads the API; editing `frontend/src` hot-reloads the page.

### Several worktrees at once (agents in Orca etc.)

Without this, `docker compose up` in a git worktree replaces the main checkout's stack. Give each worktree its own:

```bash
scripts/worktree-env.sh        # once per worktree; prints its URLs
docker compose up -d --build
docker compose exec api jobtracker dev seed   # optional: its database starts empty
docker compose down -v         # before deleting the worktree
```

The script adds `COMPOSE_PROJECT_NAME` and the next free ports (8001/5174/5434, then 8002/5175/5435, …) to the worktree's `.env`. Tests there use the same `DB_PORT`.

The worktree's `.env` has no API keys, and the UI doesn't need them. If you copy the main `.env` in, run the script again afterwards.

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

Everything lives in us-east-1, in one AWS account, through the AWS profile `jobtracker` (SSO session `personal`). Design and decisions: §18 of `git show 95af9fb:docs/plan.md`. Requirements: Terraform ≥ 1.10, AWS CLI v2, uv.

⚠️ Each step below touches the AWS account. `terraform apply` only ever runs a plan file you've read.

### 0. AWS profile (once)

```bash
aws configure sso --profile jobtracker
#   SSO session name: personal          (reuses the existing session)
#   account: <your account ID> · role: AdministratorAccess
#   default region: us-east-1 · output: json
aws sso login --sso-session personal
aws sts get-caller-identity --profile jobtracker
```

The account ID and your email stay out of git: each stack reads them from a gitignored `terraform.tfvars` (prod also reads its state bucket from `backend.hcl`). Copy the templates and fill them in:

```bash
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
cp infra/prod/terraform.tfvars.example infra/prod/terraform.tfvars
cp infra/prod/backend.hcl.example infra/prod/backend.hcl
```

### 1. State bucket (once)

```bash
cd infra/bootstrap
terraform init
terraform plan -out tfplan      # read it
terraform apply tfplan
```

It creates `jobtracker-tfstate-<account ID>`, versioned, encrypted and private. Prod's state uses S3's native lockfile (no DynamoDB table). The bootstrap's own state is the local `terraform.tfstate` here (gitignored, holds only the bucket). If it's lost, `terraform import aws_s3_bucket.state jobtracker-tfstate-<account ID>`.

### 2. Prod stack

```bash
infra/scripts/build-lambda.sh   # → infra/build/lambda.zip (no AWS access)
cd infra/prod
terraform init -backend-config=backend.hcl
terraform plan -out tfplan      # read it
terraform apply tfplan
terraform output next_steps     # the commands for step 3, with the real endpoint and role ARNs
```

This creates the DSQL cluster (deletion protection on), both Lambdas, the ingest schedule (**disabled**), the Function URL (IAM auth), CloudFront + OAC, the private SPA bucket, the ACM certificate (validated through its Route 53 record), the Cognito user pool and login pages, the `jobs` DNS records, the $5 budget alert, 14-day log groups and the GitHub Actions deploy role. The zip is only uploaded when a function is created: after that, code ships through CI (*Shipping changes* below) and Terraform ignores it, so an apply never rolls the code back.

### 3. Database, secrets, data (from `backend/`)

```bash
uv run jobtracker db migrate --dsql <endpoint>          # as admin, waits for each index build
uv run jobtracker db grant-roles --dsql <endpoint> \
  --role jobtracker_api=<api role ARN> --role jobtracker_ingest=<ingest role ARN>
uv run jobtracker aws push-secrets                      # .env → SSM SecureStrings (asks first)
uv run jobtracker db copy-to-dsql --dsql <endpoint> --dry-run   # counts only
uv run jobtracker db copy-to-dsql --dsql <endpoint>             # the copy (asks first)
```

- `push-secrets` writes `GMAIL_APP_PASSWORD` and `GOOGLE_SERVICE_ACCOUNT_KEY` to `/jobtracker/prod/…` with the `aws/ssm` key. Prod has no Anthropic key: see *Anthropic login*. Terraform never sees them; re-run after rotating one (`--only NAME`). The Lambdas read them at cold start, so a new value takes effect on the next cold start (or redeploy).
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

The first time, from the laptop (afterwards CI deploys it, see *Shipping changes*):

```bash
AWS_PROFILE=jobtracker infra/scripts/deploy-frontend.sh   # build, upload to S3, invalidate, smoke test
```

The app is at **https://jobs.alexisherrera.dev**. The page itself is public; every API call needs a Cognito sign-in, and without one the API answers 401 (there's no bypass in AWS). The Function URL answers 403 to anything not signed by CloudFront.

### Shipping changes (GitHub Actions)

Work on a branch, open a PR, merge it to `main`. `.github/workflows/ci.yml` does the rest:

- **On the PR:** the tests for what it touches. Backend: ruff, pytest with a real Postgres (the database tests fail in CI instead of skipping), and the zip built and smoke-tested inside AWS's Lambda image for arm64 (`infra/scripts/smoke-lambda.sh`). Frontend: typecheck and build. `.tf` files: `terraform fmt` and `validate`, with no AWS access.
- **On `main`:** the same tests again, then the deploy of each side that changed since the last passing run on main. A frontend-only change never touches the Lambdas, and a backend-only change never touches the bucket. When both change, the backend goes first.
  - Backend (`infra/scripts/deploy-backend.sh`): if the zip is what's already live, nothing happens. Otherwise it saves the live zip, applies pending migrations to DSQL, updates the three functions, and runs the smoke test.
  - Frontend (`infra/scripts/deploy-frontend.sh`): new assets first, then `index.html`, a CloudFront invalidation, and the smoke test. Assets the new build doesn't use are deleted only after the smoke test passes.
  - Smoke test (`infra/scripts/smoke-prod.sh`), read-only, through CloudFront: `/api/health`, the Cognito config, a 401 without a token, and the live page serving this build's JS. If it fails, the previous Lambda code or `index.html` goes back and the run fails. It never invokes ingest or discover (inbox, paid LLM calls).
- Infrastructure (`.tf`) never deploys from CI: plan and apply it from the laptop as above. A change that needs both (say, a new env var the code reads) is applied before merging.
- *Actions → CI → Run workflow* on `main` tests and deploys everything (it still skips a Lambda zip that's already live).

The workflow assumes the role `jobtracker-github-deploy` through GitHub's OIDC (no AWS keys in GitHub). Only pushes to `main` of this repository can assume it, and it can only replace the three functions' code, write the SPA bucket, invalidate the distribution and connect to DSQL as admin (migrations). Its settings are repository variables, set once after the apply:

```bash
terraform -chdir=infra/prod output -json github_variables \
  | jq -r 'to_entries[] | "\(.key) \(.value)"' \
  | while read -r k v; do gh variable set "$k" --body "$v"; done
```

The same scripts run from the laptop (`AWS_PROFILE=jobtracker infra/scripts/deploy-backend.sh` after `build-lambda.sh`) if GitHub is down.

GitHub's free plan doesn't enforce required checks on private repositories, so a red PR can still be merged. The gate is on `main` itself: nothing deploys unless the tests in that same run pass.

### 6. Signing in (Cognito)

The prod stack creates a user pool with one user, `owner_email`, and sign-up turned off (`infra/prod/cognito.tf`).

1. Creating the user emails a **temporary password** from `no-reply@verificationemail.com` (check spam). It expires after 7 days; to send a new one:
   ```bash
   aws cognito-idp admin-create-user --profile jobtracker \
     --user-pool-id "$(terraform -chdir=infra/prod output -raw user_pool_id)" \
     --username <owner_email> --message-action RESEND
   ```
2. Open https://jobs.alexisherrera.dev. It sends you to the login page: sign in with the email and the temporary password, choose a new password (12+ characters, upper and lower case, a number), then scan the QR code with an authenticator app (Google Authenticator, 1Password, …) and enter its code.
3. From then on every sign-in is password + authenticator code. The session renews itself for 7 days; **Sign out** in the sidebar ends it.

"Forgot your password?" on the login page emails a reset code. There's no self-service reset for a lost authenticator, so use an app that backs up its codes (1Password, Google Authenticator with backup on).

### Costs

Everything is meant to stay in the free tiers (Lambda, DSQL's 100k DPU + 1 GB, CloudFront, S3, SSM Standard, Scheduler). The budget emails `owner_email` when actual or forecasted monthly spend passes $5. Anthropic usage is billed separately by Anthropic.

## Getting the credentials

### Gmail app password (IMAP)

App passwords require 2-Step Verification.

1. Go to https://myaccount.google.com/security and turn on **2-Step Verification** if it's off.
2. Go to https://myaccount.google.com/apppasswords, create an app password named `jobtracker`, and copy the 16-character password.
3. In Gmail, open *Settings → See all settings → Forwarding and POP/IMAP* and make sure **IMAP is enabled**. Under *Labels*, keep **All Mail** visible in IMAP ("Show in IMAP").
4. Put the address and password in `.env` as `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD`.

The ingester opens All Mail **read-only** (`EXAMINE` + `BODY.PEEK`), so it never marks anything as read. Revoking the app password at the same page cuts access immediately.

### Anthropic login (no API keys)

The app has no Anthropic API key, here or in prod.

**On the laptop** it uses your own login, through the Anthropic CLI:

1. Sign in at https://platform.claude.com, open *Settings → Billing*, and add credit (a few dollars lasts a long time with Haiku). Optional: a monthly spend limit under *Settings → Limits*.
2. Install the CLI: `brew install anthropics/tap/ant`.
3. `ant auth login`. It opens the browser; pick the organization and the workspace. `ant auth status` shows who you're logged in as.
4. Start the app as usual. The backend containers mount `~/.config/anthropic` (`docker-compose.yml`) and the SDK uses that session, refreshing it on its own. The host CLI (`uv run jobtracker …`) reads the same folder.

The session lasts until its refresh token expires; then the LLM calls fail with "not logged in to Anthropic" and you run `ant auth login` again. To end it yourself (say, when you stop working), run `ant auth logout`. With a named profile, set `ANTHROPIC_PROFILE` in `.env`. The model is set by `LLM_MODEL` (default `claude-haiku-5-5`).

Don't run the `ingest` container and the API at the same time with a session that's about to refresh: both would refresh the same token at once.

**In prod** the Lambdas use **Workload Identity Federation**. Each Lambda asks AWS STS for a short-lived web identity token for its IAM role (audience `https://api.anthropic.com`), and the SDK trades it for an Anthropic token that lasts 10 minutes. The setup:

- AWS: *IAM → Account settings → Outbound web identity federation* is on. Terraform lets the three Lambda roles call `sts:GetWebIdentityToken` for that audience only (`infra/prod/lambdas.tf`).
- Claude Console → *Workload identity*: the account's STS issuer, the service account `jobtracker-prod`, and the rule `jobtracker-lambdas`. It matches the three roles `jobtracker-{api,ingest,discover}-lambda`, one workspace.
- The rule's IDs are plain env vars on the Lambdas (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_WORKSPACE_ID`, set in `infra/prod/main.tf`).
- A failed exchange shows up in the Console under *Workload identity → Authentication events*, with the reason.

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
