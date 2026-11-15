-- Company watchlist (plan §21): companies whose public ATS job board (Ashby, Greenhouse, Lever)
-- a discovery run reads. `slug` is the board's name in the ATS URL (Lever's is case-sensitive).
-- jobs_total / jobs_kept are from the last check: how many jobs the board listed and how many
-- were engineering roles in an allowed location (only those are stored as postings).

CREATE TABLE IF NOT EXISTS discovery_companies (
  id uuid PRIMARY KEY,
  ats text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL,
  note text,
  created_at timestamptz NOT NULL,
  last_checked_at timestamptz,
  last_status text,
  jobs_total integer,
  jobs_kept integer
);

CREATE UNIQUE INDEX IF NOT EXISTS discovery_companies_board_idx ON discovery_companies (ats, slug);

-- JSearch is switched off (plan §21): its results were mostly reposts and spam. The searches stay
-- in the table, disabled, and can be turned back on from the page.
UPDATE discovery_searches SET enabled = false WHERE source = 'jsearch';
