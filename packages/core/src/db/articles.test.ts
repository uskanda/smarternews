import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import type { ArticleListQuery } from "../api.ts";
import {
  deleteUnstarredArticlesBefore,
  findEventByKey,
  getArticle,
  getCounts,
  insertArticle,
  listArticles,
  listFeedArticles,
  markArticlesRead,
  markArticlesUnread,
  nextArticleToSummarize,
  openEventArticles,
  recentNewsArticles,
  requestAutoSummary,
  saveAutoSummary,
  setArticleFlags,
  type ArticleContent,
} from "./articles.ts";
import { createCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { updateFeed } from "./feeds.ts";
import { updateSettings } from "./settings.ts";

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

describe("duplicates across feeds", () => {
  /**
   * Feed A (category X) keeps an article; feed B (category Y) and feed C (no category) delivered the same one,
   * recorded as its duplicates. B also has two articles of its own.
   */
  function withDuplicates() {
    const db = createTestDb();
    const clock = fakeClock(NOW);
    const x = createCategory(db, { name: "X", kind: "news" }, clock).id;
    const y = createCategory(db, { name: "Y", kind: "news" }, clock).id;
    const a = seedFeed(db, { categoryId: x, title: "Feed A" });
    const b = seedFeed(db, { categoryId: y, title: "Feed B" });
    const c = seedFeed(db, { title: "Feed C" });
    const kept = seedFeedArticle(db, a, { title: "Kept", at: "2026-03-01T01:00:00.000Z" });
    const copyB = seedFeedArticle(db, b, { title: "Copy in B", at: "2026-03-01T02:00:00.000Z", duplicateOf: kept });
    const copyC = seedFeedArticle(db, c, { title: "Copy in C", at: "2026-03-01T03:00:00.000Z", duplicateOf: kept });
    const ownB = [seedFeedArticle(db, b, { title: "B one" }), seedFeedArticle(db, b, { title: "B two" })];
    const titles = (query: ArticleListQuery = {}) => listArticles(db, query, NOW).items.map((article) => article.title);
    const isRead = (id: number) => getArticle(db, id).isRead;
    return { db, clock, x, y, a, b, c, kept, copyB, copyC, ownB, titles, isRead };
  }

  describe("in lists", () => {
    it("leaves duplicates out of the lists over everything, a category and no category", () => {
      const s = withDuplicates();
      expect(s.titles({ unread: "true" })).not.toContain("Copy in B");
      expect(s.titles()).toEqual(expect.arrayContaining(["Kept"]));
      expect(s.titles()).not.toEqual(expect.arrayContaining(["Copy in B"]));
      expect(s.titles({ category: s.y })).toEqual(["B one", "B two"].reverse());
      expect(s.titles({ uncategorized: "true" })).toEqual([]);
      expect(s.titles({ origin: "feed" })).not.toContain("Copy in C");
    });

    it("lists duplicates in the list of their own feed, and among the starred ones", () => {
      const s = withDuplicates();
      expect(s.titles({ feed: s.b, unread: "true" })).toHaveLength(3);
      expect(s.titles({ feed: s.b })).toContain("Copy in B");
      setArticleFlags(s.db, s.copyC, { starred: true });
      expect(s.titles({ starred: "true" })).toEqual(["Copy in C"]);
    });

    it("lists recorded duplicates while removal is off, and hides them again once it is on", () => {
      const s = withDuplicates();
      updateSettings(s.db, { removeDuplicates: false });
      expect(s.titles({ unread: "true" })).toEqual(expect.arrayContaining(["Kept", "Copy in B", "Copy in C"]));
      updateSettings(s.db, { removeDuplicates: true });
      expect(s.titles({ unread: "true" })).not.toEqual(expect.arrayContaining(["Copy in B"]));
      expect(s.titles({ unread: "true" })).not.toEqual(expect.arrayContaining(["Copy in C"]));
    });
  });

  describe("in counts", () => {
    it("leaves duplicates out of the totals, the categories and no category, and counts them for their feed", () => {
      const s = withDuplicates();
      const counts = getCounts(s.db, NOW);
      expect(counts.unread).toBe(3);
      expect(counts.categories.find((category) => category.categoryId === s.y)).toMatchObject({ unread: 2, total: 2 });
      expect(counts.categories.find((category) => category.categoryId === s.x)).toMatchObject({ unread: 1, total: 1 });
      expect(counts.uncategorizedUnread).toBe(0);
      expect(counts.feeds.find((feed) => feed.feedId === s.b)).toEqual({ feedId: s.b, unread: 3 });
      expect(counts.feeds.find((feed) => feed.feedId === s.c)).toEqual({ feedId: s.c, unread: 1 });
    });

    it("counts duplicates everywhere while removal is off", () => {
      const s = withDuplicates();
      updateSettings(s.db, { removeDuplicates: false });
      const counts = getCounts(s.db, NOW);
      expect(counts.unread).toBe(5);
      expect(counts.categories.find((category) => category.categoryId === s.y)).toMatchObject({ unread: 3, total: 3 });
      expect(counts.uncategorizedUnread).toBe(1);
    });

    it("counts a starred duplicate among the starred", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.copyB, { starred: true });
      expect(getCounts(s.db, NOW).starred).toBe(1);
    });
  });

  describe("when the kept article is read", () => {
    it("marks its unread duplicates read, and the feed of a duplicate has one fewer unread", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.kept, { isRead: true });
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([true, true]);
      expect(getCounts(s.db, NOW).feeds.find((feed) => feed.feedId === s.b)!.unread).toBe(2);
    });

    it("marks them read with a list of another category, and returns their ids", () => {
      const s = withDuplicates();
      const ids = markArticlesRead(s.db, { categoryId: s.x, before: "2026-03-02T00:00:00.000Z" });
      expect(ids).toEqual([s.kept, s.copyB, s.copyC].sort((left, right) => left - right));
      expect(markArticlesUnread(s.db, ids)).toBe(3);
      expect([s.isRead(s.kept), s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([false, false, false]);
    });

    it("leaves a duplicate that a filter hides unread", () => {
      const s = withDuplicates();
      s.db.prepare("UPDATE articles SET filtered = 1 WHERE id = ?").run(s.copyB);
      setArticleFlags(s.db, s.kept, { isRead: true });
      expect(markArticlesRead(s.db, { before: "2026-03-02T00:00:00.000Z" })).not.toContain(s.copyB);
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([false, true]);
    });

    it("leaves the duplicates read when the kept article is put back to unread", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.kept, { isRead: true });
      setArticleFlags(s.db, s.kept, { isRead: false });
      expect([s.isRead(s.kept), s.isRead(s.copyB)]).toEqual([false, true]);
    });

    it("leaves the duplicates alone while removal is off", () => {
      const s = withDuplicates();
      updateSettings(s.db, { removeDuplicates: false });
      setArticleFlags(s.db, s.kept, { isRead: true });
      expect(markArticlesRead(s.db, { categoryId: s.x, before: "2026-03-02T00:00:00.000Z" })).toEqual([]);
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([false, false]);
    });

    it("leaves the kept article alone when a duplicate is read", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.copyB, { isRead: true });
      markArticlesRead(s.db, { feedId: s.c, before: "2026-03-02T00:00:00.000Z" });
      expect(s.isRead(s.kept)).toBe(false);
    });
  });

  describe("summaries", () => {
    function summarizing() {
      const s = withDuplicates();
      for (const feed of [s.a, s.b]) updateFeed(s.db, feed, { autoSummarize: true }, s.clock);
      s.clock.advance(60_000);
      const stored = s.clock().toISOString();
      s.db.prepare("UPDATE articles SET created_at = ?").run(stored);
      // The kept article has its summary already.
      saveAutoSummary(s.db, s.kept, { text: "summary", source: "feed", now: stored });
      for (const id of s.ownB) saveAutoSummary(s.db, id, { text: "summary", source: "feed", now: stored });
      return s;
    }

    it("does not wait for the summary of a duplicate of a feed that summarises", () => {
      const s = summarizing();
      expect(nextArticleToSummarize(s.db)).toBeNull();
      expect(getArticle(s.db, s.copyB).autoSummaryPending).toBe(false);
    });

    it("summarises a duplicate that a reader opened and asked for", () => {
      const s = summarizing();
      expect(requestAutoSummary(s.db, s.copyB, s.clock().toISOString())).toBe(true);
      expect(nextArticleToSummarize(s.db)?.id).toBe(s.copyB);
    });

    it("waits for the summary of a duplicate again while removal is off", () => {
      const s = summarizing();
      updateSettings(s.db, { removeDuplicates: false });
      expect(nextArticleToSummarize(s.db)?.id).toBe(s.copyB);
    });
  });

  describe("the feeds that also delivered an article", () => {
    it("lists the duplicates of a kept article with their feed, in the order they were stored", () => {
      const s = withDuplicates();
      s.db.prepare("UPDATE articles SET created_at = ? WHERE id = ?").run("2026-03-01T05:00:00.000Z", s.copyB);
      s.db.prepare("UPDATE articles SET created_at = ? WHERE id = ?").run("2026-03-01T04:00:00.000Z", s.copyC);
      expect(getArticle(s.db, s.kept).otherFeeds).toEqual([
        { articleId: s.copyC, feedId: s.c, feedTitle: "Feed C" },
        { articleId: s.copyB, feedId: s.b, feedTitle: "Feed B" },
      ]);
    });

    it("is empty for an article without duplicates, and for a duplicate", () => {
      const s = withDuplicates();
      expect(getArticle(s.db, s.ownB[0]!).otherFeeds).toEqual([]);
      expect(getArticle(s.db, s.copyB).otherFeeds).toEqual([]);
    });
  });
});
