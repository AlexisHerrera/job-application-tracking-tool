-- Interviews from Google Calendar, invite emails, or added by hand; notes can belong to one.
-- Calendar sync state and the Google OAuth login (local only: the refresh token never leaves
-- this database).

CREATE TABLE IF NOT EXISTS interviews (
  id uuid PRIMARY KEY,
  application_id uuid REFERENCES applications (id),
  company_hint_id uuid REFERENCES companies (id),
  source text NOT NULL,
  status text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  title text,
  round integer,
  interview_type text,
  location text,
  meeting_url text,
  organizer text,
  attendees jsonb NOT NULL,
  calendar_id text,
  calendar_event_id text,
  ical_uid text,
  html_link text,
  event_id uuid REFERENCES events (id),
  match_method text NOT NULL,
  assigned_by text,
  dismissed boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS interviews_calendar_event_idx
  ON interviews (calendar_id, calendar_event_id);

CREATE INDEX IF NOT EXISTS interviews_application_idx ON interviews (application_id);

CREATE TABLE IF NOT EXISTS calendar_sync_state (
  calendar_id text PRIMARY KEY,
  sync_token text,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_credentials (
  provider text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE interview_notes ADD COLUMN IF NOT EXISTS interview_id uuid;

ALTER TABLE interview_notes ADD COLUMN IF NOT EXISTS body text;
