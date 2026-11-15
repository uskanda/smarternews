-- The icon of a subscribed feed: where it was found, and when it was last looked for. The picture itself is not
-- kept here; the image relay fetches it and keeps it on disk when a screen asks for it. A feed of before has
-- neither and is looked at on its next fetch.

ALTER TABLE feeds ADD COLUMN icon_url TEXT;
ALTER TABLE feeds ADD COLUMN icon_checked_at TEXT;
