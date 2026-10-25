import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { createCategory, findCategoryBySlug, listCategories, moveCategory } from "./db/categories.ts";
import { nextArticleForFullContent, nextArticleToSummarize, recordFullContentFailure, saveFullContent } from "./db/articles.ts";
import { insertFeed, listFeeds, moveFeed, updateFeed } from "./db/feeds.ts";
import { getSettings, updateSettings } from "./db/settings.ts";
import { createFilter, listFilters, updateFilter } from "./db/filters.ts";
import { applyInterpretation, createTopic, listTopics } from "./db/topics.ts";
import { addHighlightTerm, createTermGroup, listTermGroups, moveTermGroup } from "./db/term-highlights.ts";
import { getListView, listListViews, updateListView } from "./db/list-views.ts";
import { exportSettings, importSettings } from "./settings-file.ts";
import { createTestDb, fakeClock, seedFeedArticle } from "./testing/db.ts";

const clock = fakeClock("2026-03-01T00:00:00.000Z");

function seeded() {
  const db = createTestDb();
  updateSettings(db, { readerInfo: "Maintains web services.", outputLanguage: "en", timeZone: "Europe/Berlin" });
  const security = createCategory(db, { name: "Security", kind: "news", schedule: ["06:00", "18:00"] }, clock);
  const events = createCategory(db, { name: "Local events", kind: "event" }, clock);
  const first = createTopic(db, security.id, { text: "Exploited vulnerabilities" }, clock);
  applyInterpretation(db, first.id, {
    queries: ["exploited vulnerability"],
    criteria: "confirmed exploitation",
    suggestedSources: { newsSearch: true, llmSearch: false },
  });
  createTopic(db, security.id, { text: "Ransomware", sources: { feeds: ["https://example.org/feed.xml"] } }, clock);
  createTopic(db, security.id, { text: "Supply chain attacks", enabled: false }, clock);
  createTopic(db, events.id, { text: "Maker fairs", search: { language: "en", region: "US" } }, clock);
  createTopic(db, events.id, { text: "Technology meetups", sources: { llmSearch: true } }, clock);
  return db;
}

describe("exportSettings", () => {
  it("writes every category, topic, the reader information and the global settings", () => {
    const file = parse(exportSettings(seeded()));
    expect(file.version).toBe(1);
    expect(file.settings).toEqual({
      readerInfo: "Maintains web services.",
      outputLanguage: "en",
      timeZone: "Europe/Berlin",
      search: { language: "ja", region: "JP" },
      feedIntervalMinutes: 30,
      advanceAfterMarkAll: true,
      removeDuplicates: true,
      staleFeedDays: 60,
    });
    expect(file.categories.map((c: { slug: string }) => c.slug)).toEqual(["security", "local-events"]);
    expect(file.categories.flatMap((c: { topics: unknown[] }) => c.topics)).toHaveLength(5);
    expect(file.categories[0].topics[0]).toEqual({
      text: "Exploited vulnerabilities",
      enabled: true,
      sources: { feeds: [], newsSearch: true, llmSearch: false },
      interpretation: { queries: ["exploited vulnerability"], criteria: "confirmed exploitation" },
    });
  });
});

describe("importSettings", () => {
  it("updates a category with a matching slug and creates the others", () => {
    const db = createTestDb();
    createCategory(db, { name: "Old name", slug: "security", kind: "news" }, clock);
    const result = importSettings(
      db,
      `version: 1
categories:
  - slug: security
    name: Security
    kind: news
    minImportance: 4
    topics:
      - text: Exploited vulnerabilities
  - slug: local-events
    name: Local events
    kind: event
`,
      clock,
    );
    expect(result).toEqual({ categoriesCreated: 1, categoriesUpdated: 1, topicsCreated: 1, topicsUpdated: 0, feedsCreated: 0, feedsUpdated: 0, filtersCreated: 0, termGroupsCreated: 0, highlightTermsCreated: 0, listViewsUpdated: 0 });
    expect(findCategoryBySlug(db, "security")).toMatchObject({ name: "Security", minImportance: 4 });
    expect(findCategoryBySlug(db, "local-events")).toMatchObject({ kind: "event", windowDays: 7 });
  });

  it("keeps categories and topics that the file does not mention", () => {
    const db = createTestDb();
    const cars = createCategory(db, { name: "Cars", kind: "news" }, clock);
    createTopic(db, cars.id, { text: "New models" }, clock);
    importSettings(db, "version: 1\ncategories:\n  - slug: security\n    name: Security\n    kind: news\n", clock);
    // the listed category comes first, and the one the file does not mention follows
    expect(listCategories(db).map((c) => c.slug)).toEqual(["security", "cars"]);
    expect(listTopics(db, cars.id)).toHaveLength(1);
  });

  it("updates a topic with the same text instead of adding a second one", () => {
    const db = createTestDb();
    const security = createCategory(db, { name: "Security", kind: "news" }, clock);
    createTopic(db, security.id, { text: "Ransomware" }, clock);
    const result = importSettings(
      db,
      `version: 1
categories:
  - slug: security
    name: Security
    kind: news
    topics:
      - text: Ransomware
        sources: { newsSearch: true }
`,
      clock,
    );
    expect(result).toMatchObject({ topicsCreated: 0, topicsUpdated: 1 });
    expect(listTopics(db, security.id)).toMatchObject([{ text: "Ransomware", sources: { newsSearch: true } }]);
  });

  it("changes nothing when one entry is invalid and names the entry", () => {
    const db = createTestDb();
    const text = `version: 1
settings:
  readerInfo: should not be stored
categories:
  - slug: first
    name: First
    kind: news
  - slug: second
    name: Second
    kind: weather
`;
    expect(() => importSettings(db, text, clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "categories.1.kind" })] }),
    );
    expect(listCategories(db)).toEqual([]);
    expect(getSettings(db).readerInfo).toBe("");
  });

  it("refuses text that is not YAML", () => {
    const db = createTestDb();
    expect(() => importSettings(db, "version: [1", clock)).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("refuses an unknown time zone without storing the categories", () => {
    const db = createTestDb();
    const text = "version: 1\nsettings:\n  timeZone: Mars/Olympus\ncategories:\n  - slug: a\n    name: A\n    kind: news\n";
    expect(() => importSettings(db, text, clock)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(listCategories(db)).toEqual([]);
  });

  it("reproduces the exported settings on an empty server", () => {
    const exported = exportSettings(seeded());
    const target = createTestDb();
    importSettings(target, exported, clock);
    expect(exportSettings(target)).toBe(exported);
  });
});

const condition = (value: string, fields: Array<"title" | "content" | "author" | "url"> = ["title"], match: "contains" | "regex" = "contains") => ({
  fields,
  match,
  value,
});

describe("subscribed feeds and filters in the settings file", () => {
  function withFeeds() {
    const db = seeded();
    const security = listCategories(db).find((category) => category.slug === "security")!;
    insertFeed(db, { url: "https://a.example.org/feed.xml", title: "A", categoryId: security.id, intervalMinutes: 120 }, clock);
    const loose = insertFeed(db, { url: "https://b.example.org/feed.xml", title: "B", enabled: false }, clock);
    seedFeedArticle(db, loose.id);
    updateSettings(db, { feedIntervalMinutes: 45 });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [condition("広告")] }, clock);
    const keep = createFilter(
      db,
      { action: "keep", scope: { type: "feed", feedId: loose.id }, conditions: [condition("提供", ["title", "content"]), condition("^v\\d", ["title"], "regex")] },
      clock,
    );
    createFilter(db, { action: "keep", scope: { type: "category", categoryId: security.id }, conditions: [condition("patch")] }, clock);
    updateFilter(db, keep.id, { enabled: false });
    return db;
  }

  it("writes the feeds under their category or at the top, the base interval and the filters", () => {
    const file = parse(exportSettings(withFeeds()));
    expect(file.settings.feedIntervalMinutes).toBe(45);
    expect(file.categories.find((category: { slug: string }) => category.slug === "security").subscriptions).toEqual([
      { url: "https://a.example.org/feed.xml", title: "A", intervalMinutes: 120, enabled: true },
    ]);
    expect(file.subscriptions).toEqual([{ url: "https://b.example.org/feed.xml", title: "B", enabled: false }]);
    expect(file.filters).toEqual([
      { action: "hide", scope: "all", conditions: [{ fields: ["title"], match: "contains", value: "広告" }] },
      {
        action: "keep",
        scope: { feed: "https://b.example.org/feed.xml" },
        enabled: false,
        conditions: [
          { fields: ["title", "content"], match: "contains", value: "提供" },
          { fields: ["title"], match: "regex", value: "^v\\d" },
        ],
      },
      { action: "keep", scope: { category: "security" }, conditions: [{ fields: ["title"], match: "contains", value: "patch" }] },
    ]);
    expect(file.stopWords).toBeUndefined();
  });

  it("writes no article and no fetch state", () => {
    const text = exportSettings(withFeeds());
    expect(text).not.toMatch(/Feed article|lastFetched|etag|articleCount|hiddenCount/);
  });

  it("reproduces feeds, base interval and filters on an empty server", () => {
    const exported = exportSettings(withFeeds());
    const target = createTestDb();
    const result = importSettings(target, exported, clock);
    expect(result).toMatchObject({ feedsCreated: 2, feedsUpdated: 0, filtersCreated: 3 });
    expect(exportSettings(target)).toBe(exported);
  });

  it("updates a feed with a matching URL, registers the others, and keeps what the file does not mention", () => {
    const db = createTestDb();
    const kept = insertFeed(db, { url: "https://kept.example.org/feed.xml", title: "Kept" }, clock);
    const existing = insertFeed(db, { url: "https://a.example.org/feed.xml", title: "A" }, clock);
    const article = seedFeedArticle(db, existing.id);
    const text = `version: 1
categories:
  - slug: tools
    name: Tools
    kind: news
    subscriptions:
      - url: https://a.example.org/feed.xml?utm_source=x
        intervalMinutes: 120
      - url: https://new.example.org/feed.xml
subscriptions:
  - url: https://loose.example.org/feed.xml
    title: Loose
`;
    const result = importSettings(db, text, clock);

    expect(result).toMatchObject({ feedsCreated: 2, feedsUpdated: 1 });
    const tools = listCategories(db)[0]!;
    const feeds = Object.fromEntries(listFeeds(db).map((feed) => [feed.url, feed]));
    expect(feeds["https://a.example.org/feed.xml"]).toMatchObject({ id: existing.id, title: "A", intervalMinutes: 120, categoryId: tools.id, articleCount: 1 });
    expect(feeds["https://new.example.org/feed.xml"]).toMatchObject({ title: "new.example.org", categoryId: tools.id, lastFetchedAt: null });
    expect(feeds["https://loose.example.org/feed.xml"]).toMatchObject({ title: "Loose", categoryId: null });
    expect(feeds["https://kept.example.org/feed.xml"]).toMatchObject({ id: kept.id });
    expect(db.prepare("SELECT category_id FROM articles WHERE id = ?").get(article)).toEqual({ category_id: tools.id });
  });

  it("adds the filters that are not registered yet, hides what they match, and takes the switch of the others", () => {
    const db = createTestDb();
    const known = createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [condition("広告")] }, clock);
    updateFilter(db, known.id, { enabled: false });
    const feed = insertFeed(db, { url: "https://a.example.org/feed.xml", title: "A" }, clock);
    seedFeedArticle(db, feed.id, { title: "春の特売" });
    const text = `version: 1
filters:
  - action: hide
    scope: all
    conditions:
      - { fields: [title], match: contains, value: 広告 }
  - action: hide
    scope: all
    conditions:
      - { fields: [title], match: contains, value: 特売 }
`;
    const result = importSettings(db, text, clock);

    expect(result.filtersCreated).toBe(1);
    expect(listFilters(db).map((filter) => [filter.conditions[0]!.value, filter.enabled, filter.hiddenCount])).toEqual([
      ["広告", true, 0],
      ["特売", true, 1],
    ]);
  });

  it("ties a scope to a feed the same file subscribes to", () => {
    const db = createTestDb();
    const text = `version: 1
subscriptions:
  - url: https://g.example.org/feed.xml
filters:
  - action: keep
    scope: { feed: https://g.example.org/feed.xml }
    conditions:
      - { fields: [title], match: contains, value: release }
`;
    importSettings(db, text, clock);
    const [feed] = listFeeds(db);
    expect(listFilters(db)).toMatchObject([{ action: "keep", scope: { type: "feed", feedId: feed!.id } }]);
  });

  it("refuses a scope that is neither in the file nor on the server, and stores nothing", () => {
    const db = createTestDb();
    const text = `version: 1
subscriptions:
  - url: https://g.example.org/feed.xml
filters:
  - action: keep
    scope: { feed: https://missing.example.org/feed.xml }
    conditions:
      - { fields: [title], match: contains, value: release }
`;
    expect(() => importSettings(db, text, clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "filters.0.scope.feed" })] }),
    );
    expect(() => importSettings(db, text.replace("{ feed: https://missing.example.org/feed.xml }", "{ category: missing }"), clock)).toThrow(
      expect.objectContaining({ fields: [expect.objectContaining({ path: "filters.0.scope.category" })] }),
    );
    expect(listFeeds(db)).toEqual([]);
    expect(listFilters(db)).toEqual([]);
  });

  it("refuses a regular expression it cannot use, and stores nothing", () => {
    const db = createTestDb();
    const text = `version: 1
subscriptions:
  - url: https://g.example.org/feed.xml
filters:
  - action: hide
    scope: all
    conditions:
      - { fields: [title], match: regex, value: "(sale" }
`;
    expect(() => importSettings(db, text, clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "filters.0.conditions.0.value" })] }),
    );
    expect(listFeeds(db)).toEqual([]);
  });

  it("reads the stop words of an older file as hide filters over everything", () => {
    const db = createTestDb();
    const feed = insertFeed(db, { url: "https://a.example.org/feed.xml", title: "A" }, clock);
    seedFeedArticle(db, feed.id, { title: "新製品", body: "提供の記事" });

    const result = importSettings(db, "version: 1\nstopWords:\n  - text: 広告\n  - text: 提供\n    scope: title_and_content\n", clock);

    expect(result.filtersCreated).toBe(2);
    expect(listFilters(db)).toMatchObject([
      { action: "hide", scope: { type: "all" }, enabled: true, conditions: [{ fields: ["title"], match: "contains", value: "広告" }], hiddenCount: 0 },
      { action: "hide", scope: { type: "all" }, enabled: true, conditions: [{ fields: ["title", "content"], match: "contains", value: "提供" }], hiddenCount: 1 },
    ]);
  });

  it("adds no filter for a stop word that is registered already", () => {
    const db = createTestDb();
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [condition("広告")] }, clock);
    const result = importSettings(db, "version: 1\nstopWords:\n  - text: 広告\n", clock);
    expect(result.filtersCreated).toBe(0);
    expect(listFilters(db)).toHaveLength(1);
  });

  it("refuses a feed under an event category, and stores nothing of the file", () => {
    const db = createTestDb();
    const text = `version: 1
categories:
  - slug: tools
    name: Tools
    kind: news
  - slug: events
    name: Events
    kind: event
    subscriptions:
      - url: https://a.example.org/feed.xml
`;
    expect(() => importSettings(db, text, clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "categories.1.subscriptions.0" })] }),
    );
    expect(listCategories(db)).toEqual([]);
    expect(listFeeds(db)).toEqual([]);
  });

  it("refuses an interval outside five minutes to one day", () => {
    const db = createTestDb();
    const text = "version: 1\nsubscriptions:\n  - url: https://a.example.org/feed.xml\n    intervalMinutes: 2\n";
    expect(() => importSettings(db, text, clock)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(listFeeds(db)).toEqual([]);
  });
});

describe("order and the move-on setting in the settings file", () => {
  const file = (slugs: string[], extra = "") =>
    `version: 1\n${extra}categories:\n${slugs.map((slug) => `  - slug: ${slug}\n    name: ${slug.toUpperCase()}\n    kind: news\n`).join("")}`;
  const slugs = (db: ReturnType<typeof createTestDb>) => listCategories(db).map((category) => category.slug);

  it("writes categories and feeds in their order, and an empty server takes that order over", () => {
    const db = createTestDb();
    importSettings(db, file(["a", "b"]), clock);
    const [a, b] = listCategories(db);
    insertFeed(db, { url: "https://x.example.org/feed.xml", title: "X", categoryId: a!.id }, clock);
    const y = insertFeed(db, { url: "https://y.example.org/feed.xml", title: "Y", categoryId: a!.id }, clock);
    moveCategory(db, b!.id, a!.id);
    moveFeed(db, y.id, { categoryId: a!.id, before: null });
    moveFeed(db, listFeeds(db).find((feed) => feed.title === "X")!.id, { categoryId: a!.id, before: null });

    const exported = exportSettings(db);
    const written = parse(exported);
    expect(written.categories.map((category: { slug: string }) => category.slug)).toEqual(["b", "a"]);
    expect(written.categories[1].subscriptions.map((entry: { title: string }) => entry.title)).toEqual(["Y", "X"]);

    const target = createTestDb();
    importSettings(target, exported, clock);
    expect(slugs(target)).toEqual(["b", "a"]);
    expect(listFeeds(target).map((feed) => feed.title)).toEqual(["Y", "X"]);
  });

  it("puts what the file lists first, in the file's order, and the rest after it", () => {
    const db = createTestDb();
    importSettings(db, file(["a", "b", "c"]), clock);
    importSettings(db, file(["c", "a"]), clock);
    expect(slugs(db)).toEqual(["c", "a", "b"]);
  });

  it("orders the feeds of a category the same way", () => {
    const db = createTestDb();
    for (const title of ["X", "Y", "Z"]) insertFeed(db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title }, clock);
    importSettings(db, "version: 1\nsubscriptions:\n  - url: https://z.example.org/feed.xml\n  - url: https://x.example.org/feed.xml\n", clock);
    expect(listFeeds(db).map((feed) => feed.title)).toEqual(["Z", "X", "Y"]);
  });

  it("writes the move-on setting, and a file without it leaves the stored value alone", () => {
    const db = createTestDb();
    updateSettings(db, { advanceAfterMarkAll: false });
    expect(parse(exportSettings(db)).settings.advanceAfterMarkAll).toBe(false);
    importSettings(db, "version: 1\nsettings:\n  readerInfo: someone\n", clock);
    expect(getSettings(db).advanceAfterMarkAll).toBe(false);
    importSettings(db, "version: 1\nsettings:\n  advanceAfterMarkAll: true\n", clock);
    expect(getSettings(db).advanceAfterMarkAll).toBe(true);
  });

  it("carries duplicate removal switched off to an empty server", () => {
    const db = createTestDb();
    updateSettings(db, { removeDuplicates: false });
    const written = exportSettings(db);
    expect(parse(written).settings.removeDuplicates).toBe(false);
    const empty = createTestDb();
    importSettings(empty, written, clock);
    expect(getSettings(empty).removeDuplicates).toBe(false);
  });

  it("leaves duplicate removal alone when the file does not mention it", () => {
    const db = createTestDb();
    updateSettings(db, { removeDuplicates: false });
    importSettings(db, "version: 1\nsettings:\n  readerInfo: someone\n", clock);
    expect(getSettings(db).removeDuplicates).toBe(false);
  });

  it("carries the days after which a feed counts as stale to an empty server", () => {
    const db = createTestDb();
    updateSettings(db, { staleFeedDays: 90 });
    const written = exportSettings(db);
    expect(parse(written).settings.staleFeedDays).toBe(90);
    const empty = createTestDb();
    importSettings(empty, written, clock);
    expect(getSettings(empty).staleFeedDays).toBe(90);
  });

  it("leaves the days after which a feed counts as stale alone when the file does not mention them", () => {
    const db = createTestDb();
    updateSettings(db, { staleFeedDays: 90 });
    importSettings(db, "version: 1\nsettings:\n  readerInfo: someone\n", clock);
    expect(getSettings(db).staleFeedDays).toBe(90);
  });
});

describe("the example settings file", () => {
  it("loads into an empty server", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const text = readFileSync(join(import.meta.dirname, "../../../examples/settings.example.yaml"), "utf8");
    const db = createTestDb();
    expect(importSettings(db, text, clock)).toEqual({
      categoriesCreated: 3,
      categoriesUpdated: 0,
      topicsCreated: 4,
      topicsUpdated: 0,
      feedsCreated: 3,
      feedsUpdated: 0,
      filtersCreated: 2,
      termGroupsCreated: 2,
      highlightTermsCreated: 3,
      listViewsUpdated: 1,
    });
    expect(listTermGroups(db).map((group) => [group.name, group.color, group.terms.map((term) => term.text)])).toEqual([
      ["Rust", "orange", ["Rust", "cargo"]],
      ["Standards", "purple", ["RFC"]],
    ]);
    expect(getSettings(db)).toMatchObject({ timeZone: "America/Los_Angeles", feedIntervalMinutes: 30 });
    const tools = listCategories(db).find((category) => category.slug === "developer-tools")!;
    expect(listFeeds(db).map((feed) => [feed.categoryId, feed.intervalMinutes])).toEqual([
      [tools.id, null],
      [tools.id, 360],
      [null, null],
    ]);
    expect(listFeeds(db).map((feed) => feed.fetchFullContent)).toEqual([false, true, false]);
  });
});

describe("summaries of feeds in the settings file", () => {
  const A = "https://a.example.org/feed.xml";
  const B = "https://b.example.org/feed.xml";
  const file = (line: string) => `version: 1\nsubscriptions:\n  - url: ${A}\n${line}`;

  it("writes the setting for the feeds that summarise only, and an empty server takes it over", () => {
    const db = createTestDb();
    insertFeed(db, { url: A, title: "A", autoSummarize: true }, clock);
    insertFeed(db, { url: B, title: "B" }, clock);
    const exported = exportSettings(db);
    const written = parse(exported) as { subscriptions: Array<Record<string, unknown>> };
    expect(written.subscriptions.map((entry) => entry.autoSummarize)).toEqual([true, undefined]);

    const target = createTestDb();
    importSettings(target, exported, clock);
    expect(listFeeds(target).map((feed) => [feed.url, feed.autoSummarize])).toEqual([[A, true], [B, false]]);
    expect(exportSettings(target)).toBe(exported);
  });

  it("registers a feed without the setting as not summarising, and leaves a known feed as it is", () => {
    const db = createTestDb();
    importSettings(db, file(""), clock);
    expect(listFeeds(db)[0]!.autoSummarize).toBe(false);

    updateFeed(db, listFeeds(db)[0]!.id, { autoSummarize: true }, clock);
    importSettings(db, file(""), clock);
    expect(listFeeds(db)[0]!.autoSummarize).toBe(true);
    importSettings(db, file("    autoSummarize: false\n"), clock);
    expect(listFeeds(db)[0]!.autoSummarize).toBe(false);
  });

  it("summarises none of the articles a feed already has when the file switches summaries on", () => {
    const local = fakeClock("2026-03-01T00:00:00.000Z");
    const db = createTestDb();
    const feed = insertFeed(db, { url: A, title: "A" }, local);
    seedFeedArticle(db, feed.id, { at: local().toISOString() });
    local.advance(60_000);

    importSettings(db, file("    autoSummarize: true\n"), local);

    expect(listFeeds(db)[0]!.autoSummarize).toBe(true);
    expect(nextArticleToSummarize(db)).toBeNull();
    local.advance(60_000);
    const later = seedFeedArticle(db, feed.id, { at: local().toISOString() });
    expect(nextArticleToSummarize(db)?.id).toBe(later);
  });

  it("refuses a setting that is not true or false", () => {
    expect(() => importSettings(createTestDb(), file("    autoSummarize: sometimes\n"), clock)).toThrow(/expected format/);
  });
});

describe("full content of feeds in the settings file", () => {
  const A = "https://a.example.org/feed.xml";
  const B = "https://b.example.org/feed.xml";
  const file = (line: string) => `version: 1\nsubscriptions:\n  - url: ${A}\n${line}`;

  it("writes the setting for the feeds that fetch full content only, and an empty server takes it over", () => {
    const db = createTestDb();
    insertFeed(db, { url: A, title: "A", fetchFullContent: true }, clock);
    insertFeed(db, { url: B, title: "B" }, clock);
    const exported = exportSettings(db);
    const written = parse(exported) as { subscriptions: Array<Record<string, unknown>> };
    expect(written.subscriptions.map((entry) => entry.fetchFullContent)).toEqual([true, undefined]);

    const target = createTestDb();
    importSettings(target, exported, clock);
    expect(listFeeds(target).map((feed) => [feed.url, feed.fetchFullContent])).toEqual([[A, true], [B, false]]);
    expect(exportSettings(target)).toBe(exported);
  });

  it("registers a feed without the setting as not fetching full content, and leaves a known feed as it is", () => {
    const db = createTestDb();
    importSettings(db, file(""), clock);
    expect(listFeeds(db)[0]!.fetchFullContent).toBe(false);

    updateFeed(db, listFeeds(db)[0]!.id, { fetchFullContent: true }, clock);
    importSettings(db, file(""), clock);
    expect(listFeeds(db)[0]!.fetchFullContent).toBe(true);
    importSettings(db, file("    fetchFullContent: false\n"), clock);
    expect(listFeeds(db)[0]!.fetchFullContent).toBe(false);
  });

  it("fetches the full content of none of the articles a feed already has when the file switches it on", () => {
    const local = fakeClock("2026-03-01T00:00:00.000Z");
    const db = createTestDb();
    const feed = insertFeed(db, { url: A, title: "A" }, local);
    seedFeedArticle(db, feed.id, { at: local().toISOString() });
    local.advance(60_000);

    importSettings(db, file("    fetchFullContent: true\n"), local);

    expect(listFeeds(db)[0]!.fetchFullContent).toBe(true);
    expect(nextArticleForFullContent(db)).toBeNull();
    local.advance(60_000);
    const later = seedFeedArticle(db, feed.id, { at: local().toISOString() });
    expect(nextArticleForFullContent(db)?.id).toBe(later);
  });

  it("writes neither the full content nor its state", () => {
    const db = createTestDb();
    const feed = insertFeed(db, { url: A, title: "A", fetchFullContent: true }, clock);
    const id = seedFeedArticle(db, feed.id, { at: clock().toISOString() });
    saveFullContent(db, id, { markdown: "Distinctive full text", text: "Distinctive full text", now: clock().toISOString() });
    const failed = seedFeedArticle(db, feed.id, { at: clock().toISOString() });
    recordFullContentFailure(db, failed, { reason: "http", detail: "404" });

    const exported = exportSettings(db);
    expect(exported).not.toContain("Distinctive");
    expect(exported).not.toMatch(/fullContent|fetched|failed|404/);
  });

  it("refuses a setting that is not true or false", () => {
    expect(() => importSettings(createTestDb(), file("    fetchFullContent: sometimes\n"), clock)).toThrow(/expected format/);
  });
});

describe("translation of a feed in the settings file", () => {
  const clock = fakeClock("2026-03-01T00:00:00.000Z");
  const A = "https://a.example.org/feed.xml";
  const B = "https://b.example.org/feed.xml";
  const file = (line: string) => `version: 1\nsubscriptions:\n  - url: ${A}\n${line}`;

  it("is written for the feeds that translate only, and an empty server takes it over", () => {
    const db = createTestDb();
    insertFeed(db, { url: A, title: "A", translate: true }, clock);
    insertFeed(db, { url: B, title: "B" }, clock);
    const exported = exportSettings(db);
    const written = parse(exported) as { subscriptions: Array<Record<string, unknown>> };
    expect(written.subscriptions.map((entry) => entry.translate)).toEqual([true, undefined]);

    const target = createTestDb();
    importSettings(target, exported, clock);
    expect(listFeeds(target).map((feed) => [feed.url, feed.translate])).toEqual([[A, true], [B, false]]);
    expect(exportSettings(target)).toBe(exported);
  });

  it("is off for a new feed without the line, and stays as it is for a known one", () => {
    const db = createTestDb();
    importSettings(db, file(""), clock);
    expect(listFeeds(db)[0]!.translate).toBe(false);

    updateFeed(db, listFeeds(db)[0]!.id, { translate: true }, clock);
    importSettings(db, file(""), clock);
    expect(listFeeds(db)[0]!.translate).toBe(true);
    importSettings(db, file("    translate: false\n"), clock);
    expect(listFeeds(db)[0]!.translate).toBe(false);
  });

  it("writes nothing about the key of the translation API", () => {
    const db = createTestDb();
    insertFeed(db, { url: A, title: "A", translate: true }, clock);
    expect(exportSettings(db)).not.toMatch(/key/i);
  });
});

describe("term groups in the settings file", () => {
  type Db = ReturnType<typeof createTestDb>;
  const add = (db: Db, name: string, color: "green" | "purple" | "pink" | "orange", ...terms: string[]) => {
    const group = createTermGroup(db, { name, color }, clock);
    for (const text of terms) addHighlightTerm(db, group.id, { text }, clock);
    return group;
  };
  const groups = (db: Db) => listTermGroups(db).map((group) => [group.name, group.color, group.terms.map((term) => term.text)]);
  const file = (termGroups: unknown) => `version: 1\ntermGroups: ${JSON.stringify(termGroups)}\n`;

  it("are written in their order, with name, colour and terms", () => {
    const db = createTestDb();
    const a = add(db, "A", "green", "規制", "関税");
    add(db, "B", "pink", "TSMC");
    moveTermGroup(db, a.id, null);
    expect(parse(exportSettings(db)).termGroups).toEqual([
      { name: "B", color: "pink", terms: ["TSMC"] },
      { name: "A", color: "green", terms: ["規制", "関税"] },
    ]);
  });

  it("are not written when there are none", () => {
    expect(parse(exportSettings(createTestDb()))).not.toHaveProperty("termGroups");
  });

  it("are matched by name: a known group takes the file's colour, a new one is registered", () => {
    const db = createTestDb();
    add(db, "A", "green");
    const result = importSettings(db, file([{ name: "A", color: "purple" }, { name: "B", color: "orange", terms: ["関税"] }]), clock);
    expect(groups(db)).toEqual([
      ["A", "purple", []],
      ["B", "orange", ["関税"]],
    ]);
    expect(result).toMatchObject({ termGroupsCreated: 1, highlightTermsCreated: 1 });
  });

  it("only add terms: a registered term is not added twice, and a term the file leaves out stays", () => {
    const db = createTestDb();
    add(db, "A", "green", "規制", "関税");
    const result = importSettings(db, file([{ name: "A", color: "green", terms: ["規制", "補助金", "ＴＳＭＣ", "tsmc"] }]), clock);
    expect(groups(db)).toEqual([["A", "green", ["規制", "関税", "補助金", "ＴＳＭＣ"]]]);
    expect(result).toMatchObject({ termGroupsCreated: 0, highlightTermsCreated: 2 });
  });

  it("keep a group the file does not mention, with its terms, after those it does in the file's order", () => {
    const db = createTestDb();
    add(db, "A", "green");
    add(db, "B", "green", "規制");
    add(db, "C", "green");
    importSettings(db, file([{ name: "C", color: "green" }, { name: "A", color: "green" }]), clock);
    expect(listTermGroups(db).map((group) => group.name)).toEqual(["C", "A", "B"]);
    expect(groups(db)[2]).toEqual(["B", "green", ["規制"]]);
  });

  it("refuse a colour outside the four, and store nothing of the file", () => {
    const db = createTestDb();
    const text = `version: 1\nsettings: { readerInfo: changed }\ntermGroups: [{ name: A, color: yellow }]\n`;
    expect(() => importSettings(db, text, clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "termGroups.0.color" })] }),
    );
    expect(listTermGroups(db)).toEqual([]);
    expect(getSettings(db).readerInfo).not.toBe("changed");
  });

  it("make the same file again on an empty server", () => {
    const db = createTestDb();
    const a = add(db, "A", "green", "規制", "関税");
    add(db, "B", "purple", "TSMC");
    add(db, "C", "orange");
    moveTermGroup(db, a.id, null);
    const written = exportSettings(db);
    const other = createTestDb();
    importSettings(other, written, clock);
    expect(exportSettings(other)).toBe(written);
  });
});

describe("list views in the settings file", () => {
  const FEED = "https://a.example.org/feed.xml";
  function changed() {
    const db = createTestDb();
    const tools = createCategory(db, { name: "Tools", slug: "tools", kind: "news" }, clock);
    const feed = insertFeed(db, { url: FEED, title: "A", categoryId: tools.id }, clock);
    return { db, tools, feed };
  }
  const views = (db: ReturnType<typeof createTestDb>) => listListViews(db).items;

  it("are written for the entries that were changed, a category by its slug and a feed by its URL", () => {
    const { db, tools, feed } = changed();
    updateListView(db, "unread", { sort: "oldest" });
    updateListView(db, `category-${tools.id}`, { sort: "oldest" });
    updateListView(db, `category-${tools.id}-generated`, { sort: "oldest" });
    updateListView(db, `feed-${feed.id}`, { sort: "oldest" });
    updateListView(db, "starred", { sort: "oldest" });
    updateListView(db, "starred", { sort: "newest" });

    expect(parse(exportSettings(db)).listViews).toEqual([
      { list: "unread", sort: "oldest" },
      { list: { category: "tools" }, sort: "oldest" },
      { list: { category: "tools", generatedOnly: true }, sort: "oldest" },
      { list: { feed: FEED }, sort: "oldest" },
    ]);
  });

  it("are not written by a server where nothing was changed", () => {
    expect(parse(exportSettings(changed().db))).not.toHaveProperty("listViews");
  });

  it("tie an entry to a feed the same file subscribes to, and count what they set", () => {
    const db = createTestDb();
    const text = [
      "version: 1",
      "categories:",
      "  - { slug: tools, name: Tools, kind: news, subscriptions: [{ url: 'https://g.example.org/feed.xml' }] }",
      "listViews:",
      "  - { list: { feed: 'https://g.example.org/feed.xml' }, sort: oldest }",
      "  - { list: { category: tools, generatedOnly: true }, sort: oldest }",
      "  - { list: all, sort: oldest }",
    ].join("\n");

    const result = importSettings(db, text, clock);

    const feed = listFeeds(db)[0]!;
    const tools = findCategoryBySlug(db, "tools")!;
    expect(views(db)).toEqual([
      { key: `feed-${feed.id}`, sort: "oldest" },
      { key: `category-${tools.id}-generated`, sort: "oldest" },
      { key: "all", sort: "oldest" },
    ]);
    expect(result.listViewsUpdated).toBe(3);
  });

  it("leave the entries the file does not name as they are, and take the defaults the file names", () => {
    const { db, tools } = changed();
    updateListView(db, "starred", { sort: "oldest" });
    updateListView(db, `category-${tools.id}`, { sort: "oldest" });

    importSettings(db, "version: 1\nlistViews: [{ list: { category: tools }, sort: newest }, { list: unread }]\n", clock);

    expect(views(db)).toEqual([{ key: "starred", sort: "oldest" }]);
    expect(parse(exportSettings(db)).listViews).toEqual([{ list: "starred", sort: "oldest" }]);
  });

  it("refuse the whole file for a category or feed found nowhere, an event category, or an entry named twice", () => {
    const { db } = changed();
    createCategory(db, { name: "Events", slug: "events", kind: "event" }, clock);
    const refused: Array<[string, string]> = [
      ["{ list: { category: nowhere }, sort: oldest }", "listViews.0.list.category"],
      ["{ list: { feed: 'https://nowhere.example.org/feed.xml' }, sort: oldest }", "listViews.0.list.feed"],
      ["{ list: { category: events }, sort: oldest }", "listViews.0.list.category"],
      ["{ list: { category: events, generatedOnly: true }, sort: oldest }", "listViews.0.list.category"],
      [`{ list: { feed: '${FEED}' }, sort: oldest }, { list: { feed: '${FEED}' }, sort: newest }`, "listViews.1.list"],
      ["{ list: unread, sort: oldest }, { list: unread, sort: oldest }", "listViews.1.list"],
      ["{ list: recentlyRead, sort: oldest }", "listViews.0.list"],
      ["{ list: unread, sort: random }", "listViews.0.sort"],
    ];
    for (const [entries, path] of refused) {
      const text = `version: 1\nsettings: { readerInfo: changed }\nlistViews: [${entries}]\n`;
      expect(() => importSettings(db, text, clock), entries).toThrow(
        expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: expect.stringMatching(new RegExp(`^${path.replaceAll(".", "\\.")}`)) })] }),
      );
      expect(views(db)).toEqual([]);
      expect(getSettings(db).readerInfo).not.toBe("changed");
    }
  });

  it("make the same file again on an empty server, with the same entries oldest first and the others newest first", () => {
    const { db, tools, feed } = changed();
    updateListView(db, "all", { sort: "oldest" });
    updateListView(db, `category-${tools.id}-generated`, { sort: "oldest" });
    updateListView(db, `feed-${feed.id}`, { sort: "oldest" });
    const written = exportSettings(db);

    const other = createTestDb();
    importSettings(other, written, clock);

    expect(exportSettings(other)).toBe(written);
    const otherTools = findCategoryBySlug(other, "tools")!;
    const otherFeed = listFeeds(other)[0]!;
    expect(views(other)).toEqual([
      { key: "all", sort: "oldest" },
      { key: `category-${otherTools.id}-generated`, sort: "oldest" },
      { key: `feed-${otherFeed.id}`, sort: "oldest" },
    ]);
    expect(getListView(other, `category-${otherTools.id}`).sort).toBe("newest");
    expect(getListView(other, "unread").sort).toBe("newest");
  });
});
