-- Timestamps are ISO 8601 strings in UTC. Lists are JSON arrays.

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reader_info TEXT NOT NULL DEFAULT '',
  output_language TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  search_language TEXT NOT NULL,
  search_region TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('news', 'event')),
  schedule TEXT NOT NULL,
  min_importance INTEGER NOT NULL CHECK (min_importance BETWEEN 1 AND 5),
  max_articles_per_run INTEGER NOT NULL CHECK (max_articles_per_run >= 1),
  window_hours INTEGER,
  window_days INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE topics (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  interpreted INTEGER NOT NULL DEFAULT 0,
  queries TEXT NOT NULL DEFAULT '[]',
  criteria TEXT NOT NULL DEFAULT '',
  feeds TEXT NOT NULL DEFAULT '[]',
  news_search INTEGER NOT NULL DEFAULT 0,
  llm_search INTEGER NOT NULL DEFAULT 0,
  sources_set_by_user INTEGER NOT NULL DEFAULT 0,
  search_language TEXT,
  search_region TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX topics_category ON topics (category_id);

-- URLs whose judgement is settled. Kept after the candidate rows are purged so they are never judged twice.
CREATE TABLE seen_urls (
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (category_id, url)
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  slot TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'stopped_by_limit')),
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  collected INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  articles_created INTEGER NOT NULL DEFAULT 0,
  articles_updated INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  failures TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX runs_category ON runs (category_id, queued_at);
CREATE UNIQUE INDEX runs_slot ON runs (category_id, slot) WHERE slot IS NOT NULL;

CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('news', 'event')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  impact TEXT,
  importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  unconfirmed INTEGER NOT NULL DEFAULT 0,
  snippet_only INTEGER NOT NULL DEFAULT 0,
  first_published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  previous_article_id INTEGER REFERENCES articles (id) ON DELETE SET NULL,
  event_key TEXT,
  event_starts_at TEXT,
  event_ends_at TEXT,
  event_venue TEXT,
  event_fee TEXT,
  event_registration TEXT CHECK (event_registration IN ('required', 'not_required', 'unknown'))
);
CREATE INDEX articles_category_updated ON articles (category_id, updated_at, id);
CREATE INDEX articles_updated ON articles (updated_at, id);
CREATE INDEX articles_event ON articles (category_id, event_key);

CREATE TABLE article_refs (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  site_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  position INTEGER NOT NULL,
  UNIQUE (article_id, url)
);

CREATE TABLE article_topics (
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, topic_id)
);

CREATE TABLE candidates (
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
  created_at TEXT NOT NULL
);
CREATE INDEX candidates_run ON candidates (run_id, status);
CREATE INDEX candidates_category_status ON candidates (category_id, status);

CREATE TABLE candidate_topics (
  candidate_id INTEGER NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  PRIMARY KEY (candidate_id, topic_id)
);

CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX llm_calls_created ON llm_calls (created_at);
