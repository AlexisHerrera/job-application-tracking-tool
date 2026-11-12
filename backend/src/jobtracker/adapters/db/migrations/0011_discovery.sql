-- Job discovery (plan §20): postings collected from job sources (JSearch, remoteyeah RSS), the
-- saved searches that collect them, editable criteria/rules, and one row per run (the JSearch
-- request count per month comes from these rows).
-- application_id has no foreign key: deleting an application just leaves a dangling link, which
-- the page shows as "not linked" (same reasoning as process_steps.interview_id).

CREATE TABLE IF NOT EXISTS job_postings (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  source_id text NOT NULL,
  search_id uuid,
  url text NOT NULL,
  title text NOT NULL,
  company text NOT NULL,
  company_normalized text NOT NULL,
  location text,
  employment_type text,
  salary_text text,
  salary_min integer,
  salary_max integer,
  salary_period text,
  publisher text,
  posted_at timestamptz,
  description text NOT NULL,
  fetched_at timestamptz NOT NULL,
  drop_reason text,
  ai_verdict text,
  ai_score integer,
  ai_result jsonb,
  ai_model text,
  prompt_version text,
  status text NOT NULL,
  application_id uuid,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS job_postings_source_idx ON job_postings (source, source_id);

CREATE INDEX IF NOT EXISTS job_postings_fetched_idx ON job_postings (fetched_at);

CREATE INDEX IF NOT EXISTS job_postings_company_idx ON job_postings (company_normalized);

CREATE TABLE IF NOT EXISTS discovery_searches (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  label text NOT NULL,
  params jsonb NOT NULL,
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  trigger text NOT NULL,
  jsearch_requests integer NOT NULL,
  fetched integer NOT NULL,
  new integer NOT NULL,
  dropped integer NOT NULL,
  llm_calls integer NOT NULL,
  errors integer NOT NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS discovery_runs_started_idx ON discovery_runs (started_at);
