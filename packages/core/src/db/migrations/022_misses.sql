-- Misses: the reader's mark on a generated article that should not have been made for its topics. A miss keeps
-- the title and the topics of its article as they were when it was marked, so that it outlives the article: when the
-- article is deleted, only `article_id` becomes NULL. A miss goes with its category, and a deleted topic leaves the
-- misses of its articles without it. No model is involved in keeping them.
CREATE TABLE misses (
  id INTEGER PRIMARY KEY,
  article_id INTEGER REFERENCES articles (id) ON DELETE SET NULL,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  marked_at TEXT NOT NULL
);
-- An article is marked once at most.
CREATE UNIQUE INDEX misses_article ON misses (article_id) WHERE article_id IS NOT NULL;
CREATE INDEX misses_category ON misses (category_id);

-- The topics of the article when it was marked, copied from `article_topics`.
CREATE TABLE miss_topics (
  miss_id INTEGER NOT NULL REFERENCES misses (id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  PRIMARY KEY (miss_id, topic_id)
);
CREATE INDEX miss_topics_topic ON miss_topics (topic_id);

-- When the interpret task last gave the topic its queries and criteria. NULL for a topic interpreted before the
-- time was kept, and for one never interpreted: every miss of such a topic counts as one after its interpretation.
ALTER TABLE topics ADD COLUMN interpreted_at TEXT;
