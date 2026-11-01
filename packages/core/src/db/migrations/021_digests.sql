-- Digests: at the times of `settings.digest_schedule`, a model sums up the generated and feed articles of a
-- period. They live apart from `articles`, so that no question about generated articles has to leave them out.
-- `sections` is JSON: one entry per category, with its id, its name when the digest was made, and its lines,
-- each with its text and the ids of its source articles. The ids are not references: a digest outlives them.
CREATE TABLE digests (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'catch-up', 'manual')),
  -- The scheduled time as local date and time, for example 2026-03-02T07:00. NULL for a digest made by hand.
  slot TEXT,
  executive_summary TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  article_count INTEGER NOT NULL
);
CREATE UNIQUE INDEX digests_slot ON digests (slot) WHERE slot IS NOT NULL;
CREATE INDEX digests_created ON digests (created_at, id);

-- The times a digest is made, as a JSON list of HH:MM in the time zone of the settings.
ALTER TABLE settings ADD COLUMN digest_schedule TEXT NOT NULL DEFAULT '["07:00","19:00"]';
