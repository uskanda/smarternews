// Fetching a subscribed feed and storing what it delivers as feed articles. No model is involved anywhere
// here: the items are stored as they come, with their content rewritten as Markdown.
import type { Feed, FeedCreate } from "../api.ts";
import type { Clock } from "../clock.ts";
import { transaction, type Database } from "../db/database.ts";
import {
  checkFeedCategory,
  FEED_RETENTION_DAYS,
  fetchConditions,
  findFeed,
  findFeedByUrl,
  getFeed,
  insertFeed,
  recordFetchFailure,
  recordFetchSuccess,
} from "../db/feeds.ts";
import { num, str } from "../db/rows.ts";
import { getSettings } from "../db/settings.ts";
import { applyStopWords } from "../db/stop-words.ts";
import { DomainError } from "../errors.ts";
import type { Fetcher } from "../fetch/http.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { parseSubscription, type ParsedSubscription, type SubscriptionItem } from "../sources/feed.ts";
import { convertContent } from "./content.ts";

const DAY = 86_400_000;
const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";
const SUMMARY_CHARS = 300;
const KEY_CHARS = 500;

/** A bound against a feed that lists items without end, not a setting. */
export const MAX_NEW_ITEMS = 200;

export interface FeedDeps {
  db: Database;
  clock: Clock;
  fetcher: Fetcher;
}

export interface FetchOutcome {
  status: "updated" | "not_modified" | "failed";
  /** Articles added by this fetch. */
  created: number;
  error?: string;
}

function summaryOf(text: string): string {
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS - 1).trimEnd()}…` : text;
}

/** The item's page as an absolute web address, or null when it has none. */
function pageUrl(item: SubscriptionItem, feedUrl: string): string | null {
  if (item.url.length === 0) return null;
  try {
    const url = new URL(item.url, feedUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? normalizeUrl(url.toString()) : null;
  } catch {
    return null;
  }
}

interface Prepared {
  key: string;
  url: string | null;
  title: string;
  author: string | null;
  body: string;
  text: string;
  publishedAt: Date | null;
}

function setReference(db: Database, articleId: number, url: string | null, feedTitle: string, title: string): void {
  db.prepare("DELETE FROM article_refs WHERE article_id = ?").run(articleId);
  if (url === null) return;
  db.prepare("INSERT INTO article_refs (article_id, url, site_name, title, position) VALUES (?, ?, ?, ?, 0)").run(articleId, url, feedTitle, title);
}

/**
 * Stores the items of a fetched document. New items become unread articles; a known item whose title or
 * content changed is rewritten in place, read or unread as it was. Returns how many articles were added.
 * The caller wraps this in a transaction.
 */
function storeItems(db: Database, feed: Feed, parsed: ParsedSubscription, now: Date): number {
  const language = getSettings(db).outputLanguage;
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - FEED_RETENTION_DAYS * DAY);
  const feedTitle = feed.title;

  const seenBefore = new Set(
    db
      .prepare("SELECT item_key FROM feed_items_seen WHERE feed_id = ?")
      .all(feed.id)
      .map((row) => str(row.item_key)),
  );
  const stored = new Map(
    db
      .prepare(
        `SELECT a.id, a.item_key, a.title, a.body, a.author,
                (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS url
           FROM articles a WHERE a.feed_id = ?`,
      )
      .all(feed.id)
      .map((row) => [str(row.item_key), row] as const),
  );
  const markSeen = db.prepare(
    `INSERT INTO feed_items_seen (feed_id, item_key, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT (feed_id, item_key) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  );
  const rewrite = db.prepare("UPDATE articles SET title = ?, summary = ?, body = ?, content_text = ?, author = ? WHERE id = ?");

  const inDocument = new Set<string>();
  const fresh: Prepared[] = [];
  for (const item of parsed.items) {
    const url = pageUrl(item, feed.url);
    const key = (item.key ?? url)?.slice(0, KEY_CHARS);
    if (!key || inDocument.has(key)) continue;
    inDocument.add(key);
    markSeen.run(feed.id, key, nowIso);

    const known = stored.get(key);
    // An item whose article was purged is still listed by the feed; it must not come back as new.
    if (!known && seenBefore.has(key)) continue;
    if (!known && item.publishedAt && item.publishedAt < cutoff) continue;
    if (!known && fresh.length >= MAX_NEW_ITEMS) continue;

    const content = convertContent(item.contentHtml, url ?? feed.url, language);
    const title = item.title || summaryOf(content.text).slice(0, 80) || url || "";
    if (title.length === 0) continue;
    const prepared: Prepared = { key, url, title, author: item.author, body: content.markdown, text: content.text, publishedAt: item.publishedAt };
    if (!known) {
      fresh.push(prepared);
      continue;
    }
    const id = num(known.id);
    if (str(known.title) !== title || str(known.body) !== prepared.body || (known.author ?? null) !== prepared.author) {
      rewrite.run(title, summaryOf(prepared.text), prepared.body, prepared.text, prepared.author, id);
      applyStopWords(db, id);
    }
    if ((known.url ?? null) !== url || str(known.title) !== title) setReference(db, id, url, feedTitle, title);
  }

  const insert = db.prepare(
    `INSERT INTO articles
       (category_id, origin, feed_id, item_key, kind, title, summary, body, content_text, author, first_published_at, updated_at,
        created_at)
     VALUES (?, 'feed', ?, ?, 'news', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Lists show the highest id first among articles of the same time, so the first item of the document goes in last.
  for (const item of fresh.reverse()) {
    // An item sorts by when it was published; one without a date, or dated in the future, by when it was fetched.
    const at = item.publishedAt && item.publishedAt <= now ? item.publishedAt.toISOString() : nowIso;
    const id = num(
      insert.run(feed.categoryId, feed.id, item.key, item.title, summaryOf(item.text), item.body, item.text, item.author, at, at, nowIso).lastInsertRowid,
    );
    setReference(db, id, item.url, feedTitle, item.title);
    applyStopWords(db, id);
  }
  return fresh.length;
}

async function download(deps: FeedDeps, url: string, conditions: { etag: string | null; lastModified: string | null }) {
  const headers: Record<string, string> = { accept: FEED_ACCEPT };
  if (conditions.etag) headers["if-none-match"] = conditions.etag;
  if (conditions.lastModified) headers["if-modified-since"] = conditions.lastModified;
  const response = await deps.fetcher.get(url, { headers });
  if (response.status === 304) return null;
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP status ${response.status}: ${url}`);
  return { parsed: parseSubscription(response.text), etag: response.headers.etag ?? null, lastModified: response.headers["last-modified"] ?? null };
}

/** Fetches one subscribed feed and stores what is new. A failure is recorded on the feed, never thrown. */
export async function fetchFeed(deps: FeedDeps, feedId: number): Promise<FetchOutcome> {
  const { db, clock } = deps;
  const feed = getFeed(db, feedId);
  try {
    const result = await download(deps, feed.url, fetchConditions(db, feedId));
    const now = clock();
    // The feed may have been deleted while the request was under way.
    if (!findFeed(db, feedId)) return { status: "failed", created: 0, error: "the feed was deleted" };
    if (result === null) {
      recordFetchSuccess(db, feedId, { now: now.toISOString() });
      return { status: "not_modified", created: 0 };
    }
    const created = transaction(db, () => {
      // Read again inside the transaction: the category may have changed since the request started.
      const count = storeItems(db, getFeed(db, feedId), result.parsed, now);
      recordFetchSuccess(db, feedId, {
        now: now.toISOString(),
        etag: result.etag,
        lastModified: result.lastModified,
        title: result.parsed.title,
        siteUrl: result.parsed.siteUrl,
      });
      return count;
    });
    return { status: "updated", created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (findFeed(db, feedId)) recordFetchFailure(db, feedId, { now: clock().toISOString(), error: message });
    return { status: "failed", created: 0, error: message };
  }
}

function refuse(message: string): DomainError {
  return new DomainError("invalid", message, [{ path: "url", message }]);
}

/**
 * Subscribes to a feed: fetches the URL once, and stores the feed only when the answer is a feed. Every
 * item it delivers now becomes an unread article.
 */
export async function subscribe(deps: FeedDeps, input: FeedCreate): Promise<Feed> {
  const { db, clock } = deps;
  const url = normalizeUrl(input.url);
  if (findFeedByUrl(db, url)) throw new DomainError("conflict", `already subscribed: ${url}`, [{ path: "url", message: "already subscribed" }]);
  checkFeedCategory(db, input.categoryId);

  let result: NonNullable<Awaited<ReturnType<typeof download>>>;
  try {
    result = (await download(deps, url, { etag: null, lastModified: null }))!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw refuse(/not a feed/.test(message) ? `the document at ${url} is not a feed` : `the feed could not be fetched: ${message}`);
  }
  const now = clock();
  return transaction(db, () => {
    const feed = insertFeed(
      db,
      {
        url,
        title: input.title ?? (result.parsed.title || new URL(url).host),
        titleSetByUser: input.title !== undefined,
        siteUrl: result.parsed.siteUrl,
        categoryId: input.categoryId,
        intervalMinutes: input.intervalMinutes,
        enabled: input.enabled,
        autoSummarize: input.autoSummarize,
      },
      clock,
    );
    storeItems(db, feed, result.parsed, now);
    recordFetchSuccess(db, feed.id, { now: now.toISOString(), etag: result.etag, lastModified: result.lastModified, siteUrl: result.parsed.siteUrl });
    return getFeed(db, feed.id);
  });
}
