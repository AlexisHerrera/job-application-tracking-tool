-- Found during the first real backfill: HiringRoom is an ATS (LATAM), mindIT HR is an agency.

INSERT INTO ats_providers (domain, provider, kind) VALUES
  ('hiringroom.com', 'hiringroom', 'ats'),
  ('mindithr.com', 'mindit hr', 'agency')
ON CONFLICT (domain) DO NOTHING;
