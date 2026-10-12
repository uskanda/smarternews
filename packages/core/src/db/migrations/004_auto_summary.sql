-- Summaries of feed articles, written by a model after the article is stored. A feed opts in; only articles
-- stored after it did are summarised, so the time of opting in and the time an article was stored are kept.

ALTER TABLE feeds ADD COLUMN auto_summarize INTEGER NOT NULL DEFAULT 0;
-- When the feed opted in. NULL while it is off.
ALTER TABLE feeds ADD COLUMN auto_summarize_since TEXT;

-- When the row was stored. `updated_at` is the time a feed article sorts by, which the feed may set to the past.
ALTER TABLE articles ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE articles SET created_at = updated_at;

ALTER TABLE articles ADD COLUMN auto_summary TEXT;
-- What the summary was written from: the page of the article, or only what the feed delivered.
ALTER TABLE articles ADD COLUMN auto_summary_source TEXT CHECK (auto_summary_source IN ('page', 'feed'));
ALTER TABLE articles ADD COLUMN auto_summary_at TEXT;
-- Calls that failed. At two the article is no longer tried.
ALTER TABLE articles ADD COLUMN auto_summary_attempts INTEGER NOT NULL DEFAULT 0;
-- Set when there was too little text to summarise.
ALTER TABLE articles ADD COLUMN auto_summary_skipped INTEGER NOT NULL DEFAULT 0;
