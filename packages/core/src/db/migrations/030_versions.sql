-- Versions: the values of a topic or a category each time one that is kept changed, so that the effect of a change
-- can be compared and a topic can go back to what it was. A version is added only when a kept value differs from
-- the version before it; nothing is ever changed in a version but whether it was interpreted.

-- A topic's text, search words, relevance test, sources and search locale. Whether it is enabled is not kept.
CREATE TABLE topic_versions (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('created', 'edited', 'interpreted', 'settings-file', 'restored')),
  -- The version the topic went back to, when the trigger is 'restored'. Goes only with the topic.
  restored_from INTEGER,
  text TEXT NOT NULL,
  -- Whether the search words and the relevance test came from an interpretation of this text. Not compared.
  interpreted INTEGER NOT NULL,
  queries TEXT NOT NULL,
  criteria TEXT NOT NULL,
  feeds TEXT NOT NULL,
  news_search INTEGER NOT NULL,
  llm_search INTEGER NOT NULL,
  search_language TEXT,
  search_region TEXT
);
CREATE INDEX topic_versions_topic ON topic_versions (topic_id, created_at);

-- A category's minimum importance and its limit of articles per run.
CREATE TABLE category_versions (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('created', 'edited', 'settings-file')),
  min_importance INTEGER NOT NULL,
  max_articles_per_run INTEGER NOT NULL
);
CREATE INDEX category_versions_category ON category_versions (category_id, created_at);

-- What exists already starts with one version of its current values, made when it was.
INSERT INTO topic_versions
  (topic_id, created_at, trigger, text, interpreted, queries, criteria, feeds, news_search, llm_search, search_language, search_region)
SELECT id, created_at, 'created', text, interpreted, queries, criteria, feeds, news_search, llm_search, search_language, search_region
  FROM topics ORDER BY id;

INSERT INTO category_versions (category_id, created_at, trigger, min_importance, max_articles_per_run)
SELECT id, created_at, 'created', min_importance, max_articles_per_run FROM categories ORDER BY id;
