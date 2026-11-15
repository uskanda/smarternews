-- The feed categories: what a feed files an item under (RSS category and dc:subject, Atom category, JSON Feed
-- tags), not the categories of this product. JSON, a list of strings in the order the feed lists them. NULL
-- for an article without them: a generated article, and a feed article stored before this migration until its
-- feed delivers the item again.
ALTER TABLE articles ADD COLUMN feed_categories TEXT;
