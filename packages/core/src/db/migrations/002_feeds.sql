-- foreign_keys: off
-- Subscribed feeds, their articles and stop words. Feed articles share the articles table with generated
-- ones, so `articles` is rebuilt: a feed article may have no category and has no importance.

ALTER TABLE settings ADD COLUMN feed_interval_minutes INTEGER NOT NULL DEFAULT 30;

CREATE TABLE feeds (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_set_by_user INTEGER NOT NULL DEFAULT 0,
  site_url TEXT,
  category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  -- NULL means the base interval of the settings.
  interval_minutes INTEGER CHECK (interval_minutes BETWEEN 5 AND 1440),
  enabled INTEGER NOT NULL DEFAULT 1,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at TEXT,
  last_succeeded_at TEXT,
  last_error TEXT,
  -- Fetches that failed in a row. Each one doubles the wait before the next try.
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE stop_words (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  -- The text as it is compared: NFKC and lower case.
  normalized TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('title', 'title_and_content')),
  created_at TEXT NOT NULL
);

-- Items a feed has delivered. Kept after their article is purged, for as long as the feed still lists them,
-- so that a purged item does not come back as a new article.
CREATE TABLE feed_items_seen (
  feed_id INTEGER NOT NULL REFERENCES feeds (id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (feed_id, item_key)
);

CREATE TABLE articles_new (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'generated' CHECK (origin IN ('generated', 'feed')),
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  item_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('news', 'event')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  impact TEXT,
  importance INTEGER CHECK (importance BETWEEN 1 AND 5),
  unconfirmed INTEGER NOT NULL DEFAULT 0,
  snippet_only INTEGER NOT NULL DEFAULT 0,
  first_published_at TEXT NOT NULL,
  -- For a feed article this is the time it sorts by: the published time, or the fetch time.
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
  event_registration TEXT CHECK (event_registration IN ('required', 'not_required', 'unknown')),
  author TEXT,
  -- The content without markup and link targets, for matching stop words.
  content_text TEXT NOT NULL DEFAULT '',
  -- The stop word that hides this feed article, unless it is starred.
  stop_word_id INTEGER REFERENCES stop_words (id) ON DELETE SET NULL,
  CHECK (
    (origin = 'generated' AND feed_id IS NULL AND category_id IS NOT NULL AND importance IS NOT NULL)
    OR (origin = 'feed' AND feed_id IS NOT NULL AND item_key IS NOT NULL AND importance IS NULL)
  )
);

INSERT INTO articles_new
  (id, category_id, origin, kind, title, summary, body, impact, importance, unconfirmed, snippet_only,
   first_published_at, updated_at, revision, is_read, starred, previous_article_id, event_key, event_starts_at,
   event_ends_at, event_venue, event_fee, event_registration)
SELECT id, category_id, 'generated', kind, title, summary, body, impact, importance, unconfirmed, snippet_only,
       first_published_at, updated_at, revision, is_read, starred, previous_article_id, event_key, event_starts_at,
       event_ends_at, event_venue, event_fee, event_registration
  FROM articles;

DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;

CREATE INDEX articles_category_updated ON articles (category_id, updated_at, id);
CREATE INDEX articles_updated ON articles (updated_at, id);
CREATE INDEX articles_event ON articles (category_id, event_key);
CREATE INDEX articles_feed_updated ON articles (feed_id, updated_at, id);
CREATE UNIQUE INDEX articles_feed_item ON articles (feed_id, item_key) WHERE feed_id IS NOT NULL;
CREATE INDEX articles_stop_word ON articles (stop_word_id) WHERE stop_word_id IS NOT NULL;
-- Feed articles arrive by the thousand, and most are read. These keep the usual questions off the wide rows:
-- the unread list, the list of one origin, and the counts (answered from the last index alone).
CREATE INDEX articles_unread ON articles (updated_at, id) WHERE is_read = 0;
CREATE INDEX articles_category_unread ON articles (category_id, updated_at, id) WHERE is_read = 0;
CREATE INDEX articles_origin_updated ON articles (origin, updated_at, id);
CREATE INDEX articles_counts ON articles (category_id, feed_id, origin, is_read, starred, stop_word_id, kind, event_ends_at);
