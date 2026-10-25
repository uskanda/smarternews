// Fetching a subscribed feed and storing what it delivers as feed articles. No model is involved anywhere
// here: the items are stored as they come, with their content rewritten as Markdown. The titles of a feed
// that translates go to the translation API after they are stored, and to nothing else.
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
import { applyFilters } from "../db/filters.ts";
import { deleteArticleTranslation } from "../db/translations.ts";
import { DomainError } from "../errors.ts";
import type { Fetcher } from "../fetch/http.ts";
import { normalizeTitle, normalizeUrl } from "../fetch/url.ts";
import { parseSubscription, type ParsedSubscription, type SubscriptionItem } from "../sources/feed.ts";
import type { TranslationService } from "../translation/service.ts";
import { convertContent } from "./content.ts";

const DAY = 86_400_000;
const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";
const SUMMARY_CHARS = 300;
const KEY_CHARS = 500;
/** A feed article is compared with what other feeds delivered within this many days. */
export const DUPLICATE_WINDOW_DAYS = 7;

/** A bound against a feed that lists items without end, not a setting. */
export const MAX_NEW_ITEMS = 200;

export interface FeedDeps {
  db: Database;
  clock: Clock;
  fetcher: Fetcher;
  /** Translates the titles of what a feed that translates delivers. Without it nothing is translated. */
  translation?: TranslationService;
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

interface Stored {
  /** Articles added. */
  created: number;
  /**
   * The articles whose title is new or was rewritten: the ones a feed that translates has translated.
   * Duplicates that are hidden are left out; their title is translated when they are opened.
   */
  titled: number[];
}

/**
 * The article kept for a new one of the feed, when another feed delivered the same page or title within
 * `DUPLICATE_WINDOW_DAYS`: of the articles kept for those matches, the one stored first. Articles stored
 * before duplicate removal existed have neither value and match nothing.
 */
function findKept(db: Database, feedId: number, values: { url: string | null; title: string | null }, since: string): number | null {
  if (values.url === null && values.title === null) return null;
  const row = db
    .prepare(
      `SELECT k.id FROM articles a JOIN articles k ON k.id = coalesce(a.duplicate_of, a.id)
        WHERE a.origin = 'feed' AND a.feed_id <> ? AND a.created_at >= ? AND (a.dedup_url = ? OR a.dedup_title = ?)
        ORDER BY k.created_at, k.id LIMIT 1`,
    )
    .get(feedId, since, values.url, values.title);
  return row ? num(row.id) : null;
}

/**
 * Stores the items of a fetched document. New items become unread articles; a known item whose title or
 * content changed is rewritten in place, read or unread as it was, and loses the translation of what
 * changed. The caller wraps this in a transaction.
 */
function storeItems(db: Database, feed: Feed, parsed: ParsedSubscription, now: Date): Stored {
  const { outputLanguage: language, removeDuplicates } = getSettings(db);
  const duplicatesSince = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * DAY).toISOString();
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
        `SELECT a.id, a.item_key, a.title, a.body, a.author, a.duplicate_of, a.dedup_url, a.dedup_title, a.full_content_status,
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

  const forgetTitle = db.prepare("UPDATE articles SET translated_title = NULL WHERE id = ?");
  // Only an article stored since duplicate removal exists has values to compare, and keeps having them.
  const recompare = db.prepare("UPDATE articles SET dedup_url = ?, dedup_title = ? WHERE id = ? AND (dedup_url IS NOT NULL OR dedup_title IS NOT NULL)");
  const titled: number[] = [];

  const inDocument = new Set<string>();
  const fresh: Prepared[] = [];
  let foundNew = false;
  for (const item of parsed.items) {
    const url = pageUrl(item, feed.url);
    const key = (item.key ?? url)?.slice(0, KEY_CHARS);
    if (!key || inDocument.has(key)) continue;
    inDocument.add(key);
    markSeen.run(feed.id, key, nowIso);

    const known = stored.get(key);
    // The feed never listed it: new, whether or not it is stored as an article below.
    if (!known && !seenBefore.has(key)) foundNew = true;
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
    const rewritten = str(known.title) !== title || str(known.body) !== prepared.body || (known.author ?? null) !== prepared.author;
    if (rewritten) {
      rewrite.run(title, summaryOf(prepared.text), prepared.body, prepared.text, prepared.author, id);
      // A translation of what was rewritten no longer says what the article says.
      if (str(known.title) !== title) {
        forgetTitle.run(id);
        // A hidden duplicate is not judged again, and its title waits until it is opened.
        if (!(removeDuplicates && known.duplicate_of !== null)) titled.push(id);
      }
      // The full content is what was translated when the article has one; it stays as it was.
      if (str(known.body) !== prepared.body && known.full_content_status !== "fetched") deleteArticleTranslation(db, id);
    }
    const moved = (known.url ?? null) !== url;
    if (moved || str(known.title) !== title) {
      setReference(db, id, url, feedTitle, title);
      // What comes later is compared with what the article says now.
      recompare.run(url, normalizeTitle(title), id);
    }
    // Matched after the reference is set: a condition may look at the URL.
    if (rewritten || moved) applyFilters(db, id);
  }

  const insert = db.prepare(
    `INSERT INTO articles
       (category_id, origin, feed_id, item_key, kind, title, summary, body, content_text, author, first_published_at, updated_at,
        created_at, dedup_url, dedup_title, duplicate_of)
     VALUES (?, 'feed', ?, ?, 'news', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Lists show the highest id first among articles of the same time, so the first item of the document goes in last.
  for (const item of fresh.reverse()) {
    // An item sorts by when it was published; one without a date, or dated in the future, by when it was fetched.
    const at = item.publishedAt && item.publishedAt <= now ? item.publishedAt.toISOString() : nowIso;
    // Judged once, here, before the title is translated and before the summaries look for work.
    const compared = { url: item.url, title: normalizeTitle(item.title) };
    const kept = removeDuplicates ? findKept(db, feed.id, compared, duplicatesSince) : null;
    const id = num(
      insert.run(
        feed.categoryId,
        feed.id,
        item.key,
        item.title,
        summaryOf(item.text),
        item.body,
        item.text,
        item.author,
        at,
        at,
        nowIso,
        compared.url,
        compared.title,
        kept,
      ).lastInsertRowid,
    );
    setReference(db, id, item.url, feedTitle, item.title);
    applyFilters(db, id);
    if (kept === null) titled.push(id);
  }
  // What tells a feed that stopped delivering from one that delivers what is too old to store.
  if (foundNew) db.prepare("UPDATE feeds SET last_new_item_at = ? WHERE id = ?").run(nowIso, feed.id);
  return { created: fresh.length, titled: feed.translate ? titled : [] };
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
    const stored = transaction(db, () => {
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
    // After the articles are stored, and never failing the fetch: an article without a translated title is
    // translated when it is opened.
    if (stored.titled.length > 0) await deps.translation?.translateTitles(stored.titled);
    return { status: "updated", created: stored.created };
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
  const stored = transaction(db, () => {
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
        translate: input.translate,
        fetchFullContent: input.fetchFullContent,
      },
      clock,
    );
    const { titled } = storeItems(db, feed, result.parsed, now);
    recordFetchSuccess(db, feed.id, { now: now.toISOString(), etag: result.etag, lastModified: result.lastModified, siteUrl: result.parsed.siteUrl });
    return { feed: getFeed(db, feed.id, now), titled };
  });
  if (stored.titled.length > 0) await deps.translation?.translateTitles(stored.titled);
  return stored.feed;
}
