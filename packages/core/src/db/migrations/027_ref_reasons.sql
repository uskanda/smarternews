-- Why each source of a generated article was chosen: the reason and importance of the judgement, copied from
-- the candidate when the article is written. Candidates go after 30 days; the article keeps its reasons as long
-- as it stays. NULL for the sources of feed articles, and for sources whose candidate was gone before this.
ALTER TABLE article_refs ADD COLUMN reason TEXT;
ALTER TABLE article_refs ADD COLUMN importance INTEGER;

-- Fill the sources of the articles written so far from the accepted candidates that are still kept. When one URL
-- was accepted more than once into an article, the first judgement is kept, as writing the article keeps the
-- first row of a URL.
UPDATE article_refs
   SET (reason, importance) = (
     SELECT nullif(c.reason, ''), c.importance
       FROM candidates c
      WHERE c.article_id = article_refs.article_id AND c.url = article_refs.url AND c.status = 'accepted'
      ORDER BY c.id
      LIMIT 1
   );
