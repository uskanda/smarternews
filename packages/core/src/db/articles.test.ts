import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import {
  deleteUnstarredArticlesBefore,
  findEventByKey,
  insertArticle,
  listFeedArticles,
  openEventArticles,
  recentNewsArticles,
  type ArticleContent,
} from "./articles.ts";
import { createCategory } from "./categories.ts";
import type { Database } from "./database.ts";

const NOW = "2026-03-01T12:00:00.000Z";

function generated(db: Database, categoryId: number, overrides: Partial<ArticleContent> = {}, now = NOW): number {
  return insertArticle(db, {
    categoryId,
    kind: overrides.event ? "event" : "news",
    title: "Generated",
    summary: "s",
    body: "b",
    impact: null,
    importance: 3,
    unconfirmed: false,
    snippetOnly: false,
    event: null,
    ...overrides,
    now,
    previousArticleId: null,
    refs: [],
    topicIds: [],
  });
}

describe("what only generated articles take part in", () => {
  it("leaves feed articles out of the follow-up lookup", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW));
    const article = generated(db, category.id);
    seedFeedArticle(db, seedFeed(db, { categoryId: category.id }), { at: NOW });

    expect(recentNewsArticles(db, category.id, "2026-02-01T00:00:00.000Z").map((entry) => entry.id)).toEqual([article]);
    expect(openEventArticles(db, category.id, NOW)).toEqual([]);
    expect(findEventByKey(db, category.id, "anything")).toBeNull();
  });

  it("leaves feed articles out of the RSS output, per category and overall", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW));
    const article = generated(db, category.id);
    seedFeedArticle(db, seedFeed(db, { categoryId: category.id }), { at: NOW });
    seedFeedArticle(db, seedFeed(db), { at: NOW });

    expect(listFeedArticles(db, { categoryId: category.id, now: NOW, limit: 50 }).map((entry) => entry.id)).toEqual([article]);
    expect(listFeedArticles(db, { categoryId: null, now: NOW, limit: 50 }).map((entry) => entry.id)).toEqual([article]);
  });

  it("purges only generated articles by the 180-day rule", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW));
    generated(db, category.id, {}, "2025-01-01T00:00:00.000Z");
    const feedArticle = seedFeedArticle(db, seedFeed(db, { categoryId: category.id }), { at: "2025-01-01T00:00:00.000Z" });

    expect(deleteUnstarredArticlesBefore(db, "2026-01-01T00:00:00.000Z")).toBe(1);
    expect(db.prepare("SELECT id FROM articles").all()).toEqual([{ id: feedArticle }]);
  });
});
