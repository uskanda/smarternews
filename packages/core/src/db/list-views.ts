import {
  listViewKey,
  parseListViewKey,
  type ListSort,
  type ListView,
  type ListViews,
  type ListViewTarget,
  type ListViewUpdate,
} from "../api.ts";
import { DomainError, notFound } from "../errors.ts";
import type { Database } from "./database.ts";
import { num, str, type Row } from "./rows.ts";

// How each entry of the left pane and the drawer shows its articles, shared by the web app and the Android app.
// An entry without a row has every default; a row whose settings are all back to their defaults is deleted, so
// that only what was changed is answered and written to the settings file. Deleting a category or a feed
// deletes its rows (ON DELETE CASCADE).

/** The settings of an entry without a row. */
const DEFAULTS = { sort: "newest" } as const satisfies { sort: ListSort };

/** An entry with the settings that differ from the defaults, as the settings file names them. */
export interface ListViewEntry {
  target: ListViewTarget;
  sort: ListSort;
}

function targetOf(row: Row): ListViewTarget {
  const list = str(row.list) as ListViewTarget["list"];
  if (list === "category" || list === "category_generated") return { list, categoryId: num(row.category_id) };
  if (list === "feed") return { list, feedId: num(row.feed_id) };
  return { list };
}

function columnsOf(target: ListViewTarget): [string, number | null, number | null] {
  if (target.list === "category" || target.list === "category_generated") return [target.list, target.categoryId, null];
  if (target.list === "feed") return [target.list, null, target.feedId];
  return [target.list, null, null];
}

const MATCH = "list = ? AND IFNULL(category_id, 0) = IFNULL(?, 0) AND IFNULL(feed_id, 0) = IFNULL(?, 0)";

/** The entries whose view differs from the defaults, in the order they were first changed. */
export function listViewEntries(db: Database): ListViewEntry[] {
  return db
    .prepare("SELECT list, category_id, feed_id, sort FROM list_views ORDER BY id")
    .all()
    .map((row) => ({ target: targetOf(row), sort: str(row.sort) as ListSort }));
}

export function listListViews(db: Database): ListViews {
  return { items: listViewEntries(db).map((entry) => ({ key: listViewKey(entry.target), sort: entry.sort })) };
}

function sortOf(db: Database, target: ListViewTarget): ListSort {
  const row = db.prepare(`SELECT sort FROM list_views WHERE ${MATCH}`).get(...columnsOf(target));
  return row ? (str(row.sort) as ListSort) : DEFAULTS.sort;
}

function invalidKey(key: string, message: string): DomainError {
  return new DomainError("invalid", `the entry ${key} has no list view`, [{ path: "key", message }]);
}

function parseKey(key: string): ListViewTarget {
  const target = parseListViewKey(key);
  if (target === null) throw invalidKey(key, key === "recently-read" ? "the recently read articles keep no list view" : "not an entry of the list");
  return target;
}

/** The view of the entry a key names. An entry without a row is newest first. */
export function getListView(db: Database, key: string): ListView {
  return { key, sort: sortOf(db, parseKey(key)) };
}

/**
 * Refuses an entry that cannot keep a view: a category or a feed that does not exist is not found, and an
 * event category, whose list is ordered by start, is invalid.
 */
export function checkListViewTarget(db: Database, target: ListViewTarget): void {
  const key = listViewKey(target);
  if (target.list === "category" || target.list === "category_generated") {
    const row = db.prepare("SELECT kind FROM categories WHERE id = ?").get(target.categoryId);
    if (!row) throw notFound("category", target.categoryId);
    if (str(row.kind) === "event") throw invalidKey(key, "an event category lists its events by start and keeps no list view");
  }
  if (target.list === "feed" && !db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(target.feedId)) throw notFound("feed", target.feedId);
}

/** Stores the view of an entry already checked, deleting its row when every setting is back to its default. */
export function setListView(db: Database, target: ListViewTarget, patch: ListViewUpdate): ListSort {
  const sort = patch.sort ?? sortOf(db, target);
  const columns = columnsOf(target);
  if (sort === DEFAULTS.sort) {
    db.prepare(`DELETE FROM list_views WHERE ${MATCH}`).run(...columns);
  } else if (num(db.prepare(`UPDATE list_views SET sort = ? WHERE ${MATCH}`).run(sort, ...columns).changes) === 0) {
    db.prepare("INSERT INTO list_views (list, category_id, feed_id, sort) VALUES (?, ?, ?, ?)").run(...columns, sort);
  }
  return sort;
}

/** Changes the view of the entry a key names. What the change leaves out stays as it is. */
export function updateListView(db: Database, key: string, patch: ListViewUpdate): ListView {
  const target = parseKey(key);
  checkListViewTarget(db, target);
  return { key: listViewKey(target), sort: setListView(db, target, patch) };
}
