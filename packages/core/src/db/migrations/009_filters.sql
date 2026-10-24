-- foreign_keys: off
-- Filters replace stop words. A filter hides the feed articles that meet all its conditions (hide), or those
-- of its scope that meet none of the keep filters there (keep). Which filter matches which article is kept in
-- `filter_matches`, apart from scope and the enabled switch, so that moving a feed or switching a filter needs
-- no new matching. Whether a feed article is hidden is kept on the article (`filtered`), so lists and counts
-- stay on the article's own columns. `articles` is rebuilt because `stop_word_id` is a foreign key.

CREATE TABLE filters (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('hide', 'keep')),
  scope TEXT NOT NULL CHECK (scope IN ('all', 'category', 'feed')),
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  -- A keep filter over everything would hide every feed article that does not match it.
  CHECK (NOT (action = 'keep' AND scope = 'all')),
  CHECK (
    (scope = 'all' AND category_id IS NULL AND feed_id IS NULL)
    OR (scope = 'category' AND category_id IS NOT NULL AND feed_id IS NULL)
    OR (scope = 'feed' AND feed_id IS NOT NULL AND category_id IS NULL)
  )
);

-- The conditions of a filter, all of which an article must meet. `fields` is a JSON list of the fields an
-- article may meet the condition in: title, content, author, url.
CREATE TABLE filter_conditions (
  filter_id INTEGER NOT NULL REFERENCES filters (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  fields TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('contains', 'regex')),
  value TEXT NOT NULL,
  -- The value as it is compared: NFKC, and lower case for `contains`.
  normalized TEXT NOT NULL,
  PRIMARY KEY (filter_id, position)
);

INSERT INTO filters (id, action, scope, enabled, created_at)
SELECT id, 'hide', 'all', 1, created_at FROM stop_words;

INSERT INTO filter_conditions (filter_id, position, fields, method, value, normalized)
SELECT id, 0, CASE scope WHEN 'title' THEN '["title"]' ELSE '["title","content"]' END, 'contains', text, normalized
  FROM stop_words;

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
  -- When the row was stored.
  created_at TEXT NOT NULL DEFAULT '',
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
  -- The content without markup and link targets, for matching filters.
  content_text TEXT NOT NULL DEFAULT '',
  -- 1 when an enabled filter hides this feed article, whether it is starred or not. A star keeps it visible.
  filtered INTEGER NOT NULL DEFAULT 0,
  auto_summary TEXT,
  auto_summary_source TEXT CHECK (auto_summary_source IN ('page', 'feed')),
  auto_summary_at TEXT,
  auto_summary_attempts INTEGER NOT NULL DEFAULT 0,
  auto_summary_skipped INTEGER NOT NULL DEFAULT 0,
  auto_summary_requested_at TEXT,
  translated_title TEXT,
  source_language TEXT,
  CHECK (
    (origin = 'generated' AND feed_id IS NULL AND category_id IS NOT NULL AND importance IS NOT NULL)
    OR (origin = 'feed' AND feed_id IS NOT NULL AND item_key IS NOT NULL AND importance IS NULL)
  ),
  CHECK (origin = 'feed' OR filtered = 0)
);

-- What a stop word hid stays hidden until the first start matches the filters again.
INSERT INTO articles_new
  (id, category_id, origin, feed_id, item_key, kind, title, summary, body, impact, importance, unconfirmed,
   snippet_only, first_published_at, updated_at, created_at, revision, is_read, starred, previous_article_id,
   event_key, event_starts_at, event_ends_at, event_venue, event_fee, event_registration, author, content_text,
   filtered, auto_summary, auto_summary_source, auto_summary_at, auto_summary_attempts, auto_summary_skipped,
   auto_summary_requested_at, translated_title, source_language)
SELECT id, category_id, origin, feed_id, item_key, kind, title, summary, body, impact, importance, unconfirmed,
       snippet_only, first_published_at, updated_at, created_at, revision, is_read, starred, previous_article_id,
       event_key, event_starts_at, event_ends_at, event_venue, event_fee, event_registration, author, content_text,
       CASE WHEN origin = 'feed' AND stop_word_id IS NOT NULL THEN 1 ELSE 0 END, auto_summary, auto_summary_source,
       auto_summary_at, auto_summary_attempts, auto_summary_skipped, auto_summary_requested_at, translated_title,
       source_language
  FROM articles;

DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;
DROP TABLE stop_words;

CREATE INDEX articles_category_updated ON articles (category_id, updated_at, id);
CREATE INDEX articles_updated ON articles (updated_at, id);
CREATE INDEX articles_event ON articles (category_id, event_key);
CREATE INDEX articles_feed_updated ON articles (feed_id, updated_at, id);
CREATE UNIQUE INDEX articles_feed_item ON articles (feed_id, item_key) WHERE feed_id IS NOT NULL;
CREATE INDEX articles_unread ON articles (updated_at, id) WHERE is_read = 0;
CREATE INDEX articles_category_unread ON articles (category_id, updated_at, id) WHERE is_read = 0;
CREATE INDEX articles_origin_updated ON articles (origin, updated_at, id);
CREATE INDEX articles_counts ON articles (category_id, feed_id, origin, is_read, starred, filtered, kind, event_ends_at);

-- Pairs of a filter and a feed article that meets all its conditions, whatever the filter's scope and
-- whether it is enabled.
CREATE TABLE filter_matches (
  filter_id INTEGER NOT NULL REFERENCES filters (id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  PRIMARY KEY (filter_id, article_id)
) WITHOUT ROWID;
CREATE INDEX filter_matches_article ON filter_matches (article_id, filter_id);

-- A row here means `filter_matches` has not been built yet: the first start matches every filter against
-- every feed article, which SQL alone cannot do as the server does it.
CREATE TABLE filter_matches_pending (since TEXT NOT NULL);
INSERT INTO filter_matches_pending (since) SELECT datetime('now') WHERE EXISTS (SELECT 1 FROM filters);
