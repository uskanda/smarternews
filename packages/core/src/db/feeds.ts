import { FEED_STATS_DAYS, type Feed, type FeedMove, type FeedStats, type FeedUpdate } from "../api.ts";
import { systemClock, type Clock } from "../clock.ts";
import { DomainError, notFound } from "../errors.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { hasAnnotation, hiddenByFilters, hiddenDuplicate } from "./articles.ts";
import { findCategory } from "./categories.ts";
import { transaction, type Database } from "./database.ts";
import { refreshFiltered } from "./filters.ts";
import { bool, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";
import { getSettings } from "./settings.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_WAIT_MS = 24 * 60 * MINUTE;

/** Feed articles without a star or an annotation are kept this long, counted from the time they sort by. */
export const FEED_RETENTION_DAYS = 90;

/**
 * The articles the stats of a feed count: the feed articles of the feed `feed` (an SQL expression) stored at or
 * after the one parameter it takes. The origin condition stays although only feed articles have a feed.
 */
const recentArticles = (alias: string, feed: string) => `${alias}.origin = 'feed' AND ${alias}.feed_id = ${feed} AND ${alias}.created_at >= ?`;

/** Takes one parameter first: the start of the stats period. */
const FEED_COLUMNS = `f.*,
  (SELECT count(*) FROM articles a WHERE ${recentArticles("a", "f.id")}) AS recent_article_count,
  (SELECT count(*) FROM articles a WHERE a.feed_id = f.id) AS article_count,
  (SELECT count(*) FROM articles a WHERE a.feed_id = f.id AND a.starred = 1) AS starred_count,
  (SELECT count(*) FROM articles a WHERE a.feed_id = f.id AND ${hasAnnotation("a")}) AS annotated_count`;

/** The start of the stats period that ends at `now`. */
function statsSince(now: Date): string {
  return new Date(now.getTime() - FEED_STATS_DAYS * DAY).toISOString();
}

/** Enabled, and no new item since the subscription or the last one for more than the given days. */
function isStale(row: Row, staleDays: number, now: Date): boolean {
  if (!bool(row.enabled)) return false;
  const since = new Date(strOrNull(row.last_new_item_at) ?? str(row.created_at)).getTime();
  return now.getTime() - since > staleDays * DAY;
}

/**
 * How long to wait after the last fetch: the interval, doubled for every failure in a row, one day at most.
 * Computed when asked rather than stored, so a change of the base interval applies at once.
 */
function waitMs(intervalMinutes: number | null, failureCount: number, baseMinutes: number): number {
  const interval = (intervalMinutes ?? baseMinutes) * MINUTE;
  return Math.min(interval * 2 ** Math.min(failureCount, 20), MAX_WAIT_MS);
}

function nextFetchFrom(row: Row, baseMinutes: number): Date {
  const last = strOrNull(row.last_fetched_at);
  if (last === null) return new Date(str(row.created_at));
  return new Date(new Date(last).getTime() + waitMs(numOrNull(row.interval_minutes), num(row.failure_count), baseMinutes));
}

interface FeedContext {
  baseMinutes: number;
  staleDays: number;
  now: Date;
}

function feedContext(db: Database, now: Date): FeedContext {
  const settings = getSettings(db);
  return { baseMinutes: settings.feedIntervalMinutes, staleDays: settings.staleFeedDays, now };
}

function toFeed(row: Row, { baseMinutes, staleDays, now }: FeedContext): Feed {
  const enabled = bool(row.enabled);
  return {
    id: num(row.id),
    url: str(row.url),
    title: str(row.title),
    siteUrl: strOrNull(row.site_url),
    categoryId: numOrNull(row.category_id),
    intervalMinutes: numOrNull(row.interval_minutes),
    enabled,
    autoSummarize: bool(row.auto_summarize),
    translate: bool(row.translate),
    fetchFullContent: bool(row.fetch_full_content),
    lastFetchedAt: strOrNull(row.last_fetched_at),
    lastSucceededAt: strOrNull(row.last_succeeded_at),
    lastError: strOrNull(row.last_error),
    failureCount: num(row.failure_count),
    nextFetchAt: enabled ? nextFetchFrom(row, baseMinutes).toISOString() : null,
    articleCount: num(row.article_count),
    starredCount: num(row.starred_count),
    annotatedCount: num(row.annotated_count),
    createdAt: str(row.created_at),
    lastNewItemAt: strOrNull(row.last_new_item_at),
    stale: isStale(row, staleDays, now),
    recentArticleCount: num(row.recent_article_count),
  };
}

/** The feeds as they are at `now`, which decides which are stale and what counts as recent. */
export function listFeeds(db: Database, now: Date = systemClock()): Feed[] {
  const context = feedContext(db, now);
  return db
    // In the order of the lists: by category, then within it; the feeds of no category come last.
    .prepare(
      `SELECT ${FEED_COLUMNS} FROM feeds f LEFT JOIN categories c ON c.id = f.category_id
        ORDER BY c.id IS NULL, c.position, c.id, f.position, f.id`,
    )
    .all(statsSince(now))
    .map((row) => toFeed(row, context));
}

export function findFeed(db: Database, id: number, now: Date = systemClock()): Feed | null {
  const row = db.prepare(`SELECT ${FEED_COLUMNS} FROM feeds f WHERE f.id = ?`).get(statsSince(now), id);
  return row ? toFeed(row, feedContext(db, now)) : null;
}

export function getFeed(db: Database, id: number, now: Date = systemClock()): Feed {
  const feed = findFeed(db, id, now);
  if (!feed) throw notFound("feed", id);
  return feed;
}

export function findFeedByUrl(db: Database, url: string): Feed | null {
  const row = db.prepare("SELECT id FROM feeds WHERE url = ?").get(normalizeUrl(url));
  return row ? getFeed(db, num(row.id)) : null;
}

/**
 * What became of the articles the feed delivered within the last `FEED_STATS_DAYS` days before `now`, counted
 * from what the articles are now. No model is involved.
 */
export function feedStats(db: Database, id: number, now: Date): FeedStats {
  const feed = getFeed(db, id, now);
  const since = statsSince(now);
  const row = db
    .prepare(
      `SELECT count(*) AS received, count(a.opened_at) AS opened, coalesce(sum(a.starred = 1), 0) AS starred,
              coalesce(sum(${hiddenByFilters("a")}), 0) AS hidden_by_filters, coalesce(sum(${hiddenDuplicate("a")}), 0) AS hidden_as_duplicates
         FROM articles a WHERE ${recentArticles("a", "?")}`,
    )
    .get(id, since)!;
  return {
    since,
    received: num(row.received),
    opened: num(row.opened),
    starred: num(row.starred),
    hiddenByFilters: num(row.hidden_by_filters),
    hiddenAsDuplicates: num(row.hidden_as_duplicates),
    lastNewItemAt: feed.lastNewItemAt,
  };
}

/** When the feed is fetched next, whether or not it is enabled. */
export function nextFetchAt(db: Database, feed: Feed): Date {
  const row = db.prepare("SELECT * FROM feeds WHERE id = ?").get(feed.id)!;
  return nextFetchFrom(row, getSettings(db).feedIntervalMinutes);
}

/** The enabled feeds whose wait is over, the longest overdue first. */
export function dueFeeds(db: Database, now: Date): Feed[] {
  return listFeeds(db, now)
    .filter((feed) => feed.nextFetchAt !== null && new Date(feed.nextFetchAt) <= now)
    .sort((a, b) => a.nextFetchAt!.localeCompare(b.nextFetchAt!) || a.id - b.id);
}

/** A feed may belong to a news category or to none: an event category lists events by day. */
export function checkFeedCategory(db: Database, categoryId: number | null | undefined): void {
  if (categoryId === null || categoryId === undefined) return;
  const category = findCategory(db, categoryId);
  if (!category) {
    throw new DomainError("invalid", `category ${categoryId} does not exist`, [{ path: "categoryId", message: "no such category" }]);
  }
  if (category.kind !== "news") {
    throw new DomainError("invalid", `a feed cannot belong to the ${category.kind} category "${category.name}"`, [
      { path: "categoryId", message: "must be a news category or none" },
    ]);
  }
}

function lastPosition(db: Database, categoryId: number | null): number {
  return num(db.prepare("SELECT coalesce(max(position), 0) AS last FROM feeds WHERE category_id IS ?").get(categoryId)!.last);
}

function setFeedCategory(db: Database, id: number, categoryId: number | null): void {
  db.prepare("UPDATE feeds SET category_id = ? WHERE id = ?").run(categoryId, id);
  // Articles carry their feed's category, so that lists and counts by category need no join.
  db.prepare("UPDATE articles SET category_id = ? WHERE feed_id = ?").run(categoryId, id);
  // The filters of the category the feed left stop applying, and those of the one it joined start to.
  refreshFiltered(db, "a.feed_id = ?", [id]);
}

/** The ids of the feeds of one category, or of none, in their order. */
function feedIdsOf(db: Database, categoryId: number | null): number[] {
  return db
    .prepare("SELECT id FROM feeds WHERE category_id IS ? ORDER BY position, id")
    .all(categoryId)
    .map((row) => num(row.id));
}

/** Stores the order of the feeds of one category: the given ones first, in that order, then the rest as they were. */
export function orderFeeds(db: Database, categoryId: number | null, ids: number[]): void {
  const first = new Set(ids);
  const all = [...ids, ...feedIdsOf(db, categoryId).filter((id) => !first.has(id))];
  const set = db.prepare("UPDATE feeds SET position = ? WHERE id = ? AND category_id IS ?");
  transaction(db, () => all.forEach((id, index) => set.run(index + 1, id, categoryId)));
}

/**
 * Puts a feed into a category, or into none, before another feed there or last. Membership and order change
 * together, and the other feeds keep their order.
 */
export function moveFeed(db: Database, id: number, to: FeedMove): Feed {
  const current = getFeed(db, id);
  checkFeedCategory(db, to.categoryId);
  const others = feedIdsOf(db, to.categoryId).filter((other) => other !== id);
  if (to.before !== null && to.before !== id && !others.includes(to.before)) {
    throw new DomainError("invalid", `feed ${to.before} is not in that category`, [{ path: "before", message: "not a feed of the target category" }]);
  }
  if (to.before === id && to.categoryId === current.categoryId) return current;
  const at = to.before === null || to.before === id ? others.length : others.indexOf(to.before);
  transaction(db, () => {
    if (to.categoryId !== current.categoryId) setFeedCategory(db, id, to.categoryId);
    orderFeeds(db, to.categoryId, [...others.slice(0, at), id, ...others.slice(at)]);
  });
  return getFeed(db, id);
}

export interface NewFeed {
  url: string;
  title: string;
  /** True when the user chose the title; the feed's own title then never replaces it. */
  titleSetByUser?: boolean;
  siteUrl?: string | null;
  categoryId?: number | null;
  intervalMinutes?: number | null;
  enabled?: boolean;
  /** Summarise the articles this feed delivers from now on. */
  autoSummarize?: boolean;
  /** Translate the titles and contents of the articles this feed delivers. */
  translate?: boolean;
  /** Fetch the full content of the articles this feed delivers from now on. */
  fetchFullContent?: boolean;
}

/** Stores a feed without fetching it. Refuses a URL that is already subscribed. */
export function insertFeed(db: Database, input: NewFeed, clock: Clock): Feed {
  const url = normalizeUrl(input.url);
  if (db.prepare("SELECT 1 FROM feeds WHERE url = ?").get(url)) {
    throw new DomainError("conflict", `already subscribed: ${url}`, [{ path: "url", message: "already subscribed" }]);
  }
  checkFeedCategory(db, input.categoryId);
  const now = clock().toISOString();
  const result = db
    .prepare(
      `INSERT INTO feeds
         (url, title, title_set_by_user, site_url, category_id, interval_minutes, enabled, created_at, position,
          auto_summarize, auto_summarize_since, translate, fetch_full_content, fetch_full_content_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      url,
      input.title,
      input.titleSetByUser ? 1 : 0,
      input.siteUrl ?? null,
      input.categoryId ?? null,
      input.intervalMinutes ?? null,
      (input.enabled ?? true) ? 1 : 0,
      now,
      lastPosition(db, input.categoryId ?? null) + 1,
      input.autoSummarize ? 1 : 0,
      input.autoSummarize ? now : null,
      input.translate ? 1 : 0,
      input.fetchFullContent ? 1 : 0,
      input.fetchFullContent ? now : null,
    );
  return getFeed(db, num(result.lastInsertRowid), clock());
}

/**
 * Changes a feed. Switching summaries or full content on records the time: only articles stored after it are
 * summarised, or have their full content fetched. Switching either on again when it is on keeps the earlier time.
 */
export function updateFeed(db: Database, id: number, patch: FeedUpdate, clock: Clock = systemClock): Feed {
  const current = getFeed(db, id);
  if (patch.categoryId !== undefined) checkFeedCategory(db, patch.categoryId);
  transaction(db, () => {
    if (patch.title !== undefined) db.prepare("UPDATE feeds SET title = ?, title_set_by_user = 1 WHERE id = ?").run(patch.title, id);
    if (patch.intervalMinutes !== undefined) db.prepare("UPDATE feeds SET interval_minutes = ? WHERE id = ?").run(patch.intervalMinutes, id);
    if (patch.enabled !== undefined) db.prepare("UPDATE feeds SET enabled = ? WHERE id = ?").run(patch.enabled ? 1 : 0, id);
    if (patch.autoSummarize !== undefined && patch.autoSummarize !== current.autoSummarize) {
      db.prepare("UPDATE feeds SET auto_summarize = ?, auto_summarize_since = ? WHERE id = ?").run(
        patch.autoSummarize ? 1 : 0,
        patch.autoSummarize ? clock().toISOString() : null,
        id,
      );
    }
    // Full content already stored stays; articles that wait for it stop waiting when it is switched off.
    if (patch.fetchFullContent !== undefined && patch.fetchFullContent !== current.fetchFullContent) {
      db.prepare("UPDATE feeds SET fetch_full_content = ?, fetch_full_content_since = ? WHERE id = ?").run(
        patch.fetchFullContent ? 1 : 0,
        patch.fetchFullContent ? clock().toISOString() : null,
        id,
      );
    }
    // Nothing is translated here: the articles the feed already has are translated when they are opened.
    if (patch.translate !== undefined) db.prepare("UPDATE feeds SET translate = ? WHERE id = ?").run(patch.translate ? 1 : 0, id);
    if (patch.categoryId !== undefined && patch.categoryId !== current.categoryId) {
      // It goes last among the feeds it joins.
      db.prepare("UPDATE feeds SET position = ? WHERE id = ?").run(lastPosition(db, patch.categoryId) + 1, id);
      setFeedCategory(db, id, patch.categoryId);
    }
  });
  return getFeed(db, id, clock());
}

/** Deletes the feed. Its articles, starred ones included, go with it (ON DELETE CASCADE). */
export function deleteFeed(db: Database, id: number): void {
  getFeed(db, id);
  db.prepare("DELETE FROM feeds WHERE id = ?").run(id);
}

/**
 * Moves the feeds of a category, and their articles, to no category. Called before the category is deleted.
 * Returns the ids of the feeds that moved, whose articles the filters judge again once the category is gone.
 */
export function releaseFeedsOfCategory(db: Database, categoryId: number): number[] {
  db.prepare("UPDATE articles SET category_id = NULL WHERE origin = 'feed' AND category_id = ?").run(categoryId);
  return db
    .prepare("UPDATE feeds SET category_id = NULL WHERE category_id = ? RETURNING id")
    .all(categoryId)
    .map((row) => num(row.id));
}

export interface FetchSuccess {
  now: string;
  /** Values to send with the next request, so that an unchanged feed answers without a body. */
  etag?: string | null;
  lastModified?: string | null;
  /** The feed's own title and site, taken unless the user named the feed. */
  title?: string;
  siteUrl?: string | null;
}

export function recordFetchSuccess(db: Database, id: number, result: FetchSuccess): void {
  db.prepare(
    `UPDATE feeds
        SET last_fetched_at = ?, last_succeeded_at = ?, last_error = NULL, failure_count = 0,
            etag = CASE WHEN ? THEN ? ELSE etag END,
            last_modified = CASE WHEN ? THEN ? ELSE last_modified END,
            title = CASE WHEN title_set_by_user = 0 AND ? <> '' THEN ? ELSE title END,
            site_url = coalesce(?, site_url)
      WHERE id = ?`,
  ).run(
    result.now,
    result.now,
    result.etag !== undefined ? 1 : 0,
    result.etag ?? null,
    result.lastModified !== undefined ? 1 : 0,
    result.lastModified ?? null,
    result.title ?? "",
    result.title ?? "",
    result.siteUrl ?? null,
    id,
  );
}

export function recordFetchFailure(db: Database, id: number, result: { now: string; error: string }): void {
  db.prepare("UPDATE feeds SET last_fetched_at = ?, last_error = ?, failure_count = failure_count + 1 WHERE id = ?").run(
    result.now,
    result.error.slice(0, 500),
    id,
  );
}

/** Forgets the items a feed has not listed since the given time. Their articles are purged by then. */
export function deleteSeenItemsBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM feed_items_seen WHERE last_seen_at < ?").run(before).changes);
}

/** What the next request sends to learn whether the feed changed. */
export function fetchConditions(db: Database, id: number): { etag: string | null; lastModified: string | null } {
  const row = db.prepare("SELECT etag, last_modified FROM feeds WHERE id = ?").get(id);
  return { etag: strOrNull(row?.etag), lastModified: strOrNull(row?.last_modified) };
}
