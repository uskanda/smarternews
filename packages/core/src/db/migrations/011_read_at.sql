-- Read times: when an article was last marked read, for the list of recently read articles. Only a read article
-- has one; putting an article back to unread clears it. Articles read before this have none and stay so, since
-- when they were read is not known.
ALTER TABLE articles ADD COLUMN read_at TEXT;

-- The list of recently read articles is ordered and paged by read time.
CREATE INDEX articles_read_at ON articles (read_at, id) WHERE read_at IS NOT NULL;
