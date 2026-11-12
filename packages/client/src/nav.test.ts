import { parseListViewKey, type Category, type Counts, type Feed } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import {
  buildNav,
  HIDE_READ_ON,
  HIDE_READ_STORAGE_KEY,
  parseHideRead,
  hasImportanceFilter,
  hasListControls,
  hideEmptyEntries, hasReadToggle, hasSortMenu, listKey, listSortOf, parseListKey, targetFilter, targetScope, type ListTarget } from "./nav.ts";

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
  format: "feed",
  selectors: null,
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
  goneAt: null,
  nextFetchAt: null,
  articleCount: 0,
  starredCount: 0,
  annotatedCount: 0,
  createdAt: "2026-03-01T00:00:00.000Z",
  lastNewItemAt: null,
  stale: false,
  recentArticleCount: 0,
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
  it("lists the seven views, then each category with the generated articles and its feeds below it", () => {
    const model = buildNav({
      categories: [category(1, "Tools"), category(2, "Cars")],
      feeds: [feed(10, "Blog", 1), feed(11, "Releases", 1)],
      counts,
    });
    expect(model.starred).toBe(2);
    expect(outline(model)).toEqual(["未読 12", "すべて 0", "スター 0", "AI生成 3", "購読フィード 9", "最近読んだ記事 0", "注釈 0", "Tools 6", "  AI生成 1", "  Blog 5", "  Releases 0", "Cars 2"]);
  });

  it("counts beside 購読フィード the unread articles that are not generated, and never less than zero", () => {
    const unreadOf = (given: Counts) => buildNav({ categories: [], feeds: [], counts: given }).views.find((view) => view.target.type === "feeds")!.unread;
    expect(unreadOf(counts)).toBe(9);
    expect(unreadOf({ ...counts, unread: 3, generatedUnread: 3 })).toBe(0);
    // The two numbers are read at one time; should they ever disagree, the entry shows no negative count.
    expect(unreadOf({ ...counts, unread: 2, generatedUnread: 3 })).toBe(0);
  });

  it("shows 購読フィード below AI生成 even without a subscribed feed", () => {
    const model = buildNav({ categories: [category(2, "Cars")], feeds: [], counts });
    expect(model.views.map((view) => view.label).slice(3, 5)).toEqual(["AI生成", "購読フィード"]);
  });

  it("puts nothing below a category without feeds", () => {
    const model = buildNav({ categories: [category(2, "Cars")], feeds: [], counts });
    expect(model.groups).toEqual([expect.objectContaining({ children: [] })]);
  });

  it("gathers feeds without a category under 未分類, last, without an entry for generated articles", () => {
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [feed(12, "Loose", null)], counts });
    expect(outline(model).slice(7)).toEqual(["Tools 6", "未分類 4", "  Loose 4"]);
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
    expect(outline(model)).toEqual(["未読 0", "すべて 0", "スター 0", "AI生成 0", "購読フィード 0", "最近読んだ記事 0", "注釈 0", "Tools 0", "  AI生成 0", "  Blog 0"]);
  });

  it("gives a feed entry the state of its fetches, and a healthy one none", () => {
    const failed = { ...feed(10, "Blog", 1), lastError: "HTTP status 503: x" };
    const paused = { ...feed(11, "Releases", 1), enabled: false };
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [failed, paused, feed(12, "Loose", null)], counts });
    const [tools, loose] = model.groups;
    expect(tools!.children.map((child) => child.state)).toEqual([undefined, "failed", "paused"]);
    expect(loose!.children[0]).not.toHaveProperty("state");
    expect(model.views.every((view) => !("state" in view))).toBe(true);
  });

  it("gives a group the strongest state of the feeds below it", () => {
    const stale = { ...feed(10, "Blog", 1), stale: true };
    const paused = { ...feed(11, "Releases", 1), enabled: false };
    const failedLoose = { ...feed(12, "Loose", null), lastError: "timed out" };
    const model = buildNav({ categories: [category(1, "Tools"), category(2, "Cars")], feeds: [paused, stale, failedLoose], counts });
    expect(model.groups.map((group) => [group.entry.label, group.childState])).toEqual([
      ["Tools", "stale"],
      ["Cars", undefined],
      ["未分類", "failed"],
    ]);
    expect(model.groups[1]).not.toHaveProperty("childState");
  });

  it("gives each entry the list it opens", () => {
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [feed(10, "Blog", 1)], counts });
    expect(model.views.map((view) => view.target)).toEqual([
      { type: "unread" },
      { type: "all" },
      { type: "starred" },
      { type: "generated" },
      { type: "feeds" },
      { type: "recentlyRead" },
      { type: "annotations" },
    ]);
    // "注釈" counts nothing: no number stands beside it.
    expect(model.views.at(-1)).toEqual({ target: { type: "annotations" }, label: "注釈", unread: 0 });
    const [tools] = model.groups;
    expect(tools!.entry.target).toEqual({ type: "category", categoryId: 1, generatedOnly: false });
    expect(tools!.children.map((child) => child.target)).toEqual([
      { type: "category", categoryId: 1, generatedOnly: true },
      { type: "feed", feedId: 10 },
    ]);
  });
});

describe("hideEmptyEntries", () => {
  // Tools (Blog 5, Releases 0), Cars without feeds, Bikes (Hill 0, Road 0), and the loose feed Loose 0.
  const sparse: Counts = {
    unread: 5,
    starred: 1,
    generatedUnread: 0,
    uncategorizedUnread: 0,
    categories: [
      { categoryId: 1, unread: 5, total: 20, generatedUnread: 0, generatedTotal: 8 },
      { categoryId: 2, unread: 0, total: 5, generatedUnread: 0, generatedTotal: 5 },
      { categoryId: 3, unread: 0, total: 5, generatedUnread: 0, generatedTotal: 0 },
    ],
    feeds: [
      { feedId: 10, unread: 5 },
      { feedId: 11, unread: 0 },
      { feedId: 20, unread: 0 },
      { feedId: 21, unread: 0 },
      { feedId: 30, unread: 0 },
    ],
  };
  const CATEGORIES = [category(1, "Tools"), category(2, "Cars"), category(3, "Bikes")];
  const FEEDS = [feed(10, "Blog", 1), feed(11, "Releases", 1), feed(20, "Hill", 3), feed(21, "Road", 3), feed(30, "Loose", null)];
  const VIEWS = ["未読 5", "すべて 0", "スター 0", "AI生成 0", "購読フィード 5", "最近読んだ記事 0", "注釈 0"];
  const build = (feeds: Feed[] = FEEDS, withCounts: Counts | undefined = sparse) => buildNav({ categories: CATEGORIES, feeds, counts: withCounts });
  const hide = (model: ReturnType<typeof buildNav>, current: ListTarget | null = null, counted = true) => hideEmptyEntries(model, { current, counted });

  it("hides the feeds, the generated articles, the categories and 未分類 without unread articles, and keeps the views", () => {
    expect(outline(hide(build()))).toEqual([...VIEWS, "Tools 5", "  Blog 5"]);
  });

  it("keeps the views even when every one of them counts zero", () => {
    const model = hide(build(FEEDS, { ...sparse, unread: 0, categories: [], feeds: [] }));
    expect(model.views.map((view) => view.label)).toEqual(["未読", "すべて", "スター", "AI生成", "購読フィード", "最近読んだ記事", "注釈"]);
    expect(model.groups).toEqual([]);
  });

  it("keeps a feed whose fetches failed or stopped, with its category, but not a paused one", () => {
    const feeds = [feed(10, "Blog", 1), { ...feed(11, "Releases", 1), stale: true }, feed(20, "Hill", 3), { ...feed(21, "Road", 3), lastError: "timed out" }, { ...feed(30, "Loose", null), enabled: false }];
    expect(outline(hide(build(feeds)))).toEqual([...VIEWS, "Tools 5", "  Blog 5", "  Releases 0", "Bikes 0", "  Road 0"]);
  });

  it("keeps the entry that is open, and the category above it", () => {
    expect(outline(hide(build(), { type: "feed", feedId: 20 })).slice(7)).toEqual(["Tools 5", "  Blog 5", "Bikes 0", "  Hill 0"]);
    expect(outline(hide(build(), { type: "category", categoryId: 3, generatedOnly: true })).slice(7)).toEqual(["Tools 5", "  Blog 5", "Bikes 0", "  AI生成 0"]);
    expect(outline(hide(build(), { type: "category", categoryId: 2, generatedOnly: false })).slice(7)).toEqual(["Tools 5", "  Blog 5", "Cars 0"]);
    expect(outline(hide(build(), { type: "uncategorized" })).slice(7)).toEqual(["Tools 5", "  Blog 5", "未分類 0"]);
  });

  it("hides nothing until the counts have arrived", () => {
    const model = build(FEEDS, undefined);
    expect(hide(model, null, false)).toEqual(model);
  });

  it("is kept under its own key, on for 'on' only", () => {
    expect(HIDE_READ_STORAGE_KEY).toBe("smarternews.nav.hideRead");
    expect(parseHideRead(HIDE_READ_ON)).toBe(true);
    expect(parseHideRead(null)).toBe(false);
    expect(parseHideRead("true")).toBe(false);
  });

  it("keeps the state of the feeds below a group, hidden ones too", () => {
    const feeds = [feed(10, "Blog", 1), { ...feed(11, "Releases", 1), enabled: false }, ...FEEDS.slice(2)];
    const [tools] = hide(build(feeds)).groups;
    expect(tools!.children.map((child) => child.label)).toEqual(["Blog"]);
    expect(tools!.childState).toBe("paused");
  });
});

describe("the key of a list", () => {
  const cases: Array<[ListTarget, string]> = [
    [{ type: "unread" }, "unread"],
    [{ type: "all" }, "all"],
    [{ type: "starred" }, "starred"],
    [{ type: "generated" }, "generated"],
    [{ type: "feeds" }, "feeds"],
    [{ type: "uncategorized" }, "uncategorized"],
    [{ type: "recentlyRead" }, "recently-read"],
    [{ type: "annotations" }, "annotations"],
    [{ type: "category", categoryId: 7, generatedOnly: false }, "category-7"],
    [{ type: "category", categoryId: 7, generatedOnly: true }, "category-7-generated"],
    [{ type: "feed", feedId: 31 }, "feed-31"],
  ];

  it.each(cases)("writes %j as %s and reads it back", (target, key) => {
    expect(listKey(target)).toBe(key);
    expect(parseListKey(key)).toEqual(target);
  });

  it("reads anything else as nothing", () => {
    for (const key of ["", "category-", "category-x", "feed-1-generated", "settings", "category-7-other", "recentlyRead", "feed", "feeds-1"]) expect(parseListKey(key)).toBeNull();
  });
});

describe("what a list asks the server for", () => {
  it("narrows the article list to the target", () => {
    expect(targetFilter({ type: "unread" })).toEqual({ unread: "true" });
    expect(targetFilter({ type: "all" })).toEqual({});
    expect(targetFilter({ type: "starred" })).toEqual({ starred: "true" });
    expect(targetFilter({ type: "generated" })).toEqual({ origin: "generated" });
    expect(targetFilter({ type: "feeds" })).toEqual({ origin: "feed" });
    expect(targetFilter({ type: "uncategorized" })).toEqual({ uncategorized: "true" });
    expect(targetFilter({ type: "category", categoryId: 7, generatedOnly: false })).toEqual({ category: 7 });
    expect(targetFilter({ type: "category", categoryId: 7, generatedOnly: true })).toEqual({ category: 7, origin: "generated" });
    expect(targetFilter({ type: "feed", feedId: 31 })).toEqual({ feed: 31 });
    expect(targetFilter({ type: "recentlyRead" })).toEqual({ recentlyRead: "true" });
  });

  it("narrows a mark-all-read the same way", () => {
    expect(targetScope({ type: "unread" })).toEqual({});
    expect(targetScope({ type: "generated" })).toEqual({ origin: "generated" });
    expect(targetScope({ type: "feeds" })).toEqual({ origin: "feed" });
    expect(targetScope({ type: "uncategorized" })).toEqual({ uncategorized: true });
    expect(targetScope({ type: "category", categoryId: 7, generatedOnly: true })).toEqual({ categoryId: 7, origin: "generated" });
    expect(targetScope({ type: "feed", feedId: 31 })).toEqual({ feedId: 31 });
  });

  it("offers to include read articles everywhere but in the three fixed views", () => {
    expect(hasReadToggle({ type: "unread" })).toBe(false);
    expect(hasReadToggle({ type: "all" })).toBe(false);
    expect(hasReadToggle({ type: "starred" })).toBe(false);
    expect(hasReadToggle({ type: "generated" })).toBe(true);
    expect(hasReadToggle({ type: "feeds" })).toBe(true);
    expect(hasReadToggle({ type: "feed", feedId: 1 })).toBe(true);
    expect(hasReadToggle({ type: "recentlyRead" })).toBe(false);
    expect(hasReadToggle({ type: "annotations" })).toBe(false);
  });

  it("offers mark all as read and the importance toggle everywhere but in the recently read articles", () => {
    expect(hasListControls({ type: "unread" })).toBe(true);
    expect(hasListControls({ type: "starred" })).toBe(true);
    expect(hasListControls({ type: "feeds" })).toBe(true);
    expect(hasListControls({ type: "category", categoryId: 7, generatedOnly: false })).toBe(true);
    expect(hasListControls({ type: "feed", feedId: 1 })).toBe(true);
    expect(hasListControls({ type: "recentlyRead" })).toBe(false);
    expect(hasListControls({ type: "annotations" })).toBe(false);
  });

  it("offers the importance toggle only where generated articles can be listed", () => {
    expect(hasImportanceFilter({ type: "unread" })).toBe(true);
    expect(hasImportanceFilter({ type: "generated" })).toBe(true);
    expect(hasImportanceFilter({ type: "category", categoryId: 7, generatedOnly: false })).toBe(true);
    expect(hasImportanceFilter({ type: "feeds" })).toBe(false);
    expect(hasImportanceFilter({ type: "feed", feedId: 1 })).toBe(false);
    expect(hasImportanceFilter({ type: "uncategorized" })).toBe(false);
    expect(hasImportanceFilter({ type: "recentlyRead" })).toBe(false);
    expect(hasImportanceFilter({ type: "annotations" })).toBe(false);
  });
});

describe("the order of a list", () => {
  const categories = [category(1, "Tools"), category(2, "Events", { kind: "event" })];
  const views = [
    { key: "feed-12", sort: "oldest" as const },
    { key: "category-1", sort: "oldest" as const },
    // The server would refuse these; a list whose order is fixed ignores them all the same.
    { key: "category-2", sort: "oldest" as const },
    { key: "recently-read", sort: "oldest" as const },
  ];

  it("follows the view of the entry, and is newest first for an entry without one", () => {
    expect(listSortOf({ type: "feed", feedId: 12 }, views, categories)).toBe("oldest");
    expect(listSortOf({ type: "category", categoryId: 1, generatedOnly: false }, views, categories)).toBe("oldest");
    expect(listSortOf({ type: "category", categoryId: 1, generatedOnly: true }, views, categories)).toBe("newest");
    expect(listSortOf({ type: "unread" }, views, categories)).toBe("newest");
    expect(listSortOf({ type: "unread" }, undefined, categories)).toBe("newest");
  });

  it("is newest first, without a menu, for an event category and the recently read articles", () => {
    expect(listSortOf({ type: "category", categoryId: 2, generatedOnly: false }, views, categories)).toBe("newest");
    expect(listSortOf({ type: "recentlyRead" }, views, categories)).toBe("newest");
    expect(hasSortMenu({ type: "category", categoryId: 2, generatedOnly: false }, categories)).toBe(false);
    expect(hasSortMenu({ type: "recentlyRead" }, categories)).toBe(false);
    for (const target of [{ type: "unread" }, { type: "all" }, { type: "starred" }, { type: "generated" }, { type: "feeds" }, { type: "uncategorized" }, { type: "feed", feedId: 12 }, { type: "category", categoryId: 1, generatedOnly: false }, { type: "category", categoryId: 1, generatedOnly: true }] as ListTarget[]) {
      expect(hasSortMenu(target, categories)).toBe(true);
    }
  });

  it("is asked of the server only when it is oldest first", () => {
    expect(targetFilter({ type: "feed", feedId: 12 }, "oldest")).toEqual({ feed: 12, order: "oldest" });
    expect(targetFilter({ type: "feed", feedId: 12 }, "newest")).toEqual({ feed: 12 });
    expect(targetFilter({ type: "unread" })).toEqual({ unread: "true" });
  });

  it("is kept under a key the server reads for every entry of the list but the recently read articles", () => {
    const model = buildNav({ categories: [category(1, "Tools")], feeds: [feed(12, "A", 1), feed(13, "B", null)], counts });
    const keys = [...model.views, ...model.groups.flatMap((group) => [group.entry, ...group.children])].map((entry) => listKey(entry.target));
    expect(keys).toEqual(["unread", "all", "starred", "generated", "feeds", "recently-read", "annotations", "category-1", "category-1-generated", "feed-12", "uncategorized", "feed-13"]);
    for (const key of keys) {
      if (key === "recently-read" || key === "annotations") expect(parseListViewKey(key)).toBeNull();
      else expect(parseListViewKey(key), key).not.toBeNull();
    }
  });
});
