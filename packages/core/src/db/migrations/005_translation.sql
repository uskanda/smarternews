-- Translations of feed articles. A feed opts in. The title is translated when the article is stored, the
-- content when the article is first opened; the original title and content stay as they are.

ALTER TABLE feeds ADD COLUMN translate INTEGER NOT NULL DEFAULT 0;

-- The title in the output language, for the lists. NULL while there is none.
ALTER TABLE articles ADD COLUMN translated_title TEXT;
-- The language the translation API found the original in. NULL when a model translated, or nothing did.
ALTER TABLE articles ADD COLUMN source_language TEXT;

-- The content, segment by segment: a JSON list of { original, translated }, both Markdown. `translated`
-- is null for a segment that is shown as it is: code, images, and what lies past the length that is translated.
CREATE TABLE article_translations (
  article_id INTEGER PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
  segments   TEXT NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('google', 'llm')),
  -- Set when the end of the content was left untranslated because of its length.
  truncated  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Characters sent to the translation API, one row per month (YYYY-MM in the configured time zone).
CREATE TABLE translation_usage (
  month TEXT PRIMARY KEY,
  chars INTEGER NOT NULL DEFAULT 0
);
