import type { SavedSearch, SavedSearchCreate, SavedSearchUpdate } from "../api.ts";
import type { Clock } from "../clock.ts";
import { DomainError, notFound } from "../errors.ts";
import { parseSearchTerms } from "../search/text.ts";
import { transaction, type Database } from "./database.ts";
import { num, numOrNull, str, type Row } from "./rows.ts";

// Saved searches: the words of a search with at most one narrowing, under a name and in an order. How many
// unread articles each finds is counted with the other counts (`getCounts`), against the search index.

function toSavedSearch(row: Row): SavedSearch {
  return { id: num(row.id), name: str(row.name), query: str(row.query), categoryId: numOrNull(row.category_id), feedId: numOrNull(row.feed_id) };
}

/** Every saved search in its order. */
export function listSavedSearches(db: Database): SavedSearch[] {
  return db.prepare("SELECT id, name, query, category_id, feed_id FROM saved_searches ORDER BY position, id").all().map(toSavedSearch);
}

export function getSavedSearch(db: Database, id: number): SavedSearch {
  const row = db.prepare("SELECT id, name, query, category_id, feed_id FROM saved_searches WHERE id = ?").get(id);
  if (!row) throw notFound("saved search", id);
  return toSavedSearch(row);
}

/** Refuses words a search would refuse, said of `query`. */
function checkQuery(query: string): void {
  try {
    parseSearchTerms(query);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    throw new DomainError(
      error.code,
      error.message,
      error.fields.map((field) => ({ ...field, path: "query" })),
    );
  }
}

/**
 * Saves a search at the end of the order, its words trimmed. The category or the feed it is narrowed to has
 * to exist. The same conditions may be saved more than once.
 */
export function createSavedSearch(db: Database, input: SavedSearchCreate, clock: Clock): SavedSearch {
  checkQuery(input.query);
  if (input.categoryId !== undefined && input.feedId !== undefined) {
    throw new DomainError("invalid", "narrow to a category or to a feed, not both", [{ path: "feedId", message: "not allowed with categoryId", code: "not_allowed" }]);
  }
  if (input.categoryId !== undefined && !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(input.categoryId)) {
    throw new DomainError("invalid", `category ${input.categoryId} does not exist`, [{ path: "categoryId", message: "no such category", code: "no_such_item" }]);
  }
  if (input.feedId !== undefined && !db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(input.feedId)) {
    throw new DomainError("invalid", `feed ${input.feedId} does not exist`, [{ path: "feedId", message: "no such feed", code: "no_such_item" }]);
  }
  const id = num(
    db
      .prepare(
        `INSERT INTO saved_searches (name, query, category_id, feed_id, position, created_at)
         VALUES (?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM saved_searches), ?)`,
      )
      .run(input.name.trim(), input.query.trim(), input.categoryId ?? null, input.feedId ?? null, clock().toISOString()).lastInsertRowid,
  );
  return getSavedSearch(db, id);
}

/** Changes the name of a saved search. Its words, narrowing and place stay. */
export function updateSavedSearch(db: Database, id: number, patch: SavedSearchUpdate): SavedSearch {
  getSavedSearch(db, id);
  db.prepare("UPDATE saved_searches SET name = ? WHERE id = ?").run(patch.name.trim(), id);
  return getSavedSearch(db, id);
}

export function deleteSavedSearch(db: Database, id: number): void {
  getSavedSearch(db, id);
  db.prepare("DELETE FROM saved_searches WHERE id = ?").run(id);
}

/** Stores the order of all saved searches: the given ones first, in that order, then the rest as they were. */
export function orderSavedSearches(db: Database, ids: number[]): void {
  const first = new Set(ids);
  const all = [...ids, ...listSavedSearches(db).map((saved) => saved.id).filter((id) => !first.has(id))];
  const set = db.prepare("UPDATE saved_searches SET position = ? WHERE id = ?");
  transaction(db, () => all.forEach((id, index) => set.run(index + 1, id)));
}

/** Puts one saved search before another, or last when `before` is null. The others keep their order. */
export function moveSavedSearch(db: Database, id: number, before: number | null): SavedSearch[] {
  getSavedSearch(db, id);
  if (before !== null && !db.prepare("SELECT 1 FROM saved_searches WHERE id = ?").get(before)) {
    throw new DomainError("invalid", `saved search ${before} does not exist`, [{ path: "before", message: "no such saved search", code: "no_such_item" }]);
  }
  if (before !== id) {
    const others = listSavedSearches(db)
      .map((saved) => saved.id)
      .filter((other) => other !== id);
    const at = before === null ? others.length : others.indexOf(before);
    orderSavedSearches(db, [...others.slice(0, at), id, ...others.slice(at)]);
  }
  return listSavedSearches(db);
}
