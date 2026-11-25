-- The sidebar's Review count (GET /api/shell, on every page) counts the postings still new and let
-- through by the rules: status = 'new' AND drop_reason IS NULL. Without an index that reads every
-- row of job_postings, description and AI result included. With status as the key and
-- drop_reason included, DSQL answers it from the index alone (an Index Only Scan). drop_reason is
-- INCLUDEd, not a key column: it's free text, and index keys have a size limit.

CREATE INDEX IF NOT EXISTS job_postings_review_idx ON job_postings (status) INCLUDE (drop_reason);
