-- Rules act on a feed article when it is first stored: they star it, mark it read, make it one the app
-- notifies, or ask for its summary. Unlike filters they never apply to what is stored already, so what a rule
-- matched is not kept; only what it did is, on the article. The conditions have the form of a filter's and are
-- kept as JSON, as the API gives them.

CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('all', 'category', 'feed')),
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- A JSON list of conditions: fields, match and value, as a filter's.
  conditions TEXT NOT NULL,
  star INTEGER NOT NULL DEFAULT 0,
  mark_read INTEGER NOT NULL DEFAULT 0,
  notify INTEGER NOT NULL DEFAULT 0,
  summarize INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (star + mark_read + notify + summarize > 0),
  CHECK (
    (scope = 'all' AND category_id IS NULL AND feed_id IS NULL)
    OR (scope = 'category' AND category_id IS NOT NULL AND feed_id IS NULL)
    OR (scope = 'feed' AND feed_id IS NOT NULL AND category_id IS NULL)
  )
);

-- When a rule made the article one the app notifies. Not set when a rule also marked it read.
ALTER TABLE articles ADD COLUMN rule_notify_at TEXT;
-- When a rule asked for the article's summary: it then waits for one whatever its feed says, read or not.
ALTER TABLE articles ADD COLUMN rule_summary_requested_at TEXT;

CREATE INDEX articles_rule_notify ON articles (rule_notify_at) WHERE rule_notify_at IS NOT NULL;
