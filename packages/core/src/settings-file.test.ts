import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { createCategory, findCategoryBySlug, listCategories } from "./db/categories.ts";
import { getSettings, updateSettings } from "./db/settings.ts";
import { applyInterpretation, createTopic, listTopics } from "./db/topics.ts";
import { exportSettings, importSettings } from "./settings-file.ts";
import { createTestDb, fakeClock } from "./testing/db.ts";

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
    expect(result).toEqual({ categoriesCreated: 1, categoriesUpdated: 1, topicsCreated: 1, topicsUpdated: 0 });
    expect(findCategoryBySlug(db, "security")).toMatchObject({ name: "Security", minImportance: 4 });
    expect(findCategoryBySlug(db, "local-events")).toMatchObject({ kind: "event", windowDays: 7 });
  });

  it("keeps categories and topics that the file does not mention", () => {
    const db = createTestDb();
    const cars = createCategory(db, { name: "Cars", kind: "news" }, clock);
    createTopic(db, cars.id, { text: "New models" }, clock);
    importSettings(db, "version: 1\ncategories:\n  - slug: security\n    name: Security\n    kind: news\n", clock);
    expect(listCategories(db).map((c) => c.slug)).toEqual(["cars", "security"]);
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
    });
    expect(getSettings(db).timeZone).toBe("America/Los_Angeles");
  });
});
