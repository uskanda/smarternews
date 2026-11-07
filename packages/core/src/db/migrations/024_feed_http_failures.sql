-- What a failed fetch of a feed tells besides its reason. `retry_after_until` is the earliest time the next
-- fetch may start, as the Retry-After of a 429 or 503 answer gave it, one day ahead at most; the next fetch
-- waits for the later of it and the doubled interval. `gone_at` is when the first of the 410 answers in a row
-- came. A success, and for `gone_at` any other failure, empties them. Neither disables the feed.
ALTER TABLE feeds ADD COLUMN retry_after_until TEXT;
ALTER TABLE feeds ADD COLUMN gone_at TEXT;
