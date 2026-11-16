-- foreign_keys: off
-- The reader can stop the follow-ups of a generated article: a run then rejects, before writing, the stories the
-- clustering ties to it, as it does for an article marked as a miss. The mark goes with the article, so it is a
-- column of it. The two kinds of these rejections are added to the reason codes of candidates; SQLite cannot change
-- a CHECK, so `candidates` is made again and takes over its rows with their ids, which `candidate_topics` refers to.

ALTER TABLE articles ADD COLUMN follow_ups_stopped INTEGER NOT NULL DEFAULT 0;

CREATE TABLE candidates_new (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  fetchable INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  site_name TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('feed', 'news-search', 'llm-search')),
  status TEXT NOT NULL CHECK (status IN ('rejected', 'pending', 'accepted')),
  reason TEXT NOT NULL DEFAULT '',
  importance INTEGER,
  group_key TEXT,
  body TEXT,
  article_id INTEGER REFERENCES articles (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reason_code TEXT CHECK (reason_code IN (
    'no-date', 'below-minimum', 'over-limit', 'event-outside-window', 'event-no-date',
    'missed-follow-up', 'stopped-follow-up'
  ))
);
INSERT INTO candidates_new (
  id, category_id, run_id, url, fetchable, title, snippet, site_name, published_at, source_kind, status, reason,
  importance, group_key, body, article_id, created_at, reason_code
)
SELECT id, category_id, run_id, url, fetchable, title, snippet, site_name, published_at, source_kind, status, reason,
       importance, group_key, body, article_id, created_at, reason_code
  FROM candidates;
DROP TABLE candidates;
ALTER TABLE candidates_new RENAME TO candidates;
CREATE INDEX candidates_run ON candidates (run_id, status);
CREATE INDEX candidates_category_status ON candidates (category_id, status);
CREATE INDEX candidates_category_created ON candidates (category_id, created_at);
