import type { Clock } from "../clock.ts";
import { migrate, openDatabase, type Database } from "../db/database.ts";

export function createTestDb(): Database {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

/** A clock the test moves by hand. */
export function fakeClock(start: string): Clock & { set(iso: string): void; advance(ms: number): void } {
  let now = new Date(start).getTime();
  const clock = (() => new Date(now)) as Clock & { set(iso: string): void; advance(ms: number): void };
  clock.set = (iso) => {
    now = new Date(iso).getTime();
  };
  clock.advance = (ms) => {
    now += ms;
  };
  return clock;
}

let feedSerial = 0;

/** Stores a subscribed feed row directly, for tests that are not about fetching. Returns its id. */
export function seedFeed(db: Database, options: { categoryId?: number | null; url?: string; title?: string; at?: string } = {}): number {
  feedSerial += 1;
  const at = options.at ?? "2026-03-01T00:00:00.000Z";
  const result = db
    .prepare("INSERT INTO feeds (url, title, category_id, created_at) VALUES (?, ?, ?, ?)")
    .run(options.url ?? `https://feeds.example.org/${feedSerial}.xml`, options.title ?? `Feed ${feedSerial}`, options.categoryId ?? null, at);
  return Number(result.lastInsertRowid);
}

/** Stores a feed article directly. The category is copied from the feed, as the real code does. */
export function seedFeedArticle(
  db: Database,
  feedId: number,
  options: { title?: string; body?: string; at?: string; isRead?: boolean; starred?: boolean; key?: string; author?: string; url?: string } = {},
): number {
  feedSerial += 1;
  const at = options.at ?? "2026-03-01T00:00:00.000Z";
  const feed = db.prepare("SELECT category_id FROM feeds WHERE id = ?").get(feedId)!;
  const title = options.title ?? `Feed article ${feedSerial}`;
  const body = options.body ?? `Content ${feedSerial}`;
  const result = db
    .prepare(
      `INSERT INTO articles (category_id, origin, feed_id, item_key, kind, title, summary, body, content_text, author, first_published_at, updated_at, is_read, starred)
       VALUES (?, 'feed', ?, ?, 'news', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(feed.category_id as number | null, feedId, options.key ?? `key-${feedSerial}`, title, body, body, body, options.author ?? null, at, at, options.isRead ? 1 : 0, options.starred ? 1 : 0);
  const id = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO article_refs (article_id, url, site_name, title, position) VALUES (?, ?, '', ?, 0)").run(id, options.url ?? `https://site.example.org/${feedSerial}`, title);
  return id;
}
