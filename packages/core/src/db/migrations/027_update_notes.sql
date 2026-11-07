-- What a follow-up added. `update_note` is the model's one or two sentences on the last rewrite, NULL when it gave
-- none and for an article never rewritten. `read_before_update_at` is when the reader last read the article before
-- it was rewritten: a rewrite copies `read_at` here before clearing it, and keeps the earlier value when the
-- article was still unread. A source added after that time is new to the reader.
ALTER TABLE articles ADD COLUMN update_note TEXT;
ALTER TABLE articles ADD COLUMN read_before_update_at TEXT;

-- When the source was added to its article. NULL for the sources stored before the time was kept: they are not new.
ALTER TABLE article_refs ADD COLUMN added_at TEXT;
