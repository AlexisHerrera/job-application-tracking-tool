-- DSQL-compatible schema: one statement per transaction (the runner splits on ';'),
-- no arrays, triggers, sequences or TRUNCATE. Every statement is idempotent.

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL,
  website text,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS companies_normalized_name_uq ON companies (normalized_name);

CREATE TABLE IF NOT EXISTS company_aliases (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  kind text NOT NULL,
  value text NOT NULL,
  learned_from text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS company_aliases_kind_value_uq ON company_aliases (kind, value);

CREATE INDEX IF NOT EXISTS company_aliases_company_idx ON company_aliases (company_id);

CREATE TABLE IF NOT EXISTS ats_providers (
  domain text PRIMARY KEY,
  provider text NOT NULL,
  kind text NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  role_title text NOT NULL,
  job_url text,
  job_description text,
  source_ats text,
  source_channel text,
  seniority text,
  stack jsonb NOT NULL,
  location text,
  applied_at timestamptz,
  current_stage text NOT NULL,
  current_round integer,
  max_stage_reached text NOT NULL,
  outcome text,
  last_event_at timestamptz,
  next_interview_at timestamptz,
  origin text NOT NULL,
  needs_review boolean NOT NULL,
  notes text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS applications_company_idx ON applications (company_id);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  application_id uuid REFERENCES applications (id),
  company_hint_id uuid REFERENCES companies (id),
  kind text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  message_id text,
  gm_thread_id text,
  in_reply_to text,
  refs text,
  from_address text,
  from_name text,
  subject text,
  snippet text,
  stage_implied text,
  round integer,
  interview_at timestamptz,
  needs_reply boolean NOT NULL,
  replied_at timestamptz,
  summary text,
  confidence double precision,
  extraction jsonb,
  model text,
  filter_path text,
  match_method text NOT NULL,
  assigned_by text,
  dismissed boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS events_message_id_uq ON events (message_id);

CREATE INDEX IF NOT EXISTS events_application_idx ON events (application_id);

CREATE INDEX IF NOT EXISTS events_thread_idx ON events (gm_thread_id);

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id text PRIMARY KEY,
  uid bigint,
  verdict text NOT NULL,
  stage text,
  reason text,
  processed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_sync_state (
  mailbox text PRIMARY KEY,
  uidvalidity bigint NOT NULL,
  last_uid bigint NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS interview_notes (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications (id),
  round integer,
  interview_at timestamptz,
  interview_type text,
  interviewers text,
  questions jsonb NOT NULL,
  self_rating integer,
  went_well text,
  went_wrong text,
  topics_to_study jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS interview_notes_application_idx ON interview_notes (application_id);

CREATE TABLE IF NOT EXISTS study_reports (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  model text NOT NULL,
  input_summary text,
  content_md text NOT NULL
);
