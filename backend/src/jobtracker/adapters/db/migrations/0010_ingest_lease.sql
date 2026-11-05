-- One ingest run at a time in AWS. Aurora DSQL has no advisory locks, so a run takes a lease:
-- a row it writes with a conditional upsert. Two runs that start together write the same row,
-- and DSQL's optimistic concurrency lets only one of them commit. A lease left by a run that
-- crashed expires on its own (expires_at). Local scans keep using the advisory lock.

CREATE TABLE IF NOT EXISTS ingest_lease (
  name text PRIMARY KEY,
  holder text NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
