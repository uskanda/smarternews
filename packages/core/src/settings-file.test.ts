import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { createCategory, findCategoryBySlug, listCategories, moveCategory } from "./db/categories.ts";
import { nextArticleToSummarize } from "./db/articles.ts";
import { insertFeed, listFeeds, moveFeed, updateFeed } from "./db/feeds.ts";
import { getSettings, updateSettings } from "./db/settings.ts";
import { createStopWord, listStopWords } from "./db/stop-words.ts";
import { applyInterpretation, createTopic, listTopics } from "./db/topics.ts";
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
    expect(result).toEqual({ categoriesCreated: 1, categoriesUpdated: 1, topicsCreated: 1, topicsUpdated: 0, feedsCreated: 0, feedsUpdated: 0, stopWordsCreated: 0 });
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

describe("subscribed feeds and stop words in the settings file", () => {
  function withFeeds() {
    const db = seeded();
    const security = listCategories(db).find((category) => category.slug === "security")!;
    insertFeed(db, { url: "https://a.example.org/feed.xml", title: "A", categoryId: security.id, intervalMinutes: 120 }, clock);
    const loose = insertFeed(db, { url: "https://b.example.org/feed.xml", title: "B", enabled: false }, clock);
    seedFeedArticle(db, loose.id);
    updateSettings(db, { feedIntervalMinutes: 45 });
    createStopWord(db, { text: "広告" }, clock);
    createStopWord(db, { text: "提供", scope: "title_and_content" }, clock);
    return db;
  }

  it("writes the feeds under their category or at the top, the base interval and the stop words", () => {
    const file = parse(exportSettings(withFeeds()));
    expect(file.settings.feedIntervalMinutes).toBe(45);
    expect(file.categories.find((category: { slug: string }) => category.slug === "security").subscriptions).toEqual([
      { url: "https://a.example.org/feed.xml", title: "A", intervalMinutes: 120, enabled: true },
    ]);
    expect(file.subscriptions).toEqual([{ url: "https://b.example.org/feed.xml", title: "B", enabled: false }]);
    expect(file.stopWords).toEqual([
      { text: "広告", scope: "title" },
      { text: "提供", scope: "title_and_content" },
    ]);
  });

  it("writes no article and no fetch state", () => {
    const text = exportSettings(withFeeds());
    expect(text).not.toMatch(/Feed article|lastFetched|etag|articleCount/);
  });

  it("reproduces feeds, base interval and stop words on an empty server", () => {
    const exported = exportSettings(withFeeds());
    const target = createTestDb();
    const result = importSettings(target, exported, clock);
    expect(result).toMatchObject({ feedsCreated: 2, feedsUpdated: 0, stopWordsCreated: 2 });
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

  it("adds the stop words that are not registered yet, and hides what they match", () => {
    const db = createTestDb();
    createStopWord(db, { text: "広告" }, clock);
    const feed = insertFeed(db, { url: "https://a.example.org/feed.xml", title: "A" }, clock);
    seedFeedArticle(db, feed.id, { title: "春の特売" });

    const result = importSettings(db, "version: 1\nstopWords:\n  - text: 広告\n  - text: 特売\n", clock);

    expect(result.stopWordsCreated).toBe(1);
    expect(listStopWords(db).map((word) => [word.text, word.hiddenCount])).toEqual([
      ["広告", 0],
      ["特売", 1],
    ]);
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
      stopWordsCreated: 2,
    });
    expect(getSettings(db)).toMatchObject({ timeZone: "America/Los_Angeles", feedIntervalMinutes: 30 });
    const tools = listCategories(db).find((category) => category.slug === "developer-tools")!;
    expect(listFeeds(db).map((feed) => [feed.categoryId, feed.intervalMinutes])).toEqual([
      [tools.id, null],
      [tools.id, 360],
      [null, null],
    ]);
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
