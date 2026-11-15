-- The relevance order: a list sorted by an article's time moved later by its relevance, at most 48 hours. Relevance
-- runs from 0 to 1. A generated article's comes from its importance, 1 to 5. A feed article's is half the
-- behaviour score of its feed and half whether its titles or summary have a highlight term. No model is involved.

-- The behaviour score of a feed: how much more often than the others its recent articles are opened or starred,
-- from 0 to 1. Worked out once a day; a new article of the feed takes it.
ALTER TABLE feeds ADD COLUMN relevance_score REAL NOT NULL DEFAULT 0;

-- The feed's behaviour score, copied to its articles: a generated column cannot read another table.
ALTER TABLE articles ADD COLUMN feed_score REAL NOT NULL DEFAULT 0;
-- 1 when the title, the translated title or the summary of a feed article has a highlight term, as the apps match.
ALTER TABLE articles ADD COLUMN term_match INTEGER NOT NULL DEFAULT 0;
-- What the relevance order sorts by: the time lists sort by, plus two days times the relevance, as an ISO time.
-- Generated, so that whatever writes the time, the importance or the scores keeps it right.
ALTER TABLE articles ADD COLUMN rank_at TEXT GENERATED ALWAYS AS (
  strftime('%Y-%m-%dT%H:%M:%fZ', julianday(updated_at) + 2.0 * (
    CASE WHEN origin = 'generated' THEN (coalesce(importance, 1) - 1) / 4.0
         ELSE 0.5 * feed_score + 0.5 * term_match END))
) VIRTUAL;

-- The same pairs as the indexes on updated_at.
CREATE INDEX articles_rank ON articles (rank_at, id);
CREATE INDEX articles_unread_rank ON articles (rank_at, id) WHERE is_read = 0;
CREATE INDEX articles_category_rank ON articles (category_id, rank_at, id);
CREATE INDEX articles_category_unread_rank ON articles (category_id, rank_at, id) WHERE is_read = 0;
CREATE INDEX articles_feed_rank ON articles (feed_id, rank_at, id);
CREATE INDEX articles_origin_rank ON articles (origin, rank_at, id);

-- List views may sort by relevance. SQLite cannot change a CHECK, so the table is made again and takes over its
-- rows with their ids, as in 031. No table refers to list_views, so the foreign keys stay on.
CREATE TABLE list_views_new (
  id INTEGER PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('unread', 'all', 'starred', 'generated', 'feeds', 'uncategorized', 'category', 'category_generated', 'feed')),
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  sort TEXT NOT NULL DEFAULT 'newest' CHECK (sort IN ('newest', 'oldest', 'relevance')),
  CHECK (
    (list IN ('category', 'category_generated') AND category_id IS NOT NULL AND feed_id IS NULL)
    OR (list = 'feed' AND feed_id IS NOT NULL AND category_id IS NULL)
    OR (list NOT IN ('category', 'category_generated', 'feed') AND category_id IS NULL AND feed_id IS NULL)
  )
);
INSERT INTO list_views_new (id, list, category_id, feed_id, sort) SELECT id, list, category_id, feed_id, sort FROM list_views;
DROP TABLE list_views;
ALTER TABLE list_views_new RENAME TO list_views;
CREATE UNIQUE INDEX list_views_target ON list_views (list, IFNULL(category_id, 0), IFNULL(feed_id, 0));
