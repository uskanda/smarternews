-- A reader opened a feed article while its summary was still waited for. Such an article keeps waiting
-- after it is read, and goes before the others. NULL for an article nobody asked about.

ALTER TABLE articles ADD COLUMN auto_summary_requested_at TEXT;
