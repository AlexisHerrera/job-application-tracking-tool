-- Recruiting agencies: a recruiter there writes about many companies, so the sender never
-- identifies the company. kind = 'agency' rows are excluded from the ATS allowlist logic.

INSERT INTO ats_providers (domain, provider, kind) VALUES
  ('silver.dev', 'silver.dev', 'agency')
ON CONFLICT (domain) DO NOTHING;
