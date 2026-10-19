-- Job-search campaigns. Membership is computed from applications.applied_at, so no FK column.

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  started_on date NOT NULL,
  ended_on date,
  notes text,
  created_at timestamptz NOT NULL
);
