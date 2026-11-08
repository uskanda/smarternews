-- Attention: what a run went through that the user should look at. The items are worked out from the tables each
-- time they are asked for; only the record of what was searched and of what the user dismissed is stored.

-- One row for each search a run made: one per engine and query of news search, one per topic of web search by the
-- model. Feeds are not recorded. Deleted with the run, after 30 days.
CREATE TABLE search_attempts (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('news-search', 'llm-search')),
  -- NULL for web search by the model.
  engine TEXT,
  -- The query of news search, or the topic's text for web search by the model.
  query TEXT NOT NULL,
  -- 0 when the search ended in an error. Its counts are then 0 and mean nothing.
  ok INTEGER NOT NULL,
  -- The results the source returned, before those an earlier run settled were left out.
  returned INTEGER NOT NULL,
  -- Google News only: the redirect links the search tried to resolve, and how many of them it could not.
  google_attempted INTEGER NOT NULL DEFAULT 0,
  google_unresolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX search_attempts_source ON search_attempts (topic_id, kind, engine, query, id);
CREATE INDEX search_attempts_run ON search_attempts (run_id);
CREATE INDEX search_attempts_created ON search_attempts (created_at);

-- The attention items the user dismissed, by their key. A key names the kind, the target and what set the item
-- off, so that the same target comes back when something new sets it off. Deleted after 30 days.
CREATE TABLE attention_dismissals (
  key TEXT PRIMARY KEY,
  dismissed_at TEXT NOT NULL
);
CREATE INDEX attention_dismissals_at ON attention_dismissals (dismissed_at);
