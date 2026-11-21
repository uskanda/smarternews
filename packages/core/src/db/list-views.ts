import {
  listViewKey,
  parseListViewKey,
  type ListFormat,
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
const DEFAULTS = { sort: "newest", format: "standard" } as const satisfies Settings;

/** The settings one entry keeps. */
interface Settings {
  sort: ListSort;
  format: ListFormat;
}

/** An entry with the settings that differ from the defaults, as the settings file names them. */
export interface ListViewEntry extends Settings {
  target: ListViewTarget;
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
    .prepare("SELECT list, category_id, feed_id, sort, format FROM list_views ORDER BY id")
    .all()
    .map((row) => ({ target: targetOf(row), ...settingsOf(row) }));
}

export function listListViews(db: Database): ListViews {
  return { items: listViewEntries(db).map(({ target, sort, format }) => ({ key: listViewKey(target), sort, format })) };
}

function settingsOf(row: Row): Settings {
  return { sort: str(row.sort) as ListSort, format: str(row.format) as ListFormat };
}

function storedSettings(db: Database, target: ListViewTarget): Settings {
  const row = db.prepare(`SELECT sort, format FROM list_views WHERE ${MATCH}`).get(...columnsOf(target));
  return row ? settingsOf(row) : { ...DEFAULTS };
}

function invalidKey(key: string, message: string): DomainError {
  return new DomainError("invalid", `the entry ${key} has no list view`, [{ path: "key", message }]);
}

function parseKey(key: string): ListViewTarget {
  const target = parseListViewKey(key);
  if (target === null) throw invalidKey(key, key === "recently-read" ? "the recently read articles keep no list view" : "not an entry of the list");
  return target;
}

/** The view of the entry a key names. An entry without a row is newest first, in the standard format. */
export function getListView(db: Database, key: string): ListView {
  return { key, ...storedSettings(db, parseKey(key)) };
}

/** Whether the entry can be in the given order: the order by star time is for the starred articles alone. */
export function sortAllowed(target: ListViewTarget, sort: ListSort): boolean {
  return sort !== "starred" || target.list === "starred";
}

/**
 * Refuses an entry that cannot keep a view: a category or a feed that does not exist is not found, and an
 * event category, whose list is ordered by start, is invalid. So is the order by star time for an entry
 * other than the starred articles.
 */
export function checkListViewTarget(db: Database, target: ListViewTarget, patch: ListViewUpdate = {}): void {
  const key = listViewKey(target);
  if (patch.sort !== undefined && !sortAllowed(target, patch.sort)) {
    throw new DomainError("invalid", `the entry ${key} cannot be in the order ${patch.sort}`, [
      { path: "sort", message: "only the starred articles can be in the order by star time" },
    ]);
  }
  if (target.list === "category" || target.list === "category_generated") {
    const row = db.prepare("SELECT kind FROM categories WHERE id = ?").get(target.categoryId);
    if (!row) throw notFound("category", target.categoryId);
    if (str(row.kind) === "event") throw invalidKey(key, "an event category lists its events by start and keeps no list view");
  }
  if (target.list === "feed" && !db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(target.feedId)) throw notFound("feed", target.feedId);
}

/**
 * Stores the view of an entry already checked. What the change leaves out keeps its stored value; the row is
 * deleted once every setting is back to its default.
 */
export function setListView(db: Database, target: ListViewTarget, patch: ListViewUpdate): Settings {
  const stored = storedSettings(db, target);
  const { sort, format } = { sort: patch.sort ?? stored.sort, format: patch.format ?? stored.format };
  const columns = columnsOf(target);
  if (sort === DEFAULTS.sort && format === DEFAULTS.format) {
    db.prepare(`DELETE FROM list_views WHERE ${MATCH}`).run(...columns);
  } else if (num(db.prepare(`UPDATE list_views SET sort = ?, format = ? WHERE ${MATCH}`).run(sort, format, ...columns).changes) === 0) {
    db.prepare("INSERT INTO list_views (list, category_id, feed_id, sort, format) VALUES (?, ?, ?, ?, ?)").run(...columns, sort, format);
  }
  return { sort, format };
}

/** Changes the view of the entry a key names. What the change leaves out stays as it is. */
export function updateListView(db: Database, key: string, patch: ListViewUpdate): ListView {
  const target = parseKey(key);
  checkListViewTarget(db, target, patch);
  return { key: listViewKey(target), ...setListView(db, target, patch) };
}
