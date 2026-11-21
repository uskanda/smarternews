import { describe, expect, it } from "vitest";
import type { SavedSearch } from "../api.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { getCounts, insertArticle, searchArticles, setArticleFlags, type ArticleContent } from "./articles.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { deleteFeed } from "./feeds.ts";
import { createFilter } from "./filters.ts";
import { createSavedSearch, deleteSavedSearch, listSavedSearches, moveSavedSearch, updateSavedSearch } from "./saved-searches.ts";

const NOW = "2026-03-01T12:00:00.000Z";
const clock = fakeClock(NOW);
const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}T00:00:00.000Z`;

const names = (db: Database) => listSavedSearches(db).map((saved) => saved.name);

function category(db: Database, slug = "tools"): number {
  return createCategory(db, { slug, name: slug, kind: "news" }, clock).id;
}

function generated(db: Database, categoryId: number, overrides: Partial<ArticleContent> = {}): number {
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
    now: NOW,
    previousArticleId: null,
    refs: [],
    topicIds: [],
  });
}

/** The unread count of a saved search, as the counts give it. */
function unreadOf(db: Database, saved: SavedSearch): number | undefined {
  return getCounts(db, NOW).savedSearches.find((entry) => entry.id === saved.id)?.unread;
}

/** How many results the saved search has when it is opened: its conditions, unread only. */
function openedCount(db: Database, saved: SavedSearch): number {
  return searchArticles(
    db,
    {
      q: saved.query,
      ...(saved.categoryId !== null ? { category: saved.categoryId } : {}),
      ...(saved.feedId !== null ? { feed: saved.feedId } : {}),
      unread: "true",
      limit: 200,
    },
    NOW,
  ).items.length;
}

describe("saved searches", () => {
  it("keep a name, the words and the narrowing", () => {
    const db = createTestDb();
    const cat = category(db);
    const feed = seedFeed(db);
    expect(createSavedSearch(db, { name: "量子", query: "量子" }, clock)).toMatchObject({ name: "量子", query: "量子", categoryId: null, feedId: null });
    expect(createSavedSearch(db, { name: "道具の量子", query: "量子", categoryId: cat }, clock)).toMatchObject({ categoryId: cat, feedId: null });
    expect(createSavedSearch(db, { name: "Xの量子", query: "量子", feedId: feed }, clock)).toMatchObject({ categoryId: null, feedId: feed });
    expect(names(db)).toEqual(["量子", "道具の量子", "Xの量子"]);
  });

  it("may be saved twice with the same conditions", () => {
    const db = createTestDb();
    createSavedSearch(db, { name: "量子", query: "量子" }, clock);
    createSavedSearch(db, { name: "量子", query: "量子" }, clock);
    expect(names(db)).toEqual(["量子", "量子"]);
  });

  it("refuse words that are empty or too long, and a category or feed that does not exist", () => {
    const db = createTestDb();
    expect(() => createSavedSearch(db, { name: "空", query: "   " }, clock)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => createSavedSearch(db, { name: "長い", query: "あ".repeat(201) }, clock)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => createSavedSearch(db, { name: "a", query: "量子", categoryId: 99 }, clock)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => createSavedSearch(db, { name: "a", query: "量子", feedId: 99 }, clock)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(listSavedSearches(db)).toEqual([]);
  });

  it("change their name and keep their conditions and place", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const a = createSavedSearch(db, { name: "A", query: "量子", feedId: feed }, clock);
    createSavedSearch(db, { name: "B", query: "電池" }, clock);
    expect(updateSavedSearch(db, a.id, { name: "C" })).toMatchObject({ name: "C", query: "量子", feedId: feed });
    expect(names(db)).toEqual(["C", "B"]);
  });

  it("are deleted, and an unknown one is not found", () => {
    const db = createTestDb();
    const a = createSavedSearch(db, { name: "A", query: "量子" }, clock);
    deleteSavedSearch(db, a.id);
    expect(listSavedSearches(db)).toEqual([]);
    expect(() => deleteSavedSearch(db, a.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => updateSavedSearch(db, a.id, { name: "B" })).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("move before another one, or last", () => {
    const db = createTestDb();
    const a = createSavedSearch(db, { name: "A", query: "a1a" }, clock);
    const b = createSavedSearch(db, { name: "B", query: "b1b" }, clock);
    const c = createSavedSearch(db, { name: "C", query: "c1c" }, clock);
    expect(moveSavedSearch(db, c.id, a.id).map((saved) => saved.name)).toEqual(["C", "A", "B"]);
    expect(moveSavedSearch(db, c.id, null).map((saved) => saved.name)).toEqual(["A", "B", "C"]);
    expect(moveSavedSearch(db, b.id, b.id).map((saved) => saved.name)).toEqual(["A", "B", "C"]);
    expect(() => moveSavedSearch(db, a.id, 999)).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("go with the category or the feed they are narrowed to", () => {
    const db = createTestDb();
    const cat = category(db);
    const feed = seedFeed(db);
    createSavedSearch(db, { name: "全体", query: "量子" }, clock);
    createSavedSearch(db, { name: "カテゴリ", query: "量子", categoryId: cat }, clock);
    createSavedSearch(db, { name: "フィード", query: "量子", feedId: feed }, clock);
    deleteFeed(db, feed);
    expect(names(db)).toEqual(["全体", "カテゴリ"]);
    deleteCategory(db, cat);
    expect(names(db)).toEqual(["全体"]);
  });
});

describe("the unread count of a saved search", () => {
  it("counts the unread results, ended events included, as the list opened unread only", () => {
    const db = createTestDb();
    const cat = category(db);
    generated(db, cat, { title: "量子の計算機" });
    generated(db, cat, {
      title: "量子の展示会",
      event: { key: "e", startsAt: "2026-02-01T00:00:00.000Z", endsAt: "2026-02-01T00:00:00.000Z", venue: null, fee: null, registration: "unknown" },
    });
    const read = generated(db, cat, { title: "量子の話" });
    setArticleFlags(db, read, { isRead: true }, NOW);
    const saved = createSavedSearch(db, { name: "量子", query: "量子" }, clock);
    expect(unreadOf(db, saved)).toBe(2);
    expect(unreadOf(db, saved)).toBe(openedCount(db, saved));
  });

  it("leaves out what filters hide, and hidden duplicates unless a feed is named", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "特売の電池" });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "特売" }] }, clock);
    const kept = seedFeedArticle(db, feed, { title: "電池の話", at: day(1) });
    const other = seedFeed(db);
    seedFeedArticle(db, other, { title: "電池の話", at: day(2), duplicateOf: kept });
    const everywhere = createSavedSearch(db, { name: "電池", query: "電池" }, clock);
    const ofOther = createSavedSearch(db, { name: "電池", query: "電池", feedId: other }, clock);
    expect(unreadOf(db, everywhere)).toBe(1);
    expect(unreadOf(db, ofOther)).toBe(1);
    expect(unreadOf(db, everywhere)).toBe(openedCount(db, everywhere));
    expect(unreadOf(db, ofOther)).toBe(openedCount(db, ofOther));
  });

  it("counts within the category it is narrowed to, with short words matched too", () => {
    const db = createTestDb();
    const a = category(db, "a");
    const b = category(db, "b");
    generated(db, a, { title: "AI の量子" });
    generated(db, b, { title: "AI の量子" });
    generated(db, a, { title: "量子" });
    const saved = createSavedSearch(db, { name: "AI", query: "AI 量子", categoryId: a }, clock);
    expect(unreadOf(db, saved)).toBe(1);
    expect(unreadOf(db, saved)).toBe(openedCount(db, saved));
  });

  it("is zero when nothing matches, and there is none without saved searches", () => {
    const db = createTestDb();
    expect(getCounts(db, NOW).savedSearches).toEqual([]);
    const saved = createSavedSearch(db, { name: "なし", query: "存在しない語" }, clock);
    expect(getCounts(db, NOW).savedSearches).toEqual([{ id: saved.id, unread: 0 }]);
  });
});
