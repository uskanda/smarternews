import { describe, expect, it } from "vitest";
import { createTestDb, seedFeed, seedFeedArticle } from "../testing/db.ts";
import type { Database } from "./database.ts";
import { insertFeed } from "./feeds.ts";
import { feedRelevanceScores, refreshFeedScores } from "./relevance.ts";
import { num } from "./rows.ts";

const NOW = new Date("2026-03-31T12:00:00.000Z");
const RECENT = "2026-03-20T00:00:00.000Z";
const LONG_AGO = "2026-02-01T00:00:00.000Z";

/** Stores `total` recent articles of the feed, the first `opened` of them opened and the next `starred` starred. */
function articles(db: Database, feedId: number, total: number, opened = 0, starred = 0): number[] {
  const ids: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const id = seedFeedArticle(db, feedId, { at: RECENT, starred: index >= opened && index < opened + starred });
    if (index < opened) db.prepare("UPDATE articles SET opened_at = ? WHERE id = ?").run(RECENT, id);
    ids.push(id);
  }
  return ids;
}

const scoreOf = (db: Database, feedId: number) => num(db.prepare("SELECT relevance_score FROM feeds WHERE id = ?").get(feedId)!.relevance_score);
const articleScores = (db: Database, ids: number[]) =>
  ids.map((id) => num(db.prepare("SELECT feed_score FROM articles WHERE id = ?").get(id)!.feed_score));

describe("the behaviour score of feeds", () => {
  it("compares how often the recent articles of each feed are opened or starred, the highest feed being 1", () => {
    const db = createTestDb();
    const x = seedFeed(db);
    const y = seedFeed(db);
    articles(db, x, 20, 6, 4);
    articles(db, y, 20, 5);

    const { scores } = feedRelevanceScores(db, NOW);
    expect(scores.get(x)).toBe(1);
    expect(scores.get(y)).toBe(0.5);
  });

  it("gives a feed with fewer than ten recent articles the average of the others, and a new feed the same", () => {
    const db = createTestDb();
    const x = seedFeed(db);
    const y = seedFeed(db);
    const z = seedFeed(db);
    articles(db, x, 20, 10);
    articles(db, y, 20, 5);
    articles(db, z, 3, 3);

    const { scores, fallback } = feedRelevanceScores(db, NOW);
    expect(scores.get(z)).toBe(0.75);
    expect(fallback).toBe(0.75);
  });

  it("is 0 everywhere without a record, and without a feed of ten recent articles", () => {
    const db = createTestDb();
    const x = seedFeed(db);
    const y = seedFeed(db);
    articles(db, x, 20);
    articles(db, y, 5, 5);

    const { scores, fallback } = feedRelevanceScores(db, NOW);
    expect(scores.get(x)).toBe(0);
    expect(scores.get(y)).toBe(0);
    expect(fallback).toBe(0);
  });

  it("counts only the articles of the last 30 days that the reader can see", () => {
    const db = createTestDb();
    const x = seedFeed(db);
    const y = seedFeed(db);
    articles(db, x, 10, 5);
    articles(db, y, 10, 10);
    // Old articles opened, and hidden ones never opened, change nothing.
    for (let index = 0; index < 10; index += 1) {
      const id = seedFeedArticle(db, x, { at: LONG_AGO });
      db.prepare("UPDATE articles SET opened_at = ? WHERE id = ?").run(LONG_AGO, id);
      const hidden = seedFeedArticle(db, y, { at: RECENT });
      db.prepare("UPDATE articles SET filtered = 1 WHERE id = ?").run(hidden);
    }

    const { scores } = feedRelevanceScores(db, NOW);
    expect(scores.get(x)).toBe(0.5);
    expect(scores.get(y)).toBe(1);
  });

  it("gives a feed subscribed now the average of the others, and changes no other score", () => {
    const db = createTestDb();
    const x = seedFeed(db);
    const y = seedFeed(db);
    articles(db, x, 10, 10);
    articles(db, y, 10, 5);

    const feed = insertFeed(db, { url: "https://new.example.org/feed.xml", title: "New" }, () => NOW);
    expect(scoreOf(db, feed.id)).toBe(0.75);
    expect([scoreOf(db, x), scoreOf(db, y)]).toEqual([0, 0]);
  });

  it("stores each score on the feed and on every article of it, old ones too", () => {
    const db = createTestDb();
    const x = seedFeed(db);
    const y = seedFeed(db);
    const xs = articles(db, x, 10, 10);
    const ys = articles(db, y, 10, 5);
    const old = seedFeedArticle(db, y, { at: LONG_AGO });

    refreshFeedScores(db, NOW);
    expect(scoreOf(db, x)).toBe(1);
    expect(scoreOf(db, y)).toBe(0.5);
    expect(articleScores(db, [xs[0]!, ys[0]!, old])).toEqual([1, 0.5, 0.5]);
  });
});
