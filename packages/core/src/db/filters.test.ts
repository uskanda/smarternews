import { describe, expect, it } from "vitest";
import type { FilterCondition, FilterCreate } from "../api.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { getCounts, listArticles, markArticlesRead, setArticleFlags } from "./articles.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { deleteFeed, moveFeed, updateFeed } from "./feeds.ts";
import { applyFilters, createFilter, deleteFilter, getFilter, listFilterArticles, listFilters, previewFilter, updateFilter } from "./filters.ts";

const clock = fakeClock("2026-03-01T12:00:00.000Z");
const NOW = "2026-03-01T12:00:00.000Z";

const title = (value: string): FilterCondition => ({ fields: ["title"], match: "contains", value });
const hide = (conditions: FilterCondition[], scope: FilterCreate["scope"] = { type: "all" }): FilterCreate => ({ action: "hide", scope, conditions });
const keep = (conditions: FilterCondition[], scope: FilterCreate["scope"]): FilterCreate => ({ action: "keep", scope, conditions });

/** The titles the article list holds, of every origin. */
function listed(db: Database, query: Parameters<typeof listArticles>[1] = {}): string[] {
  return listArticles(db, query, NOW)
    .items.map((item) => item.title)
    .sort();
}

function category(db: Database, slug: string): number {
  return createCategory(db, { slug, name: slug, kind: "news" }, clock).id;
}

describe("a hide filter", () => {
  it("hides the stored feed articles it matches, and counts them", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "春の特売" });
    seedFeedArticle(db, feed, { title: "新製品" });

    const filter = createFilter(db, hide([title("特売")]), clock);

    expect(filter).toMatchObject({ action: "hide", scope: { type: "all" }, enabled: true, hiddenCount: 1 });
    expect(listed(db)).toEqual(["新製品"]);
  });

  it("refuses the same filter twice, however the value is written", () => {
    const db = createTestDb();
    createFilter(db, hide([title("PR")]), clock);
    expect(() => createFilter(db, hide([title("ｐｒ")]), clock)).toThrow(/already registered/);
    expect(listFilters(db)).toHaveLength(1);
  });

  it("applies to the feed of its scope only", () => {
    const db = createTestDb();
    const a = seedFeed(db);
    const b = seedFeed(db);
    seedFeedArticle(db, a, { title: "特売 A" });
    seedFeedArticle(db, b, { title: "特売 B" });

    createFilter(db, hide([title("特売")], { type: "feed", feedId: a }), clock);

    expect(listed(db)).toEqual(["特売 B"]);
  });

  it("refuses a regular expression it cannot use, naming the condition", () => {
    const db = createTestDb();
    expect(() => createFilter(db, hide([title("ok"), { fields: ["title"], match: "regex", value: "(sale" }]), clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [{ path: "conditions.1.value", message: expect.stringMatching(/regular expression/) }] }),
    );
    expect(listFilters(db)).toEqual([]);
  });

  it("refuses a scope that names nothing", () => {
    const db = createTestDb();
    expect(() => createFilter(db, hide([title("x")], { type: "feed", feedId: 99 }), clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [{ path: "scope.feedId", message: "no such feed" }] }),
    );
    expect(() => createFilter(db, hide([title("x")], { type: "category", categoryId: 99 }), clock)).toThrow(
      expect.objectContaining({ fields: [{ path: "scope.categoryId", message: "no such category" }] }),
    );
  });
});

describe("keep filters", () => {
  it("hide what meets none of the keep filters of the scope", () => {
    const db = createTestDb();
    const a = seedFeed(db);
    const b = seedFeed(db);
    seedFeedArticle(db, a, { title: "新製品の発表" });
    seedFeedArticle(db, a, { title: "発表会のお知らせ" });
    seedFeedArticle(db, a, { title: "決算" });
    seedFeedArticle(db, b, { title: "決算 B" });

    const first = createFilter(db, keep([title("新製品")], { type: "feed", feedId: a }), clock);
    expect(listed(db)).toEqual(["新製品の発表", "決算 B"].sort());
    expect(first.hiddenCount).toBe(2);

    const second = createFilter(db, keep([title("発表")], { type: "feed", feedId: a }), clock);
    expect(listed(db)).toEqual(["新製品の発表", "発表会のお知らせ", "決算 B"].sort());
    // Two keep filters of one scope hide the same articles, and say the same count.
    expect(getFilter(db, first.id).hiddenCount).toBe(1);
    expect(second.hiddenCount).toBe(1);
  });

  it("of a category and of its feed are judged apart: either can hide", () => {
    const db = createTestDb();
    const x = category(db, "x");
    const a = seedFeed(db, { categoryId: x });
    seedFeedArticle(db, a, { title: "新製品" });
    seedFeedArticle(db, a, { title: "国内の新製品" });

    createFilter(db, keep([title("新製品")], { type: "category", categoryId: x }), clock);
    createFilter(db, keep([title("国内")], { type: "feed", feedId: a }), clock);

    expect(listed(db)).toEqual(["国内の新製品"]);
  });

  it("hide in the list of the feed too", () => {
    const db = createTestDb();
    const a = seedFeed(db);
    seedFeedArticle(db, a, { title: "決算" });
    createFilter(db, keep([title("新製品")], { type: "feed", feedId: a }), clock);
    expect(listed(db, { feed: a })).toEqual([]);
  });
});

describe("hide and keep together", () => {
  it("hide an article that a hide filter matches, even when a keep filter keeps it", () => {
    const db = createTestDb();
    const a = seedFeed(db);
    seedFeedArticle(db, a, { title: "新製品の特売" });
    createFilter(db, keep([title("新製品")], { type: "feed", feedId: a }), clock);
    createFilter(db, hide([title("特売")]), clock);
    expect(listed(db)).toEqual([]);
  });
});

describe("what filters never hide", () => {
  it("leaves a starred article visible, and out of the count", () => {
    const db = createTestDb();
    const a = seedFeed(db);
    seedFeedArticle(db, a, { title: "春の特売", starred: true });
    seedFeedArticle(db, a, { title: "決算", starred: true });

    const hiding = createFilter(db, hide([title("特売")]), clock);
    const keeping = createFilter(db, keep([title("新製品")], { type: "feed", feedId: a }), clock);

    expect(listed(db)).toEqual(["春の特売", "決算"].sort());
    expect([hiding.hiddenCount, getFilter(db, keeping.id).hiddenCount]).toEqual([0, 0]);
  });

  it("leaves generated articles alone, in a category with a keep filter too", () => {
    const db = createTestDb();
    const x = category(db, "x");
    seedFeed(db, { categoryId: x });
    db.prepare(
      "INSERT INTO articles (category_id, kind, title, summary, body, importance, first_published_at, updated_at) VALUES (?, 'news', '特売の分析', 's', 'b', 3, ?, ?)",
    ).run(x, NOW, NOW);

    createFilter(db, hide([title("特売")]), clock);
    createFilter(db, keep([title("新製品")], { type: "category", categoryId: x }), clock);

    expect(listed(db)).toEqual(["特売の分析"]);
    expect(db.prepare("SELECT filtered FROM articles").all()).toEqual([{ filtered: 0 }]);
  });
});

describe("taking filters away", () => {
  it("brings back what only that filter hid, unread or read as it was", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "特売 1" });
    seedFeedArticle(db, feed, { title: "特売 2", isRead: true });
    const filter = createFilter(db, hide([title("特売")]), clock);

    expect(deleteFilter(db, filter.id)).toEqual({ restored: 2 });

    expect(listArticles(db, {}, NOW).items.map((item) => [item.title, item.isRead])).toEqual(
      expect.arrayContaining([
        ["特売 1", false],
        ["特売 2", true],
      ]),
    );
  });

  it("keeps hidden what another filter also hides, and counts it for both", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "特売の広告" });
    const first = createFilter(db, hide([title("特売")]), clock);
    const second = createFilter(db, hide([title("広告")]), clock);
    expect(listFilters(db).map((filter) => filter.hiddenCount)).toEqual([1, 1]);

    expect(deleteFilter(db, first.id)).toEqual({ restored: 0 });

    expect(listed(db)).toEqual([]);
    expect(getFilter(db, second.id).hiddenCount).toBe(1);
  });

  it("brings back unread what a mark-all-read passed over, when the filter is disabled", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "決算", at: "2026-03-01T10:00:00.000Z" });
    seedFeedArticle(db, feed, { title: "新製品", at: "2026-03-01T10:00:00.000Z" });
    const filter = createFilter(db, keep([title("新製品")], { type: "feed", feedId: feed }), clock);

    markArticlesRead(db, { feedId: feed, before: NOW });
    const result = updateFilter(db, filter.id, { enabled: false });

    expect(result).toMatchObject({ enabled: false, hiddenCount: 0, restored: 1 });
    expect(listed(db, { unread: "true" })).toEqual(["決算"]);
  });

  it("hides again what a disabled filter hid once it is enabled again", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    for (const n of [1, 2, 3, 4]) seedFeedArticle(db, feed, { title: `特売 ${n}` });
    const filter = createFilter(db, hide([title("特売")]), clock);

    expect(updateFilter(db, filter.id, { enabled: false }).restored).toBe(4);
    expect(listed(db)).toHaveLength(4);
    expect(updateFilter(db, filter.id, { enabled: true })).toMatchObject({ hiddenCount: 4, restored: 0 });
    expect(listed(db)).toEqual([]);
  });
});

describe("changing a filter", () => {
  it("matches new conditions against the stored articles", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "新製品", body: "提供の記事" });
    const filter = createFilter(db, hide([title("提供")]), clock);
    expect(listed(db)).toEqual(["新製品"]);

    const changed = updateFilter(db, filter.id, { conditions: [{ fields: ["title", "content"], match: "contains", value: "提供" }] });

    expect(changed.hiddenCount).toBe(1);
    expect(listed(db)).toEqual([]);
  });

  it("refuses to make a hide filter over everything into a keep filter", () => {
    const db = createTestDb();
    const filter = createFilter(db, hide([title("x")]), clock);
    expect(() => updateFilter(db, filter.id, { action: "keep" })).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("answers not found for a filter that does not exist", () => {
    const db = createTestDb();
    expect(() => updateFilter(db, 7, { enabled: false })).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => deleteFilter(db, 7)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => listFilterArticles(db, 7, {})).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

describe("applyFilters", () => {
  it("judges one article again, for when its content changed", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const article = seedFeedArticle(db, feed, { title: "新製品" });
    createFilter(db, hide([title("特売")]), clock);
    db.prepare("UPDATE articles SET title = '特売の新製品' WHERE id = ?").run(article);

    applyFilters(db, article);

    expect(listed(db)).toEqual([]);
  });
});

describe("hidden articles and the lists", () => {
  it("leaves a hidden unread article out of the counts", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "a" });
    seedFeedArticle(db, feed, { title: "b" });
    seedFeedArticle(db, feed, { title: "特売" });
    createFilter(db, hide([title("特売")]), clock);
    expect(getCounts(db, NOW).feeds).toEqual([{ feedId: feed, unread: 2 }]);
    expect(getCounts(db, NOW).unread).toBe(2);
  });

  it("shows a starred article again in the lists", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const sale = seedFeedArticle(db, feed, { title: "特売" });
    createFilter(db, hide([title("特売")]), clock);
    setArticleFlags(db, sale, { starred: true });
    expect(listed(db, { feed })).toEqual(["特売"]);
  });
});

describe("moving a feed and deleting a category", () => {
  it("applies the filters of the category a feed moves to, and drops those of the one it left", () => {
    const db = createTestDb();
    const x = category(db, "x");
    const y = category(db, "y");
    const feed = seedFeed(db, { categoryId: x });
    seedFeedArticle(db, feed, { title: "特売" });
    createFilter(db, hide([title("特売")], { type: "category", categoryId: x }), clock);
    expect(listed(db)).toEqual([]);

    moveFeed(db, feed, { categoryId: y, before: null });
    expect(listed(db)).toEqual(["特売"]);

    createFilter(db, hide([title("特売")], { type: "category", categoryId: y }), clock);
    updateFeed(db, feed, { categoryId: null });
    expect(listed(db)).toEqual(["特売"]);
    moveFeed(db, feed, { categoryId: y, before: null });
    expect(listed(db)).toEqual([]);
  });

  it("removes the filters of a deleted category, and its feeds' articles come back", () => {
    const db = createTestDb();
    const x = category(db, "x");
    const feed = seedFeed(db, { categoryId: x });
    seedFeedArticle(db, feed, { title: "決算" });
    createFilter(db, keep([title("新製品")], { type: "category", categoryId: x }), clock);
    expect(listed(db)).toEqual([]);

    deleteCategory(db, x);

    expect(listFilters(db)).toEqual([]);
    expect(listed(db)).toEqual(["決算"]);
  });

  it("removes the filters of a deleted feed", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    createFilter(db, hide([title("x")], { type: "feed", feedId: feed }), clock);
    deleteFeed(db, feed);
    expect(listFilters(db)).toEqual([]);
  });
});

describe("the articles a filter hides", () => {
  it("lists them newest first, a page at a time", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "特売 1", at: "2026-03-01T01:00:00.000Z" });
    seedFeedArticle(db, feed, { title: "特売 2", at: "2026-03-01T02:00:00.000Z" });
    seedFeedArticle(db, feed, { title: "特売 3", at: "2026-03-01T03:00:00.000Z" });
    seedFeedArticle(db, feed, { title: "新製品" });
    const filter = createFilter(db, hide([title("特売")]), clock);

    const first = listFilterArticles(db, filter.id, { limit: 2 });
    expect(first.items.map((item) => item.title)).toEqual(["特売 3", "特売 2"]);
    const second = listFilterArticles(db, filter.id, { limit: 2, cursor: first.nextCursor! });
    expect(second).toMatchObject({ items: [expect.objectContaining({ title: "特売 1" })], nextCursor: null });
  });

  it("lists what a keep filter hides", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "決算" });
    seedFeedArticle(db, feed, { title: "新製品" });
    const filter = createFilter(db, keep([title("新製品")], { type: "feed", feedId: feed }), clock);
    expect(listFilterArticles(db, filter.id, {}).items.map((item) => item.title)).toEqual(["決算"]);
  });
});

describe("previewFilter", () => {
  it("counts what a hide filter would hide, and changes nothing", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    for (const n of [1, 2, 3]) seedFeedArticle(db, feed, { title: `特売 ${n}` });
    seedFeedArticle(db, feed, { title: "新製品" });

    expect(previewFilter(db, hide([title("特売")]))).toEqual({ hiddenCount: 3 });
    expect(listFilters(db)).toEqual([]);
    expect(listed(db)).toHaveLength(4);
    expect(db.prepare("SELECT count(*) AS n FROM filter_matches").get()).toEqual({ n: 0 });
  });

  it("counts a keep filter together with the other keep filters of the scope", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "新製品" });
    seedFeedArticle(db, feed, { title: "発表" });
    seedFeedArticle(db, feed, { title: "決算" });
    createFilter(db, keep([title("新製品")], { type: "feed", feedId: feed }), clock);
    expect(previewFilter(db, keep([title("発表")], { type: "feed", feedId: feed }))).toEqual({ hiddenCount: 1 });
  });

  it("leaves out the stored content of the filter being changed", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "新製品" });
    seedFeedArticle(db, feed, { title: "決算" });
    const filter = createFilter(db, keep([title("新製品")], { type: "feed", feedId: feed }), clock);

    expect(previewFilter(db, { ...keep([title("決算")], { type: "feed", feedId: feed }), id: filter.id })).toEqual({ hiddenCount: 1 });
    expect(previewFilter(db, { ...keep([title("なし")], { type: "feed", feedId: feed }), id: filter.id })).toEqual({ hiddenCount: 2 });
    expect(getFilter(db, filter.id).conditions).toEqual([title("新製品")]);
  });

  it("refuses a regular expression it cannot use", () => {
    const db = createTestDb();
    expect(() => previewFilter(db, hide([{ fields: ["title"], match: "regex", value: "(sale" }]))).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "conditions.0.value" })] }),
    );
  });
});
