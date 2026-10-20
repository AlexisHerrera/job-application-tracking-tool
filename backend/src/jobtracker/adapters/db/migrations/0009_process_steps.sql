-- The steps a hiring process is expected to have (what the recruiter said), in order. A step is
-- matched to one of the application's interviews automatically, or by hand; one with no
-- calendar event (a take-home) is marked done by hand.
-- interview_id has no foreign key: an interview from an email can be deleted by a recompute,
-- and a link to a missing interview just counts as unmatched.

CREATE TABLE IF NOT EXISTS process_steps (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications (id),
  position integer NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  optional boolean NOT NULL,
  link text NOT NULL,
  interview_id uuid,
  done_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS process_steps_application_idx ON process_steps (application_id);
