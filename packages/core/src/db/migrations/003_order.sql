-- The order of categories and feeds in the lists, and the choice to move on after marking a list as read.
-- A feed's position counts within its category. Existing rows keep the order they were registered in.

ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE categories SET position = id;

ALTER TABLE feeds ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE feeds SET position = id;

ALTER TABLE settings ADD COLUMN advance_after_mark_all INTEGER NOT NULL DEFAULT 0;
