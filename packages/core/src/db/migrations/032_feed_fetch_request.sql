-- A request to fetch every feed now: the time it was made, kept on each feed it asked for until that feed is
-- fetched. While it is there, the feed's next fetch is at that time, whatever its interval and its failures say.
-- Kept in the database, so that what was not fetched before a restart is fetched after it.
ALTER TABLE feeds ADD COLUMN fetch_requested_at TEXT;
