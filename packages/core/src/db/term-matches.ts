import { normalizeForMatch } from "../search/text.ts";
import { transaction, type Database } from "./database.ts";
import { num, str, strOrNull, type Row } from "./rows.ts";

// Whether a feed article has a highlight term, kept as `articles.term_match` for the relevance order. Matched as
// the apps colour the terms: case and width do not matter, each text on its own. Only feed articles are matched;
// the relevance of a generated article comes from its importance alone. No model is involved.

/** The terms as they are compared, each once. */
function storedTerms(db: Database): string[] {
  return [
    ...new Set(
      db
        .prepare("SELECT normalized FROM highlight_terms")
        .all()
        .map((row) => str(row.normalized))
        .filter((term) => term.length > 0),
    ),
  ];
}

function matches(row: Row, terms: string[]): number {
  if (terms.length === 0) return 0;
  for (const text of [str(row.title), strOrNull(row.translated_title), str(row.summary)]) {
    if (!text) continue;
    const normalized = normalizeForMatch(text);
    if (terms.some((term) => normalized.includes(term))) return 1;
  }
  return 0;
}

const COLUMNS = "id, title, translated_title, summary, term_match";

/** Writes the value of each row that differs from what is stored. Returns how many changed. */
function store(db: Database, rows: Row[], terms: string[]): number {
  const update = db.prepare("UPDATE articles SET term_match = ? WHERE id = ?");
  let changed = 0;
  transaction(db, () => {
    for (const row of rows) {
      const value = matches(row, terms);
      if (value === num(row.term_match)) continue;
      update.run(value, num(row.id));
      changed += 1;
    }
  });
  return changed;
}

/** Matches the named feed articles again: after they were stored, or their titles or summary changed. */
export function refreshTermMatches(db: Database, ids: readonly number[]): number {
  if (ids.length === 0) return 0;
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM articles WHERE origin = 'feed' AND id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(ids));
  return store(db, rows, storedTerms(db));
}

/** Matches every feed article again: after the terms changed, and once a day. Returns how many changed. */
export function refreshAllTermMatches(db: Database): number {
  return store(db, db.prepare(`SELECT ${COLUMNS} FROM articles WHERE origin = 'feed'`).all(), storedTerms(db));
}
