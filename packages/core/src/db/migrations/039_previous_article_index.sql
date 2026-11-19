-- The later articles of a story are found by the article they point back to: the chain shown after an article,
-- the unread follow-ups of a starred one in every list row, and the newest article of a starred story that the
-- grouping step is given. Without an index each of these reads the whole table.

CREATE INDEX articles_previous ON articles (previous_article_id) WHERE previous_article_id IS NOT NULL;
