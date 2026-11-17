import {
  RULE_ACTIONS,
  type FilterCondition,
  type FilterScope,
  type Rule,
  type RuleAction,
  type RuleCreate,
  type RuleNotificationList,
  type RuleNotificationsQuery,
  type RulePreview,
  type RulePreviewResult,
  type RuleUpdate,
} from "../api.ts";
import type { Clock } from "../clock.ts";
import { DomainError, notFound, type FieldError } from "../errors.ts";
import { compileConditions, conditionProblems, matchesAll, normalizedValue, Texts } from "../filters/match.ts";
import { feedCategoriesOf, hiddenByFilters, hiddenDuplicate, SUMMARY_COLUMNS, toSummary } from "./articles.ts";
import type { Database } from "./database.ts";
import { json, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";

// A rule acts on a feed article once, when it is first stored: it stars it, marks it read, makes it one the app
// notifies, or asks for its summary. Its conditions and scope have the form of a filter's and are matched the
// same way. Nothing a rule matched is kept, only what it did, on the article: a rule never applies to what is
// stored already. No model is involved.

/** The column that holds each action. */
const ACTION_COLUMN: Record<RuleAction, string> = { star: "star", read: "mark_read", notify: "notify", summarize: "summarize" };

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

function toRule(row: Row): Rule {
  return {
    id: num(row.id),
    scope: toScope(row),
    conditions: json<FilterCondition[]>(row.conditions),
    actions: RULE_ACTIONS.filter((action) => num(row[ACTION_COLUMN[action]]) === 1),
    enabled: num(row.enabled) === 1,
    createdAt: str(row.created_at),
  };
}

/** Every rule in the order they were registered. */
export function listRules(db: Database): Rule[] {
  return db.prepare("SELECT * FROM rules ORDER BY id").all().map(toRule);
}

export function getRule(db: Database, id: number): Rule {
  const row = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!row) throw notFound("rule", id);
  return toRule(row);
}

// ---- checks ------------------------------------------------------------------------------------

/** Refuses conditions the server cannot match, a scope that names nothing, and a rule that does nothing. */
function check(db: Database, rule: { scope: FilterScope; conditions: FilterCondition[]; actions?: RuleAction[] }): void {
  const problems: FieldError[] = conditionProblems(rule.conditions);
  const { scope } = rule;
  if (scope.type === "category" && !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(scope.categoryId)) {
    problems.push({ path: "scope.categoryId", message: "no such category", code: "no_such_item" });
  }
  if (scope.type === "feed" && !db.prepare("SELECT 1 FROM feeds WHERE id = ?").get(scope.feedId)) {
    problems.push({ path: "scope.feedId", message: "no such feed", code: "no_such_item" });
  }
  if (rule.actions !== undefined && rule.actions.length === 0) {
    problems.push({ path: "actions", message: "a rule needs at least one action", code: "too_small", minimum: 1, unit: "items" });
  }
  if (problems.length > 0) throw new DomainError("invalid", "the rule is invalid", problems);
}

/** What makes two rules the same: scope, conditions in order with their fields as a set, and actions as a set. */
function signature(rule: { scope: FilterScope; conditions: FilterCondition[]; actions: RuleAction[] }): string {
  return JSON.stringify([
    rule.scope,
    rule.conditions.map((condition) => [[...condition.fields].sort(), condition.match, normalizedValue(condition)]),
    RULE_ACTIONS.filter((action) => rule.actions.includes(action)),
  ]);
}

/** The registered rule that is the same as the given one, apart from the one of `except`. */
export function findSameRule(db: Database, rule: { scope: FilterScope; conditions: FilterCondition[]; actions: RuleAction[] }, except?: number): Rule | null {
  const wanted = signature(rule);
  return listRules(db).find((stored) => stored.id !== except && signature(stored) === wanted) ?? null;
}

function refuseSame(): DomainError {
  return new DomainError("conflict", "the same rule is already registered", [{ path: "conditions", message: "already registered" }]);
}

// ---- changes -----------------------------------------------------------------------------------

function scopeColumns(scope: FilterScope): [string, number | null, number | null] {
  if (scope.type === "category") return ["category", scope.categoryId, null];
  if (scope.type === "feed") return ["feed", null, scope.feedId];
  return ["all", null, null];
}

function actionColumns(actions: RuleAction[]): number[] {
  return RULE_ACTIONS.map((action) => (actions.includes(action) ? 1 : 0));
}

/** Registers a rule. It applies to the feed articles stored from now on, never to those stored already. */
export function createRule(db: Database, input: RuleCreate, clock: Clock): Rule {
  check(db, input);
  if (findSameRule(db, input)) throw refuseSame();
  const [scope, categoryId, feedId] = scopeColumns(input.scope);
  const id = num(
    db
      .prepare(
        `INSERT INTO rules (scope, category_id, feed_id, enabled, conditions, star, mark_read, notify, summarize, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(scope, categoryId, feedId, (input.enabled ?? true) ? 1 : 0, JSON.stringify(input.conditions), ...actionColumns(input.actions), clock().toISOString())
      .lastInsertRowid,
  );
  return getRule(db, id);
}

/** Changes a rule. Like a new one, it applies to the feed articles stored from now on only. */
export function updateRule(db: Database, id: number, patch: RuleUpdate): Rule {
  const current = getRule(db, id);
  const next = {
    scope: patch.scope ?? current.scope,
    conditions: patch.conditions ?? current.conditions,
    actions: patch.actions ?? current.actions,
    enabled: patch.enabled ?? current.enabled,
  };
  check(db, next);
  if (findSameRule(db, next, id)) throw refuseSame();
  const [scope, categoryId, feedId] = scopeColumns(next.scope);
  db.prepare(
    `UPDATE rules SET scope = ?, category_id = ?, feed_id = ?, enabled = ?, conditions = ?, star = ?, mark_read = ?, notify = ?, summarize = ?
      WHERE id = ?`,
  ).run(scope, categoryId, feedId, next.enabled ? 1 : 0, JSON.stringify(next.conditions), ...actionColumns(next.actions), id);
  return getRule(db, id);
}

/** Removes a rule. What it did to articles stays. */
export function deleteRule(db: Database, id: number): void {
  getRule(db, id);
  db.prepare("DELETE FROM rules WHERE id = ?").run(id);
}

// ---- matching ----------------------------------------------------------------------------------

interface RuleArticle {
  id: number;
  feedId: number | null;
  categoryId: number | null;
  title: string;
  contentText: string;
  author: string | null;
  url: string | null;
  feedCategories: string[];
}

/** The feed articles `a` that meet `where`, with what conditions look at. */
function ruleArticles(db: Database, where: string, params: Array<string | number | null>): RuleArticle[] {
  return db
    .prepare(
      `SELECT a.id, a.feed_id, a.category_id, a.title, a.content_text, a.author, a.feed_categories,
              (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS url
         FROM articles a WHERE a.origin = 'feed' AND (${where})`,
    )
    .all(...params)
    .map((row) => ({
      id: num(row.id),
      feedId: numOrNull(row.feed_id),
      categoryId: numOrNull(row.category_id),
      title: str(row.title),
      contentText: str(row.content_text),
      author: strOrNull(row.author),
      url: strOrNull(row.url),
      feedCategories: feedCategoriesOf(strOrNull(row.feed_categories)),
    }));
}

/** Whether the scope takes in the article, judged by where it belongs now. */
function inScope(scope: FilterScope, article: RuleArticle): boolean {
  if (scope.type === "category") return article.categoryId === scope.categoryId;
  if (scope.type === "feed") return article.feedId === scope.feedId;
  return true;
}

/**
 * Applies the enabled rules to a feed article that was just stored for the first time, after the filters were
 * matched. An article that filters hide, and a duplicate, are left alone. Every rule it meets acts on it: it is
 * starred, marked read, made one to notify unless it was marked read, and given a summary request, as they say.
 */
export function applyRules(db: Database, articleId: number, now: string): void {
  const rules = listRules(db).filter((rule) => rule.enabled);
  if (rules.length === 0) return;
  const [article] = ruleArticles(db, "a.id = ? AND a.filtered = 0 AND a.duplicate_of IS NULL", [articleId]);
  if (!article) return;
  const texts = new Texts(article);
  const actions = new Set<RuleAction>();
  for (const rule of rules) {
    if (inScope(rule.scope, article) && matchesAll(compileConditions(rule.conditions), texts)) for (const action of rule.actions) actions.add(action);
  }
  if (actions.size === 0) return;
  const read = actions.has("read");
  db.prepare(
    `UPDATE articles SET
       starred = CASE WHEN ? THEN 1 ELSE starred END,
       is_read = CASE WHEN ? THEN 1 ELSE is_read END,
       read_at = CASE WHEN ? THEN ? ELSE read_at END,
       rule_notify_at = CASE WHEN ? THEN ? ELSE rule_notify_at END,
       rule_summary_requested_at = CASE WHEN ? THEN ? ELSE rule_summary_requested_at END
     WHERE id = ?`,
  ).run(
    actions.has("star") ? 1 : 0,
    read ? 1 : 0,
    read ? 1 : 0,
    now,
    actions.has("notify") && !read ? 1 : 0,
    now,
    actions.has("summarize") ? 1 : 0,
    now,
    articleId,
  );
}

/**
 * How many stored feed articles of the scope meet the conditions, leaving out what filters hide and hidden
 * duplicates, which a rule would leave alone. Nothing is stored or changed.
 */
export function previewRule(db: Database, input: RulePreview): RulePreviewResult {
  check(db, input);
  const [scope, categoryId, feedId] = scopeColumns(input.scope);
  const where = [`NOT ${hiddenByFilters("a")}`, `NOT ${hiddenDuplicate("a")}`];
  const params: number[] = [];
  if (scope === "category") {
    where.push("a.category_id = ?");
    params.push(categoryId!);
  } else if (scope === "feed") {
    where.push("a.feed_id = ?");
    params.push(feedId!);
  }
  const compiled = compileConditions(input.conditions);
  return { matchCount: ruleArticles(db, where.join(" AND "), params).filter((article) => matchesAll(compiled, article)).length };
}

// ---- notifications -----------------------------------------------------------------------------

/**
 * The unread feed articles a rule made ones to notify, after `after` when it is given, newest first by when
 * that happened, with the title of their feed. What filters hide now is left out.
 */
export function listRuleNotifications(db: Database, query: RuleNotificationsQuery): RuleNotificationList {
  const where = ["a.rule_notify_at IS NOT NULL", "a.is_read = 0", `NOT ${hiddenByFilters("a")}`];
  const params: Array<string | number> = [];
  if (query.after !== undefined) {
    where.push("a.rule_notify_at > ?");
    params.push(new Date(query.after).toISOString());
  }
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, f.title AS feed_title FROM articles a JOIN feeds f ON f.id = a.feed_id
        WHERE ${where.join(" AND ")} ORDER BY a.rule_notify_at DESC, a.id DESC LIMIT ?`,
    )
    .all(...params, query.limit ?? 50);
  return { items: rows.map((row) => ({ notifiedAt: str(row.rule_notify_at), feedTitle: str(row.feed_title), article: toSummary(row) })) };
}
