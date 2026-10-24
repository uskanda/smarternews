-- Duplicate removal: a feed article that another feed delivered within the last seven days is recorded as a
-- duplicate of the article kept for it, and hidden from the lists over everything and over categories. What
-- is compared is stored with the article when it is stored, since SQL alone cannot normalize a title as the
-- server does. Feed articles stored before this have no values to compare and are never compared.

-- The normalized URL of the page, as in the article's first reference.
ALTER TABLE articles ADD COLUMN dedup_url TEXT;
-- The normalized title; null when too few characters remain to compare.
ALTER TABLE articles ADD COLUMN dedup_title TEXT;
-- The feed article kept for this one; null when this one is not a duplicate. Always an article that is not
-- itself a duplicate. No foreign key: the trigger below records the duplicates again when it goes.
ALTER TABLE articles ADD COLUMN duplicate_of INTEGER;

CREATE INDEX articles_dedup_url ON articles (dedup_url, created_at) WHERE dedup_url IS NOT NULL;
CREATE INDEX articles_dedup_title ON articles (dedup_title, created_at) WHERE dedup_title IS NOT NULL;
CREATE INDEX articles_duplicate_of ON articles (duplicate_of, created_at, id) WHERE duplicate_of IS NOT NULL;

-- On unless the user switches it off, also for a server that existed before.
ALTER TABLE settings ADD COLUMN remove_duplicates INTEGER NOT NULL DEFAULT 1;

-- When a kept article goes, by any route (its feed deleted, the retention period, a cascade), the duplicate
-- stored first is kept instead and the others become its duplicates.
CREATE TRIGGER articles_keep_next_duplicate AFTER DELETE ON articles
BEGIN
  UPDATE articles
     SET duplicate_of = (SELECT d.id FROM articles d WHERE d.duplicate_of = OLD.id ORDER BY d.created_at, d.id LIMIT 1)
   WHERE duplicate_of = OLD.id
     AND id <> (SELECT d.id FROM articles d WHERE d.duplicate_of = OLD.id ORDER BY d.created_at, d.id LIMIT 1);
  UPDATE articles SET duplicate_of = NULL WHERE duplicate_of = OLD.id;
END;
