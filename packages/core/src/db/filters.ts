import type {
  ArticlePage,
  Filter,
  FilterAction,
  FilterArticlesQuery,
  FilterCondition,
  FilterCreate,
  FilterDeleteResult,
  FilterPreview,
  FilterPreviewResult,
  FilterScope,
  FilterUpdate,
  FilterUpdateResult,
} from "../api.ts";
import type { Clock } from "../clock.ts";
import { DomainError, notFound, type FieldError } from "../errors.ts";
import { compileConditions, conditionProblems, matchesAll, normalizedValue, type CompiledCondition } from "../filters/match.ts";
import { keptByReader, pageArticles } from "./articles.ts";
import { transaction, type Database } from "./database.ts";
import { json, num, str, strOrNull, type Row } from "./rows.ts";

// A filter hides feed articles. Which filter's conditions an article meets is kept in `filter_matches`, for
// every feed article and every filter, whatever its scope and whether it is enabled. Whether an article is
// hidden is kept on the article (`filtered`) and worked out from those pairs, the scopes and the switches;
// so moving a feed, deleting a category or switching a filter needs no new matching. Generated articles are
// never matched and never hidden.

/** Whether the scope of filter `f` takes in the feed article `a`, judged by where the article belongs now. */
function inScope(f: string, a: string): string {
  return `(${a}.origin = 'feed' AND (${f}.scope = 'all'
    OR (${f}.scope = 'category' AND ${a}.category_id = ${f}.category_id)
    OR (${f}.scope = 'feed' AND ${a}.feed_id = ${f}.feed_id)))`;
}

/** Whether the feed article `a` meets an enabled keep filter with the same scope as filter `f`. */
function keptBySameScope(f: string, a: string): string {
  return `EXISTS (SELECT 1 FROM filter_matches km JOIN filters k ON k.id = km.filter_id
    WHERE km.article_id = ${a}.id AND k.enabled = 1 AND k.action = 'keep' AND k.scope = ${f}.scope
      AND k.category_id IS ${f}.category_id AND k.feed_id IS ${f}.feed_id)`;
}

/** Whether keep filters of one kind of scope apply to the feed article `a`, and it meets none of them. */
function notKept(scope: "category" | "feed", a: string): string {
  const target = scope === "category" ? `k.category_id = ${a}.category_id` : `k.feed_id = ${a}.feed_id`;
  return `(EXISTS (SELECT 1 FROM filters k WHERE k.enabled = 1 AND k.action = 'keep' AND k.scope = '${scope}' AND ${target})
    AND NOT EXISTS (SELECT 1 FROM filter_matches km JOIN filters k ON k.id = km.filter_id
      WHERE km.article_id = ${a}.id AND k.enabled = 1 AND k.action = 'keep' AND k.scope = '${scope}' AND ${target}))`;
}

/**
 * Whether the enabled filters hide the feed article `a`, star aside: a hide filter of its scope matches it, or
 * the keep filters of its category, or of its feed, apply and it meets none of them.
 */
const FILTERED = `(a.origin = 'feed' AND (
  EXISTS (SELECT 1 FROM filter_matches hm JOIN filters h ON h.id = hm.filter_id
    WHERE hm.article_id = a.id AND h.enabled = 1 AND h.action = 'hide' AND ${inScope("h", "a")})
  OR ${notKept("category", "a")}
  OR ${notKept("feed", "a")}))`;

/**
 * Whether the enabled filter `f` hides the feed article `a`, counted for that filter. Articles the reader keeps
 * with a star or an annotation are not.
 */
function hiddenByFilter(f: string, a: string): string {
  return `(NOT ${keptByReader(a)} AND ${f}.enabled = 1 AND ${inScope(f, a)} AND CASE ${f}.action
    WHEN 'hide' THEN EXISTS (SELECT 1 FROM filter_matches fm WHERE fm.filter_id = ${f}.id AND fm.article_id = ${a}.id)
    ELSE NOT ${keptBySameScope(f, a)} END)`;
}

/**
 * Works out `filtered` again for the feed articles `a` that meet `where`. Returns how many came back to the
 * lists: articles without a star or an annotation that were hidden and are not any more.
 */
export function refreshFiltered(db: Database, where = "1", params: Array<string | number> = []): number {
  const changed = db
    .prepare(
      `UPDATE articles AS a SET filtered = 1 - filtered
        WHERE a.origin = 'feed' AND (${where}) AND a.filtered <> (CASE WHEN ${FILTERED} THEN 1 ELSE 0 END)
        RETURNING id, filtered, starred`,
    )
    .all(...params);
  const back = changed.filter((row) => num(row.filtered) === 0 && num(row.starred) === 0).map((row) => num(row.id));
  if (back.length === 0) return 0;
  // An annotated article was in the lists all along. RETURNING cannot look at another table.
  const annotated = db
    .prepare("SELECT count(DISTINCT article_id) AS n FROM annotations WHERE article_id IN (SELECT value FROM json_each(?))")
    .get(JSON.stringify(back))!;
  return back.length - num(annotated.n);
}

// ---- the stored filters ------------------------------------------------------------------------

interface StoredFilter {
  id: number;
  action: FilterAction;
  scope: FilterScope;
  conditions: FilterCondition[];
  enabled: boolean;
  createdAt: string;
}

function toScope(row: Row): FilterScope {
  switch (str(row.scope)) {
    case "category":
      return { type: "category", categoryId: num(row.category_id) };
    case "feed":
      return { type: "feed", feedId: num(row.feed_id) };
    default:
      return { type: "all" };
  }
}

function conditionsByFilter(db: Database, id?: number): Map<number, FilterCondition[]> {
  const rows = db
    .prepare(
      `SELECT filter_id, fields, method, value FROM filter_conditions ${id === undefined ? "" : "WHERE filter_id = ?"}
        ORDER BY filter_id, position`,
    )
    .all(...(id === undefined ? [] : [id]));
  const map = new Map<number, FilterCondition[]>();
  for (const row of rows) {
    const list = map.get(num(row.filter_id)) ?? [];
    list.push({ fields: json<FilterCondition["fields"]>(row.fields), match: str(row.method) as FilterCondition["match"], value: str(row.value) });
    map.set(num(row.filter_id), list);
  }
  return map;
}

function toStored(row: Row, conditions: Map<number, FilterCondition[]>): StoredFilter {
  return {
    id: num(row.id),
    action: str(row.action) as FilterAction,
    scope: toScope(row),
    conditions: conditions.get(num(row.id)) ?? [],
    enabled: num(row.enabled) === 1,
    createdAt: str(row.created_at),
  };
}

const HIDDEN_COUNT = `CASE
  WHEN f.enabled = 0 THEN 0
  WHEN f.action = 'hide' THEN (SELECT count(*) FROM filter_matches m JOIN articles a ON a.id = m.article_id
    WHERE m.filter_id = f.id AND NOT ${keptByReader("a")} AND ${inScope("f", "a")})
  ELSE (SELECT count(*) FROM articles a WHERE NOT ${keptByReader("a")} AND ${inScope("f", "a")} AND NOT ${keptBySameScope("f", "a")})
END AS hidden_count`;

/** Every filter in the order they were registered, with how many feed articles each hides now. */
export function listFilters(db: Database): Filter[] {
  const conditions = conditionsByFilter(db);
  return db
    .prepare(`SELECT f.*, ${HIDDEN_COUNT} FROM filters f ORDER BY f.id`)
    .all()
    .map((row) => ({ ...toStored(row, conditions), hiddenCount: num(row.hidden_count) }));
}

export function getFilter(db: Database, id: number): Filter {
  const row = db.prepare(`SELECT f.*, ${HIDDEN_COUNT} FROM filters f WHERE f.id = ?`).get(id);
  if (!row) throw notFound("filter", id);
  return { ...toStored(row, conditionsByFilter(db, id)), hiddenCount: num(row.hidden_count) };
}

function storedFilters(db: Database): StoredFilter[] {
  const conditions = conditionsByFilter(db);
  return db
    .prepare("SELECT * FROM filters ORDER BY id")
    .all()
    .map((row) => toStored(row, conditions));
}

// ---- matching ----------------------------------------------------------------------------------

interface ArticleText {
  id: number;
  title: string;
  contentText: string;
  author: string | null;
  url: string | null;
}

/** The feed articles `a` that meet `where`, with what conditions look at. */
function articleTexts(db: Database, where = "1", params: Array<string | number | null> = []): ArticleText[] {
  return db
    .prepare(
      `SELECT a.id, a.title, a.content_text, a.author,
              (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS url
         FROM articles a WHERE a.origin = 'feed' AND (${where})`,
    )
    .all(...params)
    .map((row) => ({ id: num(row.id), title: str(row.title), contentText: str(row.content_text), author: strOrNull(row.author), url: strOrNull(row.url) }));
}

/** Matches one filter's conditions against every feed article again. */
function matchFilter(db: Database, filterId: number, conditions: FilterCondition[]): void {
  db.prepare("DELETE FROM filter_matches WHERE filter_id = ?").run(filterId);
  const compiled = compileConditions(conditions);
  const insert = db.prepare("INSERT INTO filter_matches (filter_id, article_id) VALUES (?, ?)");
  for (const article of articleTexts(db)) if (matchesAll(compiled, article)) insert.run(filterId, article.id);
}

/** Matches one feed article against every filter, after it was stored or its content changed. */
export function applyFilters(db: Database, articleId: number): void {
  const filters = storedFilters(db);
  db.prepare("DELETE FROM filter_matches WHERE article_id = ?").run(articleId);
  if (filters.length > 0) {
    const [article] = articleTexts(db, "a.id = ?", [articleId]);
    if (article) {
      const insert = db.prepare("INSERT INTO filter_matches (filter_id, article_id) VALUES (?, ?)");
      for (const filter of filters) if (matchesAll(compileConditions(filter.conditions), article)) insert.run(filter.id, articleId);
    }
  }
  refreshFiltered(db, "a.id = ?", [articleId]);
}

/** Matches every filter against every feed article and works out `filtered` for all of them. */
export function rebuildFilterMatches(db: Database): void {
  transaction(db, () => {
    db.exec("DELETE FROM filter_matches");
    for (const filter of storedFilters(db)) matchFilter(db, filter.id, filter.conditions);
    refreshFiltered(db);
  });
}

/**
 * After the migration from stop words, the first start matches the filters once: SQL alone cannot match as
 * the server does. Returns whether it did.
 */
export function buildPendingFilterMatches(db: Database): boolean {
  if (!db.prepare("SELECT 1 FROM filter_matches_pending").get()) return false;
  transaction(db, () => {
    rebuildFilterMatches(db);
    db.exec("DELETE FROM filter_matches_pending");
  });
  return true;
}

// ---- checks ------------------------------------------------------------------------------------

/** Refuses conditions the server cannot match and a scope that names nothing. */
function check(db: Database, filter: { scope: FilterScope; conditions: FilterCondition[] }): void {
  const problems: FieldError[] = conditionProblems(filter.conditions);
  const { scope } = filter;
  if (scope.type === "category" && !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(scope.categoryId)) {
    problems.push({ path: "scope.categoryId", message: "no such category" });
  }
  if (scope.type === "feed" && !db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(scope.feedId)) {
    problems.push({ path: "scope.feedId", message: "no such feed" });
  }
  if (problems.length > 0) throw new DomainError("invalid", "the filter is invalid", problems);
}

/** What makes two filters the same: action, scope, and conditions in order with their fields as a set. */
function signature(filter: { action: FilterAction; scope: FilterScope; conditions: FilterCondition[] }): string {
  return JSON.stringify([
    filter.action,
    filter.scope,
    filter.conditions.map((condition) => [[...condition.fields].sort(), condition.match, normalizedValue(condition)]),
  ]);
}

/** The registered filter that is the same as the given one, apart from the one of `except`. */
export function findSameFilter(
  db: Database,
  filter: { action: FilterAction; scope: FilterScope; conditions: FilterCondition[] },
  except?: number,
): Filter | null {
  const wanted = signature(filter);
  const same = storedFilters(db).find((stored) => stored.id !== except && signature(stored) === wanted);
  return same ? getFilter(db, same.id) : null;
}

function refuseSame(): DomainError {
  return new DomainError("conflict", "the same filter is already registered", [{ path: "conditions", message: "already registered" }]);
}

// ---- changes -----------------------------------------------------------------------------------

function scopeColumns(scope: FilterScope): [string, number | null, number | null] {
  if (scope.type === "category") return ["category", scope.categoryId, null];
  if (scope.type === "feed") return ["feed", null, scope.feedId];
  return ["all", null, null];
}

function storeConditions(db: Database, filterId: number, conditions: FilterCondition[]): void {
  db.prepare("DELETE FROM filter_conditions WHERE filter_id = ?").run(filterId);
  const insert = db.prepare("INSERT INTO filter_conditions (filter_id, position, fields, method, value, normalized) VALUES (?, ?, ?, ?, ?, ?)");
  conditions.forEach((condition, position) =>
    insert.run(filterId, position, JSON.stringify(condition.fields), condition.match, condition.value, normalizedValue(condition)),
  );
}

/** Registers a filter, matches it against the stored feed articles and hides what it should. */
export function createFilter(db: Database, input: FilterCreate, clock: Clock): Filter {
  check(db, input);
  if (findSameFilter(db, input)) throw refuseSame();
  return transaction(db, () => {
    const [scope, categoryId, feedId] = scopeColumns(input.scope);
    const id = num(
      db
        .prepare("INSERT INTO filters (action, scope, category_id, feed_id, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(input.action, scope, categoryId, feedId, (input.enabled ?? true) ? 1 : 0, clock().toISOString()).lastInsertRowid,
    );
    storeConditions(db, id, input.conditions);
    matchFilter(db, id, input.conditions);
    refreshFiltered(db);
    return getFilter(db, id);
  });
}

/**
 * Changes a filter. Only new conditions are matched again; a change of action, scope or the switch works out
 * which articles are hidden from the pairs already stored. Says how many articles came back to the lists.
 */
export function updateFilter(db: Database, id: number, patch: FilterUpdate): FilterUpdateResult {
  const current = getFilter(db, id);
  const next = {
    action: patch.action ?? current.action,
    scope: patch.scope ?? current.scope,
    conditions: patch.conditions ?? current.conditions,
    enabled: patch.enabled ?? current.enabled,
  };
  if (next.action === "keep" && next.scope.type === "all") {
    throw new DomainError("invalid", "the filter is invalid", [{ path: "scope", message: "a keep filter cannot apply to everything" }]);
  }
  check(db, next);
  if (findSameFilter(db, next, id)) throw refuseSame();
  return transaction(db, () => {
    const [scope, categoryId, feedId] = scopeColumns(next.scope);
    db.prepare("UPDATE filters SET action = ?, scope = ?, category_id = ?, feed_id = ?, enabled = ? WHERE id = ?").run(
      next.action,
      scope,
      categoryId,
      feedId,
      next.enabled ? 1 : 0,
      id,
    );
    if (patch.conditions !== undefined) {
      storeConditions(db, id, next.conditions);
      matchFilter(db, id, next.conditions);
    }
    const restored = refreshFiltered(db);
    return { ...getFilter(db, id), restored };
  });
}

/** Removes a filter. What it hid comes back unless another filter hides it too. Says how many came back. */
export function deleteFilter(db: Database, id: number): FilterDeleteResult {
  getFilter(db, id);
  return transaction(db, () => {
    // The pairs and conditions go with it (ON DELETE CASCADE); `filtered` still says what was hidden before.
    db.prepare("DELETE FROM filters WHERE id = ?").run(id);
    return { restored: refreshFiltered(db) };
  });
}

// ---- reading what a filter hides ---------------------------------------------------------------

/** The feed articles the filter counts as hidden, newest first, a page at a time like the article list. */
export function listFilterArticles(db: Database, id: number, query: FilterArticlesQuery): ArticlePage {
  getFilter(db, id);
  return pageArticles(db, `EXISTS (SELECT 1 FROM filters f WHERE f.id = ? AND ${hiddenByFilter("f", "a")})`, [id], query);
}

/**
 * How many feed articles the filter would hide if it were saved and enabled, counted as the filter list
 * counts. Nothing is stored. With `id`, that stored filter is left out, so an edit is counted as it would be.
 */
export function previewFilter(db: Database, input: FilterPreview): FilterPreviewResult {
  check(db, input);
  if (input.id !== undefined) getFilter(db, input.id);
  const [scope, categoryId, feedId] = scopeColumns(input.scope);
  const where = [
    `NOT ${keptByReader("a")}`,
    scope === "category" ? "a.category_id = ?" : scope === "feed" ? "a.feed_id = ?" : "1",
  ];
  const params: Array<string | number | null> = scope === "category" ? [categoryId!] : scope === "feed" ? [feedId!] : [];
  if (input.action === "keep") {
    // Another keep filter of the same scope keeps what it matches.
    where.push(`NOT EXISTS (SELECT 1 FROM filter_matches km JOIN filters k ON k.id = km.filter_id
      WHERE km.article_id = a.id AND k.enabled = 1 AND k.action = 'keep' AND k.scope = ? AND k.category_id IS ? AND k.feed_id IS ?
        AND k.id IS NOT ?)`);
    params.push(scope, categoryId, feedId, input.id ?? null);
  }
  const compiled: CompiledCondition[] = compileConditions(input.conditions);
  const articles = articleTexts(db, where.join(" AND "), params);
  const meets = articles.filter((article) => matchesAll(compiled, article)).length;
  return { hiddenCount: input.action === "hide" ? meets : articles.length - meets };
}
