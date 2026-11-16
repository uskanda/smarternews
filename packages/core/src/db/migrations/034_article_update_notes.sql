-- What every rewrite by a follow-up added: the model's note and the time of the rewrite, one row per rewrite that
-- had a note. `articles.update_note` stays the note of the last rewrite, for the lists. A reader is shown every
-- note written after the time they last read the article before a rewrite (`articles.read_before_update_at`).
CREATE TABLE article_update_notes (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX article_update_notes_article ON article_update_notes (article_id, created_at);

-- The note an article has is of its last rewrite, made when it was last updated.
INSERT INTO article_update_notes (article_id, note, created_at)
SELECT id, update_note, updated_at FROM articles WHERE update_note IS NOT NULL ORDER BY id;
