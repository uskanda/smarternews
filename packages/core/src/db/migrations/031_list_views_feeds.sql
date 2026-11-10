-- List views gain the fixed entry "feeds": the feed articles of every subscribed feed, beside "generated".
-- SQLite cannot change a CHECK, so the table is made again with the entry allowed and takes over its rows with
-- their ids, which keep the order the entries were first changed in. No table refers to list_views, so the
-- foreign keys stay on.

CREATE TABLE list_views_new (
  id INTEGER PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('unread', 'all', 'starred', 'generated', 'feeds', 'uncategorized', 'category', 'category_generated', 'feed')),
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  sort TEXT NOT NULL DEFAULT 'newest' CHECK (sort IN ('newest', 'oldest')),
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
