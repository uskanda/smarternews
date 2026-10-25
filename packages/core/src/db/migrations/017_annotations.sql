-- Annotations: a reader's highlights on the body of an article, each with a note or none, and one note on the
-- whole article. A highlight is kept as its text, the text right before and after it, and where it starts, so
-- that a screen finds it again after the body changes. The annotations go with their article.
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
  quote TEXT,
  prefix TEXT,
  suffix TEXT,
  position INTEGER,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'highlight' AND quote IS NOT NULL AND prefix IS NOT NULL AND suffix IS NOT NULL AND position IS NOT NULL
      AND position >= 0)
    OR (kind = 'note' AND quote IS NULL AND prefix IS NULL AND suffix IS NULL AND position IS NULL AND note IS NOT NULL)
  )
);

-- One note on the whole article at most.
CREATE UNIQUE INDEX annotations_article_note ON annotations (article_id) WHERE kind = 'note';
-- The annotations of an article, for its detail, the retention, the filters and the search index.
CREATE INDEX annotations_article ON annotations (article_id);
-- The list over every article, newest first.
CREATE INDEX annotations_created ON annotations (created_at DESC, id DESC);

-- The text the search index holds for an article: its fields as `sn_search_text` makes them, then the text and
-- note of each annotation, as `sn_annotation_text` makes them. Without annotations it is the text of the fields.
-- `sn_annotation_text` is registered by the server when it opens the database, as `sn_search_text` is.
CREATE VIEW article_search_source (id, text) AS
SELECT a.id,
       sn_search_text(a.origin, a.title, a.translated_title, a.summary, a.auto_summary, a.body, a.content_text, a.impact,
                      a.event_venue)
       || coalesce((SELECT char(10) || group_concat(sn_annotation_text(n.quote, n.note), char(10))
                      FROM annotations n WHERE n.article_id = a.id), '')
  FROM articles a;

-- A follow-up or a rewrite keeps the annotations in the index: the row is made again from the view.
DROP TRIGGER articles_search_update;
CREATE TRIGGER articles_search_update
AFTER UPDATE OF origin, title, translated_title, summary, auto_summary, body, content_text, impact, event_venue ON articles
BEGIN
  UPDATE article_search SET text = (SELECT s.text FROM article_search_source s WHERE s.id = NEW.id) WHERE rowid = NEW.id;
END;

CREATE TRIGGER annotations_search_insert AFTER INSERT ON annotations
BEGIN
  UPDATE article_search SET text = (SELECT s.text FROM article_search_source s WHERE s.id = NEW.article_id)
   WHERE rowid = NEW.article_id;
END;

CREATE TRIGGER annotations_search_update AFTER UPDATE OF quote, note ON annotations
BEGIN
  UPDATE article_search SET text = (SELECT s.text FROM article_search_source s WHERE s.id = NEW.article_id)
   WHERE rowid = NEW.article_id;
END;

-- When the article itself is deleted, its annotations go with it and its row of the index is deleted anyway.
CREATE TRIGGER annotations_search_delete AFTER DELETE ON annotations
WHEN EXISTS (SELECT 1 FROM articles WHERE id = OLD.article_id)
BEGIN
  UPDATE article_search SET text = (SELECT s.text FROM article_search_source s WHERE s.id = OLD.article_id)
   WHERE rowid = OLD.article_id;
END;
