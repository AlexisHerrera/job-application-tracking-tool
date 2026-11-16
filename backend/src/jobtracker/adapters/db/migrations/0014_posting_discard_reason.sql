-- Why a posting was discarded on the Discover page ("closed", "too_senior", "salary"…; the list
-- is discovery.DISCARD_REASONS) and an optional note. Only set while status = 'dismissed'. They
-- are there to tune the rules and the criteria later from what gets discarded by hand.

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS discard_reason text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS discard_note text;
