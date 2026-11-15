-- foreign_keys: off
-- Candidates gain the site they belong to, and categories a list of sites whose candidates are rejected before the
-- judge. SQLite cannot change a CHECK, so `candidates` is made again with the new reason code `blocked-site`
-- allowed and the column `site_host` added; it takes over its rows with their ids. `candidate_topics` refers to
-- the table by its name, so it refers to the new one once that is renamed.

CREATE TABLE candidates_new (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  fetchable INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  site_name TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('feed', 'news-search', 'llm-search')),
  status TEXT NOT NULL CHECK (status IN ('rejected', 'pending', 'accepted')),
  reason TEXT NOT NULL DEFAULT '',
  importance INTEGER,
  group_key TEXT,
  body TEXT,
  article_id INTEGER REFERENCES articles (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  -- Which of the program's reasons rejected the candidate; NULL for the judge's verdicts.
  reason_code TEXT
    CHECK (reason_code IN ('no-date', 'below-minimum', 'over-limit', 'event-outside-window', 'event-no-date', 'blocked-site')),
  -- The host of the URL, lowercased and without a leading "www.". For a Google News redirect that could not be
  -- resolved, the host of the outlet the search named. Empty when neither is known.
  site_host TEXT NOT NULL DEFAULT ''
);

-- The candidates kept so far never stored the outlet of an unresolved redirect, so theirs stays empty.
INSERT INTO candidates_new
  (id, category_id, run_id, url, fetchable, title, snippet, site_name, published_at, source_kind, status, reason,
   importance, group_key, body, article_id, created_at, reason_code, site_host)
SELECT id, category_id, run_id, url, fetchable, title, snippet, site_name, published_at, source_kind, status, reason,
       importance, group_key, body, article_id, created_at, reason_code, sn_candidate_host(url)
  FROM candidates;
DROP TABLE candidates;
ALTER TABLE candidates_new RENAME TO candidates;
CREATE INDEX candidates_run ON candidates (run_id, status);
CREATE INDEX candidates_category_status ON candidates (category_id, status);
CREATE INDEX candidates_category_created ON candidates (category_id, created_at);

-- The sites of a category whose candidates are rejected right after collecting, before any model sees them.
CREATE TABLE blocked_sites (
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (category_id, host)
);
