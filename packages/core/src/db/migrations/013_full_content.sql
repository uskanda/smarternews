-- Full content of feed articles: the text of the article's page, taken out with Readability and rewritten as
-- Markdown by the same rules as what the feed delivered. It is kept apart from the delivered content, which
-- filters, the detection of rewritten items and the excerpt in lists go on using. A feed opts in to fetching
-- it on its own; only articles stored after it did are fetched, so the time of opting in is kept.

ALTER TABLE feeds ADD COLUMN fetch_full_content INTEGER NOT NULL DEFAULT 0;
-- When the feed opted in. NULL while it is off.
ALTER TABLE feeds ADD COLUMN fetch_full_content_since TEXT;

-- Markdown, and its words alone on one line.
ALTER TABLE articles ADD COLUMN full_content TEXT;
ALTER TABLE articles ADD COLUMN full_content_text TEXT;
ALTER TABLE articles ADD COLUMN full_content_at TEXT;
-- NULL until the page is fetched for it; then stored, or failed with a reason. A failed article is not
-- fetched again unless a reader asks.
ALTER TABLE articles ADD COLUMN full_content_status TEXT CHECK (full_content_status IN ('fetched', 'failed'));
ALTER TABLE articles ADD COLUMN full_content_error TEXT
  CHECK (full_content_error IN ('no-url', 'robots', 'blocked', 'http', 'not-html', 'timeout', 'error', 'no-content', 'shorter'));
-- The HTTP status or another detail of the failure.
ALTER TABLE articles ADD COLUMN full_content_error_detail TEXT;
