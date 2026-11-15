-- Star times: when an article was starred, for the list of starred articles in the order they were starred. Only
-- a starred article has one; taking the star away clears it, and starring an article already starred keeps it.
-- When the stars that exist were given is not known, so they take the time of the article's last update: they
-- keep the order the list of starred articles has had, and every star given from now on comes above them.
ALTER TABLE articles ADD COLUMN starred_at TEXT;
UPDATE articles SET starred_at = updated_at WHERE starred = 1;

-- The list of starred articles is ordered and paged by star time.
CREATE INDEX articles_starred_at ON articles (starred_at DESC, id DESC) WHERE starred = 1;

-- List views gain the order by star time, which only the entry of starred articles can keep. SQLite cannot
-- change a CHECK, so the table is made again, as in 031, and takes over its rows with their ids.
CREATE TABLE list_views_new (
  id INTEGER PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('unread', 'all', 'starred', 'generated', 'feeds', 'uncategorized', 'category', 'category_generated', 'feed')),
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  sort TEXT NOT NULL DEFAULT 'newest' CHECK (sort IN ('newest', 'oldest', 'starred')),
  CHECK (sort <> 'starred' OR list = 'starred'),
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
