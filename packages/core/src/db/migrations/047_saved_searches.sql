-- Saved searches: the words of a search with at most one narrowing, a category or a feed, under a name and in
-- an order. The web app lists them in the left pane with how many unread articles they find, counted against
-- the search index; no model is involved. A search narrowed to a category or a feed goes with it: without its
-- narrowing it would no longer be what its name says.

CREATE TABLE saved_searches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  feed_id INTEGER REFERENCES feeds (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (category_id IS NULL OR feed_id IS NULL)
);
