-- A feed may name the element of its articles' pages that holds the article body. Full content and the
-- summaries that read a page take that element instead of what Readability finds; a page where it matches
-- nothing is read by Readability. NULL is none, as every feed had before.
ALTER TABLE feeds ADD COLUMN content_selector TEXT;
