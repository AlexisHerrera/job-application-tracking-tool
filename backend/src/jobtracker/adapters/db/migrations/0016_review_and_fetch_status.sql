-- What the Insights page and the Sources status table need (plan "Insights and source status").
--
-- job_postings.reviewed_at: when the posting left the review queue (saved, applied or discarded),
-- set by discovery.set_status and cleared when it goes back to new. updated_at can't tell this:
-- scoring, re-applying the rules and blocking a company move it too. Postings reviewed before
-- this get their updated_at, which is when they were reviewed unless something moved it since.
--
-- discovery_searches: how each saved search's last fetch went (runs only stored totals).
-- last_count is how many postings it brought (after Workable's engineering-title filter),
-- last_found_at the last fetch that brought any, last_status "ok" or the error, and fail_streak
-- the failed fetches in a row (0 after one that works).
--
-- discovery_companies: the same for the watched boards, next to last_checked_at, last_status and
-- jobs_kept: last_found_at is the last check that kept a role. Boards that kept one at their last
-- check start with that check's time.

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

UPDATE job_postings SET reviewed_at = updated_at WHERE status <> 'new' AND reviewed_at IS NULL;

ALTER TABLE discovery_searches ADD COLUMN IF NOT EXISTS last_fetched_at timestamptz;

ALTER TABLE discovery_searches ADD COLUMN IF NOT EXISTS last_found_at timestamptz;

ALTER TABLE discovery_searches ADD COLUMN IF NOT EXISTS last_status text;

ALTER TABLE discovery_searches ADD COLUMN IF NOT EXISTS last_count integer;

ALTER TABLE discovery_searches ADD COLUMN IF NOT EXISTS fail_streak integer;

ALTER TABLE discovery_companies ADD COLUMN IF NOT EXISTS last_found_at timestamptz;

ALTER TABLE discovery_companies ADD COLUMN IF NOT EXISTS fail_streak integer;

UPDATE discovery_companies SET last_found_at = last_checked_at
  WHERE jobs_kept > 0 AND last_found_at IS NULL;
