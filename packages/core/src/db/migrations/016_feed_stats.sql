-- Feed stats: when a feed last listed an item it had never listed before, when an article was first opened, and
-- after how many days without a new item an enabled feed counts as stale.

-- The time of the fetch that found an item the feed had never listed. Null until one is found; a feed without one
-- is judged from when it was subscribed. A feed that exists gets the time its newest article was stored.
ALTER TABLE feeds ADD COLUMN last_new_item_at TEXT;
UPDATE feeds
   SET last_new_item_at = (SELECT max(a.created_at) FROM articles a WHERE a.origin = 'feed' AND a.feed_id = feeds.id);

-- When a reader first opened the article: its body was shown. Marking read, in bulk or by scrolling, does not set it,
-- and putting the article back to unread keeps it. Articles stored before this have none: a read time says
-- nothing about whether the article was opened.
ALTER TABLE articles ADD COLUMN opened_at TEXT;

-- The stats of a feed count its articles stored within the last 30 days.
CREATE INDEX articles_feed_created ON articles (feed_id, created_at) WHERE feed_id IS NOT NULL;

ALTER TABLE settings ADD COLUMN stale_feed_days INTEGER NOT NULL DEFAULT 60;
