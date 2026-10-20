-- The .ics UID an invite email carried: links it to the calendar event even after a move.
-- General interviews: a recruiter or agency talk about roles, tied to no application.

ALTER TABLE events ADD COLUMN IF NOT EXISTS ical_uid text;

CREATE INDEX IF NOT EXISTS events_ical_uid_idx ON events (ical_uid);

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS general boolean;

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS notes text;

-- Now IT recruits for several companies (e.g. Tapi), so its domain never identifies one.
INSERT INTO ats_providers (domain, provider, kind) VALUES
  ('nowit.io', 'now it', 'agency')
ON CONFLICT (domain) DO NOTHING;
