import type { Category, Counts, Feed } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { buildNav, hasListControls, hasReadToggle, listKey, parseListKey, targetFilter, targetScope, type ListTarget } from "./nav.ts";

const category = (id: number, name: string, overrides: Partial<Category> = {}): Category => ({
  id,
  slug: name.toLowerCase(),
  name,
  kind: "news",
  schedule: [],
  minImportance: 3,
  maxArticlesPerRun: 5,
  windowHours: 24,
  windowDays: null,
  enabled: true,
  createdAt: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

const feed = (id: number, title: string, categoryId: number | null): Feed => ({
  id,
  url: `https://f${id}.example.org/feed.xml`,
  title,
  siteUrl: null,
  categoryId,
  intervalMinutes: null,
  enabled: true,
  autoSummarize: false,
  translate: false,
  fetchFullContent: false,
  lastFetchedAt: null,
  lastSucceededAt: null,
  lastError: null,
  failureCount: 0,
  nextFetchAt: null,
  articleCount: 0,
  starredCount: 0,
  createdAt: "2026-03-01T00:00:00.000Z",
});

const counts: Counts = {
  unread: 12,
  starred: 2,
  generatedUnread: 3,
  uncategorizedUnread: 4,
  categories: [
    { categoryId: 1, unread: 6, total: 20, generatedUnread: 1, generatedTotal: 8 },
    { categoryId: 2, unread: 2, total: 5, generatedUnread: 2, generatedTotal: 5 },
  ],
  feeds: [
    { feedId: 10, unread: 5 },
    { feedId: 11, unread: 0 },
    { feedId: 12, unread: 4 },
  ],
};

/** The model as lines of "label unread", children indented. */
function outline(model: ReturnType<typeof buildNav>): string[] {
  return [
    ...model.views.map((entry) => `${entry.label} ${entry.unread}`),
    ...model.groups.flatMap((group) => [`${group.entry.label} ${group.entry.unread}`, ...group.children.map((child) => `  ${child.label} ${child.unread}`)]),
  ];
}

describe("buildNav", () => {
  it("lists the five views, then each category with the generated articles and its feeds below it", () => {
    const model = buildNav({
      categories: [category(1, "Tools"), category(2, "Cars")],
      feeds: [feed(10, "Blog", 1), feed(11, "Releases", 1)],
      counts,
    });
    expect(model.starred).toBe(2);
    expect(outline(model)).toEqual(["未読 12", "すべて 0", "スター 0", "AI生成 3", "最近読んだ記事 0", "Tools 6", "  AI生成 1", "  Blog 5", "  Releases 0", "Cars 2"]);
  });

  it("puts nothing below a category without feeds", () => {
    const model = buildNav({ categories: [category(2, "Cars")], feeds: [], counts });
    expect(model.groups).toEqual([expect.objectContaining({ children: [] })]);
  });

  it("gathers feeds without a category under 未分類, last, without an entry for generated articles", () => {
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [feed(12, "Loose", null)], counts });
    expect(outline(model).slice(5)).toEqual(["Tools 6", "未分類 4", "  Loose 4"]);
    expect(model.groups.at(-1)!.entry.target).toEqual({ type: "uncategorized" });
  });

  it("has no 未分類 when every feed has a category", () => {
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [feed(10, "Blog", 1)], counts });
    expect(model.groups.map((group) => group.entry.label)).toEqual(["Tools"]);
  });

  it("leaves out a disabled category", () => {
    const model = buildNav({ categories: [category(1, "Tools", { enabled: false }), category(2, "Cars")], feeds: [feed(10, "Blog", 1)], counts });
    expect(model.groups.map((group) => group.entry.label)).toEqual(["Cars"]);
  });

  it("shows zeros until the counts have arrived", () => {
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [feed(10, "Blog", 1)], counts: undefined });
    expect(outline(model)).toEqual(["未読 0", "すべて 0", "スター 0", "AI生成 0", "最近読んだ記事 0", "Tools 0", "  AI生成 0", "  Blog 0"]);
  });

  it("gives each entry the list it opens", () => {
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [feed(10, "Blog", 1)], counts });
    expect(model.views.map((view) => view.target)).toEqual([
      { type: "unread" },
      { type: "all" },
      { type: "starred" },
      { type: "generated" },
      { type: "recentlyRead" },
    ]);
    const [tools] = model.groups;
    expect(tools!.entry.target).toEqual({ type: "category", categoryId: 1, generatedOnly: false });
    expect(tools!.children.map((child) => child.target)).toEqual([
      { type: "category", categoryId: 1, generatedOnly: true },
      { type: "feed", feedId: 10 },
    ]);
  });
});

describe("the key of a list", () => {
  const cases: Array<[ListTarget, string]> = [
    [{ type: "unread" }, "unread"],
    [{ type: "all" }, "all"],
    [{ type: "starred" }, "starred"],
    [{ type: "generated" }, "generated"],
    [{ type: "uncategorized" }, "uncategorized"],
    [{ type: "recentlyRead" }, "recently-read"],
    [{ type: "category", categoryId: 7, generatedOnly: false }, "category-7"],
    [{ type: "category", categoryId: 7, generatedOnly: true }, "category-7-generated"],
    [{ type: "feed", feedId: 31 }, "feed-31"],
  ];

  it.each(cases)("writes %j as %s and reads it back", (target, key) => {
    expect(listKey(target)).toBe(key);
    expect(parseListKey(key)).toEqual(target);
  });

  it("reads anything else as nothing", () => {
    for (const key of ["", "category-", "category-x", "feed-1-generated", "settings", "category-7-other", "recentlyRead"]) expect(parseListKey(key)).toBeNull();
  });
});

describe("what a list asks the server for", () => {
  it("narrows the article list to the target", () => {
    expect(targetFilter({ type: "unread" })).toEqual({ unread: "true" });
    expect(targetFilter({ type: "all" })).toEqual({});
    expect(targetFilter({ type: "starred" })).toEqual({ starred: "true" });
    expect(targetFilter({ type: "generated" })).toEqual({ origin: "generated" });
    expect(targetFilter({ type: "uncategorized" })).toEqual({ uncategorized: "true" });
    expect(targetFilter({ type: "category", categoryId: 7, generatedOnly: false })).toEqual({ category: 7 });
    expect(targetFilter({ type: "category", categoryId: 7, generatedOnly: true })).toEqual({ category: 7, origin: "generated" });
    expect(targetFilter({ type: "feed", feedId: 31 })).toEqual({ feed: 31 });
    expect(targetFilter({ type: "recentlyRead" })).toEqual({ recentlyRead: "true" });
  });

  it("narrows a mark-all-read the same way", () => {
    expect(targetScope({ type: "unread" })).toEqual({});
    expect(targetScope({ type: "generated" })).toEqual({ origin: "generated" });
    expect(targetScope({ type: "uncategorized" })).toEqual({ uncategorized: true });
    expect(targetScope({ type: "category", categoryId: 7, generatedOnly: true })).toEqual({ categoryId: 7, origin: "generated" });
    expect(targetScope({ type: "feed", feedId: 31 })).toEqual({ feedId: 31 });
  });

  it("offers to include read articles everywhere but in the three fixed views", () => {
    expect(hasReadToggle({ type: "unread" })).toBe(false);
    expect(hasReadToggle({ type: "all" })).toBe(false);
    expect(hasReadToggle({ type: "starred" })).toBe(false);
    expect(hasReadToggle({ type: "generated" })).toBe(true);
    expect(hasReadToggle({ type: "feed", feedId: 1 })).toBe(true);
    expect(hasReadToggle({ type: "recentlyRead" })).toBe(false);
  });

  it("offers mark all as read and the importance toggle everywhere but in the recently read articles", () => {
    expect(hasListControls({ type: "unread" })).toBe(true);
    expect(hasListControls({ type: "starred" })).toBe(true);
    expect(hasListControls({ type: "category", categoryId: 7, generatedOnly: false })).toBe(true);
    expect(hasListControls({ type: "feed", feedId: 1 })).toBe(true);
    expect(hasListControls({ type: "recentlyRead" })).toBe(false);
  });
});
