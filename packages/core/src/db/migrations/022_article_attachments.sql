-- The files a feed attaches to an item: RSS enclosures, Media RSS contents and thumbnails. JSON, a list of
-- entries with `url`, `kind` (image, audio, video, other), `mimeType`, `size`, `title` and `thumbnail`. NULL for
-- an article without attachments: a generated article, and a feed article stored before this migration until
-- its feed delivers the item again.
ALTER TABLE articles ADD COLUMN attachments TEXT;
