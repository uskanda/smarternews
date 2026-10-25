-- Term highlights: terms a reader wants to spot, coloured wherever they occur in lists and article texts.
-- Terms belong to a group, which has a name and one of four colours and is kept in an order: where terms of
-- two groups match one place, the upper group colours it. Only the terms are stored here; the apps match them
-- against what they show, so articles are never written for them.

CREATE TABLE term_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL CHECK (color IN ('green', 'purple', 'pink', 'orange')),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE highlight_terms (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES term_groups (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  -- The term as it is compared: NFKC and lower case, as stop words and filters compare.
  normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (group_id, normalized)
);
