-- Web feeds: a subscribed feed is either a feed (RSS, Atom, RDF) or a page without a feed, whose articles are
-- taken out with a set of CSS selectors. `page_selectors` holds that set as JSON (`item`, and optionally `title`,
-- `link`, `date`) and has a value only for a page. Feeds subscribed before this migration are feeds.
ALTER TABLE feeds ADD COLUMN format TEXT NOT NULL DEFAULT 'feed' CHECK (format IN ('feed', 'page'));
ALTER TABLE feeds ADD COLUMN page_selectors TEXT;
