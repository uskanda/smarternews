import type { Feed, FeedUpdate } from "../api.ts";
import type { Clock } from "../clock.ts";
import { DomainError, notFound } from "../errors.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { findCategory } from "./categories.ts";
import { transaction, type Database } from "./database.ts";
import { bool, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";
import { getSettings } from "./settings.ts";

const MINUTE = 60_000;
const MAX_WAIT_MS = 24 * 60 * MINUTE;

/** Feed articles without a star are kept this long, counted from the time they sort by. */
export const FEED_RETENTION_DAYS = 90;

/** A bound against a mistaken import, not a setting. */
export const MAX_FEEDS = 500;

const FEED_COLUMNS = `f.*,
  (SELECT count(*) FROM articles a WHERE a.feed_id = f.id) AS article_count,
  (SELECT count(*) FROM articles a WHERE a.feed_id = f.id AND a.starred = 1) AS starred_count`;

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

function toFeed(row: Row, baseMinutes: number): Feed {
  const enabled = bool(row.enabled);
  return {
    id: num(row.id),
    url: str(row.url),
    title: str(row.title),
    siteUrl: strOrNull(row.site_url),
    categoryId: numOrNull(row.category_id),
    intervalMinutes: numOrNull(row.interval_minutes),
    enabled,
    lastFetchedAt: strOrNull(row.last_fetched_at),
    lastSucceededAt: strOrNull(row.last_succeeded_at),
    lastError: strOrNull(row.last_error),
    failureCount: num(row.failure_count),
    nextFetchAt: enabled ? nextFetchFrom(row, baseMinutes).toISOString() : null,
    articleCount: num(row.article_count),
    starredCount: num(row.starred_count),
    createdAt: str(row.created_at),
  };
}

export function listFeeds(db: Database): Feed[] {
  const base = getSettings(db).feedIntervalMinutes;
  return db
    .prepare(`SELECT ${FEED_COLUMNS} FROM feeds f ORDER BY f.id`)
    .all()
    .map((row) => toFeed(row, base));
}

export function findFeed(db: Database, id: number): Feed | null {
  const row = db.prepare(`SELECT ${FEED_COLUMNS} FROM feeds f WHERE f.id = ?`).get(id);
  return row ? toFeed(row, getSettings(db).feedIntervalMinutes) : null;
}

export function getFeed(db: Database, id: number): Feed {
  const feed = findFeed(db, id);
  if (!feed) throw notFound("feed", id);
  return feed;
}

export function findFeedByUrl(db: Database, url: string): Feed | null {
  const row = db.prepare("SELECT id FROM feeds WHERE url = ?").get(normalizeUrl(url));
  return row ? getFeed(db, num(row.id)) : null;
}

/** When the feed is fetched next, whether or not it is enabled. */
export function nextFetchAt(db: Database, feed: Feed): Date {
  const row = db.prepare("SELECT * FROM feeds WHERE id = ?").get(feed.id)!;
  return nextFetchFrom(row, getSettings(db).feedIntervalMinutes);
}

/** The enabled feeds whose wait is over, the longest overdue first. */
export function dueFeeds(db: Database, now: Date): Feed[] {
  return listFeeds(db)
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

export interface NewFeed {
  url: string;
  title: string;
  /** True when the user chose the title; the feed's own title then never replaces it. */
  titleSetByUser?: boolean;
  siteUrl?: string | null;
  categoryId?: number | null;
  intervalMinutes?: number | null;
  enabled?: boolean;
}

/** Stores a feed without fetching it. Refuses a URL that is already subscribed. */
export function insertFeed(db: Database, input: NewFeed, clock: Clock): Feed {
  const url = normalizeUrl(input.url);
  if (db.prepare("SELECT 1 FROM feeds WHERE url = ?").get(url)) {
    throw new DomainError("conflict", `already subscribed: ${url}`, [{ path: "url", message: "already subscribed" }]);
  }
  checkFeedCategory(db, input.categoryId);
  if (num(db.prepare("SELECT count(*) AS n FROM feeds").get()!.n) >= MAX_FEEDS) {
    throw new DomainError("conflict", `at most ${MAX_FEEDS} feeds can be subscribed`);
  }
  const result = db
    .prepare(
      `INSERT INTO feeds (url, title, title_set_by_user, site_url, category_id, interval_minutes, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      url,
      input.title,
      input.titleSetByUser ? 1 : 0,
      input.siteUrl ?? null,
      input.categoryId ?? null,
      input.intervalMinutes ?? null,
      (input.enabled ?? true) ? 1 : 0,
      clock().toISOString(),
    );
  return getFeed(db, num(result.lastInsertRowid));
}

export function updateFeed(db: Database, id: number, patch: FeedUpdate): Feed {
  const current = getFeed(db, id);
  if (patch.categoryId !== undefined) checkFeedCategory(db, patch.categoryId);
  transaction(db, () => {
    if (patch.title !== undefined) db.prepare("UPDATE feeds SET title = ?, title_set_by_user = 1 WHERE id = ?").run(patch.title, id);
    if (patch.intervalMinutes !== undefined) db.prepare("UPDATE feeds SET interval_minutes = ? WHERE id = ?").run(patch.intervalMinutes, id);
    if (patch.enabled !== undefined) db.prepare("UPDATE feeds SET enabled = ? WHERE id = ?").run(patch.enabled ? 1 : 0, id);
    if (patch.categoryId !== undefined && patch.categoryId !== current.categoryId) {
      db.prepare("UPDATE feeds SET category_id = ? WHERE id = ?").run(patch.categoryId, id);
      // Articles carry their feed's category, so that lists and counts by category need no join.
      db.prepare("UPDATE articles SET category_id = ? WHERE feed_id = ?").run(patch.categoryId, id);
    }
  });
  return getFeed(db, id);
}

/** Deletes the feed. Its articles, starred ones included, go with it (ON DELETE CASCADE). */
export function deleteFeed(db: Database, id: number): void {
  getFeed(db, id);
  db.prepare("DELETE FROM feeds WHERE id = ?").run(id);
}

/** Moves the feeds of a category, and their articles, to no category. Called before the category is deleted. */
export function releaseFeedsOfCategory(db: Database, categoryId: number): void {
  db.prepare("UPDATE articles SET category_id = NULL WHERE origin = 'feed' AND category_id = ?").run(categoryId);
  db.prepare("UPDATE feeds SET category_id = NULL WHERE category_id = ?").run(categoryId);
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
