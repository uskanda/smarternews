-- A feed whose site moved for good. `move_target` is where the permanent redirects of the last successful fetches
-- led, and `move_count` how many of those fetches in a row led there; at the third the URL of the feed becomes the
-- target. `moved_from` and `moved_at` are the URL it had before and when it was replaced, kept until the URL
-- changes again. A change of the URL by the user empties all four.
ALTER TABLE feeds ADD COLUMN move_target TEXT;
ALTER TABLE feeds ADD COLUMN move_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feeds ADD COLUMN moved_from TEXT;
ALTER TABLE feeds ADD COLUMN moved_at TEXT;
