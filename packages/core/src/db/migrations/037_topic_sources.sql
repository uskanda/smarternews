-- foreign_keys: off
-- A subscribed feed of a news category can be a source of the category's topics: a run then offers the articles
-- the feed delivered within the window to the judge, as candidates of every topic of the category. Off unless the
-- user switches it on, also for a server that existed before.
--
-- A candidate from a feed article comes from a source of a new kind, and remembers that article: its delivered
-- content stands in for the page when the page cannot be fetched, and the article is told which generated article
-- it was written into. SQLite cannot change a CHECK, so `candidates` is made again and takes over its rows with
-- their ids, which `candidate_topics` refers to.

ALTER TABLE feeds ADD COLUMN topic_source INTEGER NOT NULL DEFAULT 0;

-- The generated article a feed article was written into. Null when none was, and again when that article goes.
ALTER TABLE articles ADD COLUMN summarized_in INTEGER REFERENCES articles (id) ON DELETE SET NULL;
CREATE INDEX articles_summarized_in ON articles (summarized_in) WHERE summarized_in IS NOT NULL;

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
  source_kind TEXT NOT NULL CHECK (source_kind IN ('feed', 'news-search', 'llm-search', 'subscription')),
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
  )),
  -- The feed article the candidate was found as, also when another source found the same page.
  feed_article_id INTEGER REFERENCES articles (id) ON DELETE SET NULL
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
