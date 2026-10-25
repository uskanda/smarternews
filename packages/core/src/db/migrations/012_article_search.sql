-- Article search: one FTS5 table with the trigram tokenizer, whose row id is the article's. It holds the
-- fields that search matches, one to a line and normalized, as `sn_search_text` makes them: title, translated
-- title, summary, automatic summary, body (a feed article's content text, or a generated article's body
-- without Markdown), impact and event venue. Source URLs and link targets are not in it.
--
-- Triggers keep it with the articles, whatever writes them. `sn_search_text` is registered by the server when
-- it opens the database; a connection without it cannot write articles.
CREATE VIRTUAL TABLE article_search USING fts5(text, tokenize = 'trigram');

CREATE TRIGGER articles_search_insert AFTER INSERT ON articles
BEGIN
  INSERT INTO article_search (rowid, text)
  VALUES (NEW.id, sn_search_text(NEW.origin, NEW.title, NEW.translated_title, NEW.summary, NEW.auto_summary, NEW.body,
                                 NEW.content_text, NEW.impact, NEW.event_venue));
END;

CREATE TRIGGER articles_search_update
AFTER UPDATE OF origin, title, translated_title, summary, auto_summary, body, content_text, impact, event_venue ON articles
BEGIN
  UPDATE article_search
     SET text = sn_search_text(NEW.origin, NEW.title, NEW.translated_title, NEW.summary, NEW.auto_summary, NEW.body,
                               NEW.content_text, NEW.impact, NEW.event_venue)
   WHERE rowid = NEW.id;
END;

-- Also for a row removed by a cascade: the feed deleted, or the category.
CREATE TRIGGER articles_search_delete AFTER DELETE ON articles
BEGIN
  DELETE FROM article_search WHERE rowid = OLD.id;
END;

INSERT INTO article_search (rowid, text)
SELECT id, sn_search_text(origin, title, translated_title, summary, auto_summary, body, content_text, impact, event_venue)
  FROM articles;
