-- Mentions: the names of people, organizations, products and places that the write task and the summarize task
-- found in an article, at most ten an article, in the order of the output. `name` is shown; `name_key` is the
-- name as `mentionKey` normalizes it, for telling names apart and for the list of a name's articles. The names go
-- with their article. Articles stored before this migration have none.
CREATE TABLE article_mentions (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'organization', 'product', 'place')),
  PRIMARY KEY (article_id, position),
  UNIQUE (article_id, name_key)
);

-- The articles of a name.
CREATE INDEX article_mentions_name ON article_mentions (name_key, article_id);
