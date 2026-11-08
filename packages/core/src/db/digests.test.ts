import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { insertArticle, reviseArticle } from "./articles.ts";
import { createCategory, updateCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { DIGEST_MAX_ARTICLES, digestArticles, digestPeriodStart, getDigest, listDigests, saveDigest } from "./digests.ts";
import { createFilter } from "./filters.ts";

const NOW = "2026-03-01T07:00:00.000Z";
const clock = fakeClock(NOW);

function generated(db: Database, categoryId: number, options: { importance?: number; at?: string; title?: string } = {}): number {
  return insertArticle(db, {
    categoryId,
    kind: "news",
    title: options.title ?? "Generated",
    summary: "The summary.",
    body: "b",
    impact: null,
    importance: options.importance ?? 3,
    unconfirmed: false,
    snippetOnly: false,
    event: null,
    now: options.at ?? "2026-03-01T06:00:00.000Z",
    previousArticleId: null,
    refs: [],
    topicIds: [],
  });
}

function store(db: Database, periodEnd: string, overrides: Partial<Parameters<typeof saveDigest>[1]> = {}): number {
  return saveDigest(db, {
    periodStart: "2026-02-28T19:00:00.000Z",
    periodEnd,
    createdAt: periodEnd,
    trigger: "schedule",
    slot: null,
    executiveSummary: "Summary.",
    sections: [],
    articleCount: 1,
    ...overrides,
  });
}

const period = { start: "2026-02-28T19:00:00.000Z", end: NOW };

describe("the period of a digest", () => {
  it("starts where the last digest ended", () => {
    const db = createTestDb();
    store(db, "2026-02-28T19:00:00.000Z");
    store(db, "2026-02-28T07:00:00.000Z");
    expect(digestPeriodStart(db, new Date(NOW)).toISOString()).toBe("2026-02-28T19:00:00.000Z");
  });

  it("starts a day back for the first digest, and when the last one is older than a day", () => {
    const db = createTestDb();
    expect(digestPeriodStart(db, new Date(NOW)).toISOString()).toBe("2026-02-28T07:00:00.000Z");
    store(db, "2026-02-25T07:00:00.000Z");
    expect(digestPeriodStart(db, new Date(NOW)).toISOString()).toBe("2026-02-28T07:00:00.000Z");
  });
});

describe("the articles a digest is made from", () => {
  it("takes generated articles made or revised in the period, by importance and then newest first", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tech", kind: "news" }, clock);
    const minor = generated(db, category.id, { importance: 2, at: "2026-03-01T06:00:00.000Z" });
    const major = generated(db, category.id, { importance: 5, at: "2026-03-01T01:00:00.000Z" });
    const newer = generated(db, category.id, { importance: 2, at: "2026-03-01T06:30:00.000Z" });
    generated(db, category.id, { importance: 5, at: "2026-02-28T18:00:00.000Z" });
    const revised = generated(db, category.id, { importance: 4, at: "2026-02-27T00:00:00.000Z" });
    reviseArticle(db, revised, {
      title: "Revised",
      summary: "Now more.",
      body: "b",
      impact: null,
      importance: 4,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: "2026-03-01T02:00:00.000Z",
      refs: [],
      topicIds: [],
    });

    const articles = digestArticles(db, period);
    expect(articles.map((article) => article.id)).toEqual([major, revised, newer, minor]);
    expect(articles[0]).toEqual({ id: major, categoryId: category.id, origin: "generated", title: "Generated", importance: 5, text: "The summary." });
  });

  it("takes feed articles stored in the period, newest first, without those that are hidden", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tech", kind: "news" }, clock);
    const feed = seedFeed(db, { categoryId: category.id });
    const older = seedFeedArticle(db, feed, { at: "2026-03-01T01:00:00.000Z", title: "Older" });
    const newer = seedFeedArticle(db, feed, { at: "2026-03-01T05:00:00.000Z", title: "Newer" });
    seedFeedArticle(db, feed, { at: "2026-03-01T04:00:00.000Z", title: "Hidden by a filter" });
    seedFeedArticle(db, feed, { at: "2026-03-01T03:00:00.000Z", title: "A duplicate", duplicateOf: older });
    // Published long ago and delivered now: what counts is when it was stored.
    const late = seedFeedArticle(db, feed, { at: "2026-01-01T00:00:00.000Z", storedAt: "2026-03-01T06:00:00.000Z", title: "Late" });
    seedFeedArticle(db, feed, { at: "2026-02-28T12:00:00.000Z", title: "Before the period" });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "Hidden" }] }, clock);

    expect(digestArticles(db, period).map((article) => article.id)).toEqual([newer, older, late]);
  });

  it("gives of a feed article its translated title and its summary, or the first 300 characters of what was delivered", () => {
    const db = createTestDb();
    const feed = seedFeed(db, { categoryId: null });
    const plain = seedFeedArticle(db, feed, { at: "2026-03-01T05:00:00.000Z", title: "Plain", body: "x".repeat(2000) });
    const summarized = seedFeedArticle(db, feed, { at: "2026-03-01T04:00:00.000Z", title: "Original" });
    db.prepare("UPDATE articles SET auto_summary = 'Its summary.', translated_title = '訳したタイトル', full_content_text = 'The whole page.' WHERE id = ?").run(summarized);

    const [first, second] = digestArticles(db, period);
    expect(first).toEqual({ id: plain, categoryId: null, origin: "feed", title: "Plain", importance: null, text: "x".repeat(300) });
    expect(second).toMatchObject({ id: summarized, title: "訳したタイトル", text: "Its summary." });
  });

  it("leaves out the articles of a disabled category", () => {
    const db = createTestDb();
    const off = createCategory(db, { name: "Off", kind: "news" }, clock);
    generated(db, off.id);
    seedFeedArticle(db, seedFeed(db, { categoryId: off.id }), { at: "2026-03-01T05:00:00.000Z" });
    updateCategory(db, off.id, { enabled: false });
    expect(digestArticles(db, period)).toEqual([]);
  });

  it("takes at most 200 articles, the generated ones first", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tech", kind: "news" }, clock);
    const feed = seedFeed(db, { categoryId: category.id });
    for (let i = 0; i < 30; i += 1) generated(db, category.id);
    for (let i = 0; i < 400; i += 1) seedFeedArticle(db, feed, { at: new Date(Date.parse("2026-03-01T00:00:00.000Z") + i * 60_000).toISOString() });

    const articles = digestArticles(db, period);
    expect(articles).toHaveLength(DIGEST_MAX_ARTICLES);
    expect(articles.slice(0, 30).every((article) => article.origin === "generated")).toBe(true);
    // The newest 170 of the feed articles: the last stored is the first after the generated ones.
    expect(articles[30]!.id).toBeGreaterThan(articles[199]!.id);
  });
});

describe("stored digests", () => {
  it("are listed newest first, and one comes with the source articles that are still stored", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tech", kind: "news" }, clock);
    const kept = generated(db, category.id, { title: "Kept" });
    const feedArticle = seedFeedArticle(db, seedFeed(db, { categoryId: category.id }), { title: "Original" });
    db.prepare("UPDATE articles SET translated_title = '訳' WHERE id = ?").run(feedArticle);
    const morning = store(db, "2026-02-28T19:00:00.000Z");
    const evening = store(db, NOW, {
      sections: [{ categoryId: category.id, categoryName: "Tech", lines: [{ text: "One.", articleIds: [kept, 9999] }, { text: "Two.", articleIds: [feedArticle] }] }],
    });

    expect(listDigests(db).map((digest) => digest.id)).toEqual([evening, morning]);
    expect(listDigests(db, { limit: 1 })).toHaveLength(1);
    const digest = getDigest(db, evening);
    expect(digest.sections[0]!.lines[0]!.articleIds).toEqual([kept, 9999]);
    expect(digest.articles).toEqual([
      { id: kept, title: "Kept", origin: "generated" },
      { id: feedArticle, title: "訳", origin: "feed" },
    ]);
    expect(() => getDigest(db, 12345)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});
