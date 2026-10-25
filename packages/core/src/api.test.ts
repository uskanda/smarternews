import { describe, expect, it } from "vitest";
import {
  markReadBodySchema,
  MAX_MARK_SEEN,
  articleSearchQuerySchema,
  articleSearchResultSchema, filterCreateSchema, listViewKey, listViewUpdateSchema, parseListViewKey, filterPreviewSchema, filterUpdateSchema, MAX_FILTER_CONDITIONS, MAX_FILTER_VALUE_CHARS, settingsFileSchema } from "./api.ts";

const condition = { fields: ["title"], match: "contains", value: "特売" } as const;

function issuesOf(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  return (result.error?.issues ?? []).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("the shape of a filter", () => {
  it("takes a hide filter over everything, enabled unless told otherwise", () => {
    const parsed = filterCreateSchema.parse({ action: "hide", scope: { type: "all" }, conditions: [condition] });
    expect(parsed).toEqual({ action: "hide", scope: { type: "all" }, conditions: [condition] });
  });

  it("takes a keep filter over a category or a feed", () => {
    expect(filterCreateSchema.safeParse({ action: "keep", scope: { type: "category", categoryId: 1 }, conditions: [condition] }).success).toBe(true);
    expect(filterCreateSchema.safeParse({ action: "keep", scope: { type: "feed", feedId: 2 }, conditions: [condition] }).success).toBe(true);
  });

  it("refuses a keep filter over everything, on the scope", () => {
    const result = filterCreateSchema.safeParse({ action: "keep", scope: { type: "all" }, conditions: [condition] });
    expect(issuesOf(result)).toEqual([{ path: "scope", message: "a keep filter cannot apply to everything" }]);
    expect(filterPreviewSchema.safeParse({ action: "keep", scope: { type: "all" }, conditions: [condition] }).success).toBe(false);
    expect(filterUpdateSchema.safeParse({ action: "keep", scope: { type: "all" } }).success).toBe(false);
  });

  it("refuses a filter without conditions", () => {
    const result = filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: [] });
    expect(issuesOf(result)).toEqual([{ path: "conditions", message: "a filter needs at least one condition" }]);
  });

  it("refuses more conditions than the limit, and a value longer than the limit", () => {
    const many = Array.from({ length: MAX_FILTER_CONDITIONS + 1 }, () => condition);
    expect(filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: many }).success).toBe(false);
    const ten = Array.from({ length: MAX_FILTER_CONDITIONS }, () => condition);
    expect(filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: ten }).success).toBe(true);

    const long = { ...condition, value: "x".repeat(MAX_FILTER_VALUE_CHARS + 1) };
    const result = filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: [condition, long] });
    expect(issuesOf(result).map((issue) => issue.path)).toEqual(["conditions.1.value"]);
  });

  it("refuses a condition without fields, with a field twice, or with an empty value", () => {
    const bad = (patch: object) =>
      issuesOf(filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: [{ ...condition, ...patch }] })).map((issue) => issue.path);
    expect(bad({ fields: [] })).toEqual(["conditions.0.fields"]);
    expect(bad({ fields: ["title", "title"] })).toEqual(["conditions.0.fields"]);
    expect(bad({ value: "  " })).toEqual(["conditions.0.value"]);
    expect(bad({ fields: ["body"] })).toEqual(["conditions.0.fields.0"]);
  });
});

describe("filters in the settings file", () => {
  it("names the scope by a category's slug or a feed's URL", () => {
    const file = settingsFileSchema.parse({
      version: 1,
      filters: [
        { action: "hide", scope: "all", conditions: [condition] },
        { action: "keep", scope: { category: "tools" }, conditions: [condition] },
        { action: "keep", scope: { feed: "https://example.com/feed.xml" }, enabled: false, conditions: [condition] },
      ],
    });
    expect(file.filters.map((filter) => filter.scope)).toEqual(["all", { category: "tools" }, { feed: "https://example.com/feed.xml" }]);
  });

  it("refuses a keep filter over everything", () => {
    expect(settingsFileSchema.safeParse({ version: 1, filters: [{ action: "keep", scope: "all", conditions: [condition] }] }).success).toBe(false);
  });

  it("still reads the stop words of an older file", () => {
    const file = settingsFileSchema.parse({ version: 1, stopWords: [{ text: "広告" }, { text: "提供", scope: "title_and_content" }] });
    expect(file.stopWords).toEqual([{ text: "広告" }, { text: "提供", scope: "title_and_content" }]);
    expect(file.filters).toEqual([]);
  });
});

describe("the shape of a search", () => {
  const summary = {
    id: 1,
    categoryId: null,
    origin: "feed",
    feedId: 2,
    author: null,
    kind: "news",
    title: "電池の話",
    translatedTitle: null,
    summary: "s",
    impact: null,
    importance: null,
    unconfirmed: false,
    firstPublishedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    revision: 0,
    isRead: false,
    readAt: null,
    starred: false,
    primaryUrl: null,
    refCount: 0,
    event: null,
  } as const;

  it("gives each article of the list an excerpt, and the result its terms", () => {
    const result = articleSearchResultSchema.parse({ items: [{ ...summary, excerpt: "…電池…" }, { ...summary, id: 2, excerpt: null }], nextCursor: null, asOf: "2026-03-02T00:00:00.000Z", terms: ["電池"] });
    expect(result.items.map((item) => item.excerpt)).toEqual(["…電池…", null]);
    expect(result.terms).toEqual(["電池"]);
    expect(articleSearchResultSchema.safeParse({ items: [summary], nextCursor: null, asOf: "2026-03-02T00:00:00.000Z", terms: [] }).success).toBe(false);
    expect(articleSearchResultSchema.safeParse({ items: [], nextCursor: null }).success).toBe(false);
  });

  it("takes the query and narrowing from a query string", () => {
    expect(articleSearchQuerySchema.parse({ q: "電池", category: "3", feed: "4", unread: "true", limit: "20" })).toEqual({
      q: "電池",
      category: 3,
      feed: 4,
      unread: "true",
      limit: 20,
    });
    expect(articleSearchQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("the key of a list view", () => {
  it("reads every entry that keeps a view, and gives back the same key", () => {
    const keys = ["unread", "all", "starred", "generated", "uncategorized", "category-3", "category-3-generated", "feed-12"];
    expect(keys.map(parseListViewKey)).toEqual([
      { list: "unread" },
      { list: "all" },
      { list: "starred" },
      { list: "generated" },
      { list: "uncategorized" },
      { list: "category", categoryId: 3 },
      { list: "category_generated", categoryId: 3 },
      { list: "feed", feedId: 12 },
    ]);
    expect(keys.map((key) => listViewKey(parseListViewKey(key)!))).toEqual(keys);
  });

  it("refuses the recently read articles, which keep no view, and any other text", () => {
    for (const key of ["recently-read", "", "category-", "category-x", "feed-3-generated", "feed--1", "Unread", "category-3-generated-"]) {
      expect(parseListViewKey(key)).toBeNull();
    }
  });
});

describe("the shape of a change to a list view", () => {
  it("takes the newest or the oldest first, and a body without it", () => {
    expect(listViewUpdateSchema.parse({ sort: "oldest" })).toEqual({ sort: "oldest" });
    expect(listViewUpdateSchema.parse({})).toEqual({});
    expect(listViewUpdateSchema.safeParse({ sort: "relevance" }).success).toBe(false);
  });
});

describe("the body of a mark-read request", () => {
  const seen = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, updatedAt: "2026-10-25T09:00:00.000Z" }));

  it("takes a range, or the articles a screen showed with the versions it showed", () => {
    expect(markReadBodySchema.parse({ categoryId: 3, before: "2026-10-25T09:00:00.000Z" })).toEqual({ categoryId: 3, before: "2026-10-25T09:00:00.000Z" });
    expect(markReadBodySchema.parse({ articles: seen(2) })).toEqual({ articles: seen(2) });
    expect(markReadBodySchema.safeParse({ articles: seen(MAX_MARK_SEEN) }).success).toBe(true);
  });

  it("refuses a body that mixes the two shapes", () => {
    expect(markReadBodySchema.safeParse({ articles: seen(1), before: "2026-10-25T09:00:00.000Z" }).success).toBe(false);
    expect(markReadBodySchema.safeParse({ articles: seen(1), categoryId: 3 }).success).toBe(false);
  });

  it("refuses no articles and more than the limit, saying there are too many", () => {
    expect(markReadBodySchema.safeParse({ articles: [] }).success).toBe(false);
    const result = markReadBodySchema.safeParse({ articles: seen(MAX_MARK_SEEN + 1) });
    expect(issuesOf(result)).toEqual([{ path: "articles", message: `too many articles: at most ${MAX_MARK_SEEN}` }]);
  });

  it("refuses an article without the version the screen showed", () => {
    expect(markReadBodySchema.safeParse({ articles: [{ id: 1 }] }).success).toBe(false);
    expect(markReadBodySchema.safeParse({ articles: [{ id: 1, updatedAt: "yesterday" }] }).success).toBe(false);
  });
});
