-- The Apply area (plan "Apply"): your experience, the open questions application forms ask with
-- your answers, and the one-line facts you give on every form. No foreign keys: a question's
-- sources are deleted with it by the repo.
--
-- form_questions.normalized is the question's words with the company's name replaced by
-- "company" (core/apply.normalize), so the same question from two forms is one row.
-- form_question_sources: each form (or paste) that asked it, with that form's wording.
--
-- The facts start with the ones forms asked in the first batch (2026-11-24), with no values. The
-- questions come from `jobtracker apply collect-questions`, not from here: this repository is
-- public, and where you applied is not.

CREATE TABLE IF NOT EXISTS experiences (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  company text NOT NULL,
  period text NOT NULL,
  summary text NOT NULL,
  context text NOT NULL,
  contribution text NOT NULL,
  results text NOT NULL,
  stack text NOT NULL,
  links text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS form_questions (
  id uuid PRIMARY KEY,
  text text NOT NULL,
  normalized text NOT NULL,
  category text NOT NULL,
  answer text NOT NULL,
  style_notes text NOT NULL,
  answered_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS form_questions_normalized_uq ON form_questions (normalized);

CREATE TABLE IF NOT EXISTS form_question_sources (
  question_id uuid NOT NULL,
  url text NOT NULL,
  company text NOT NULL,
  role_title text NOT NULL,
  ats text NOT NULL,
  text text NOT NULL,
  seen_at timestamptz NOT NULL,
  PRIMARY KEY (question_id, url)
);

CREATE TABLE IF NOT EXISTS apply_facts (
  key text PRIMARY KEY,
  label text NOT NULL,
  value text NOT NULL,
  notes text NOT NULL,
  position integer NOT NULL,
  updated_at timestamptz NOT NULL
);

INSERT INTO apply_facts (key, label, value, notes, position, updated_at) VALUES
  ('location', 'Where you live', '', 'City and country, as forms want it written out', 0, '2026-11-24T12:00:00Z'),
  ('work_authorization', 'Authorized to work where you live?', '', '', 1, '2026-11-24T12:00:00Z'),
  ('visa_sponsorship', 'Need visa sponsorship, now or later?', '', '', 2, '2026-11-24T12:00:00Z'),
  ('work_mode', 'Office, hybrid or remote, and open to relocating?', '', '', 3, '2026-11-24T12:00:00Z'),
  ('pay_monthly', 'Pay expectation, monthly (USD)', '', 'Say whether it''s net or gross', 4, '2026-11-24T12:00:00Z'),
  ('pay_yearly', 'Pay expectation, yearly (USD)', '', '', 5, '2026-11-24T12:00:00Z'),
  ('pay_hourly', 'Pay expectation, hourly (USD)', '', 'For contractor roles', 6, '2026-11-24T12:00:00Z'),
  ('notice_period', 'Notice period / earliest start', '', '', 7, '2026-11-24T12:00:00Z'),
  ('english', 'English level', '', 'CEFR (e.g. C1) and a plain description', 8, '2026-11-24T12:00:00Z'),
  ('spanish', 'Spanish level', '', '', 9, '2026-11-24T12:00:00Z'),
  ('us_hours', 'Latest US Eastern time you can take calls', '', '', 10, '2026-11-24T12:00:00Z'),
  ('travel', 'Open to travel?', '', '', 11, '2026-11-24T12:00:00Z'),
  ('on_call', 'Can join an on-call rotation?', '', '', 12, '2026-11-24T12:00:00Z'),
  ('years_experience', 'Years of experience', '', '', 13, '2026-11-24T12:00:00Z'),
  ('main_backend_language', 'Backend language you''ve used most in production', '', '', 14, '2026-11-24T12:00:00Z'),
  ('fullstack_production', 'Built both back and front end of a live product?', '', '', 15, '2026-11-24T12:00:00Z'),
  ('agency_experience', 'Worked at an agency or consultancy?', '', '', 16, '2026-11-24T12:00:00Z'),
  ('ai_level', 'How far your AI use goes', '', 'Chat only → tools connected → agents (Claude Code, MCP) → building agents', 17, '2026-11-24T12:00:00Z'),
  ('other_processes', 'In other hiring processes?', '', '', 18, '2026-11-24T12:00:00Z'),
  ('freelance', 'Active freelance contracts?', '', '', 19, '2026-11-24T12:00:00Z'),
  ('linkedin', 'LinkedIn URL', '', '', 20, '2026-11-24T12:00:00Z'),
  ('github', 'GitHub URL', '', '', 21, '2026-11-24T12:00:00Z'),
  ('portfolio', 'Portfolio / personal site', '', '', 22, '2026-11-24T12:00:00Z'),
  ('pronouns', 'Pronouns (optional)', '', '', 23, '2026-11-24T12:00:00Z')
ON CONFLICT (key) DO NOTHING;
