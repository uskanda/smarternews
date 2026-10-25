-- List views: how each entry of the left pane and the drawer shows its articles, kept on the server so that the
-- web app and the Android app share it. One row per entry, one column per setting with its default; an entry
-- without a row has every default, and a row whose settings are all back to their defaults is deleted. Deleting
-- a category or a feed deletes its rows: a category takes the row of its generated-only entry with it, and a
-- feed that moves out of a deleted category keeps its own.

CREATE TABLE list_views (
  id INTEGER PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('unread', 'all', 'starred', 'generated', 'uncategorized', 'category', 'category_generated', 'feed')),
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  sort TEXT NOT NULL DEFAULT 'newest' CHECK (sort IN ('newest', 'oldest')),
  CHECK (
    (list IN ('category', 'category_generated') AND category_id IS NOT NULL AND feed_id IS NULL)
    OR (list = 'feed' AND feed_id IS NOT NULL AND category_id IS NULL)
    OR (list NOT IN ('category', 'category_generated', 'feed') AND category_id IS NULL AND feed_id IS NULL)
  )
);
CREATE UNIQUE INDEX list_views_target ON list_views (list, IFNULL(category_id, 0), IFNULL(feed_id, 0));
