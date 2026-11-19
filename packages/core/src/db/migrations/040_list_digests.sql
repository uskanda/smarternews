-- Digests gain the trigger "list": a digest the reader made of a list of articles, such as the articles of a
-- name, a search or the starred articles. `target` is JSON: the kind of list, what names it, and the label the
-- screens show in place of the period. NULL for every digest of a period. SQLite cannot change a CHECK, so the
-- table is made again and takes over its rows with their ids. No table refers to digests.

CREATE TABLE digests_new (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'catch-up', 'manual', 'list')),
  -- The scheduled time as local date and time, for example 2026-03-02T07:00. NULL for a digest made by hand.
  slot TEXT,
  executive_summary TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  article_count INTEGER NOT NULL,
  target TEXT
);
INSERT INTO digests_new (id, period_start, period_end, created_at, trigger, slot, executive_summary, sections, article_count)
  SELECT id, period_start, period_end, created_at, trigger, slot, executive_summary, sections, article_count FROM digests;
DROP TABLE digests;
ALTER TABLE digests_new RENAME TO digests;
CREATE UNIQUE INDEX digests_slot ON digests (slot) WHERE slot IS NOT NULL;
CREATE INDEX digests_created ON digests (created_at, id);
