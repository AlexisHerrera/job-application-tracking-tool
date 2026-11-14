-- Search fields on job postings (plan §20, "Search and filters"): copies of what the LLM reads
-- from each posting (and the salary turned into USD a year), as plain columns so the Discover
-- page filters them in SQL. ai_result keeps the full answer. Technologies are one text column
-- holding "|TypeScript|React|" (no arrays on DSQL), matched with LIKE. Postings scored before
-- this have these empty until they're scored again.

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS seniority text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS years_required integer;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS location_fit text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS work_mode text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS employer_kind text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS company_size text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS sector text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS technologies text;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS ai_related boolean;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS salary_usd_min integer;

ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS salary_usd_max integer;
