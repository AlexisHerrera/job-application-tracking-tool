-- Yearly salary range and free-text benefits on applications.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS salary_min bigint;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS salary_max bigint;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS salary_currency text;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS benefits text;
