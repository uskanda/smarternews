-- List views gain the format of the list on the web: `standard` (three lines a row beside the article pane),
-- `compact` (the title alone on one line) or `expanded` (each article in full, one after another, without the
-- article pane). A new column with its own CHECK can be added in place, so the table is not made again; the
-- rows already there take `standard`, the format every entry has had.
ALTER TABLE list_views ADD COLUMN format TEXT NOT NULL DEFAULT 'standard' CHECK (format IN ('standard', 'compact', 'expanded'));
