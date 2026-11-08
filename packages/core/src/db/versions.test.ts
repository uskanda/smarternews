import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { createCategory, updateCategory } from "./categories.ts";
import { applyInterpretation, createTopic, getTopic, requestInterpretation, restoreTopicVersion, updateTopic } from "./topics.ts";
import { listCategoryVersions, listTopicVersions } from "./versions.ts";

const sources = { newsSearch: true, llmSearch: false };

function setup() {
  const db = createTestDb();
  const clock = fakeClock("2026-03-01T00:00:00.000Z");
  const category = createCategory(db, { name: "Security", kind: "news" }, clock);
  return { db, clock, categoryId: category.id };
}

describe("topic versions", () => {
  it("makes one version when a topic is made, with its values", () => {
    const { db, clock, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Rust", search: { language: "en", region: "US" } }, clock);

    expect(listTopicVersions(db, topic.id)).toEqual([
      {
        id: expect.any(Number),
        topicId: topic.id,
        createdAt: "2026-03-01T00:00:00.000Z",
        trigger: "created",
        restoredFrom: null,
        text: "Rust",
        interpreted: false,
        queries: [],
        criteria: "",
        sources: { feeds: [], newsSearch: false, llmSearch: false },
        search: { language: "en", region: "US" },
      },
    ]);
  });

  it("adds a version for an edit and one for an interpretation, newest first", () => {
    const { db, clock, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Rust" }, clock);
    clock.set("2026-03-02T00:00:00.000Z");
    applyInterpretation(db, topic.id, { queries: ["rust"], criteria: "releases", suggestedSources: sources }, clock().toISOString());
    clock.set("2026-03-03T00:00:00.000Z");
    updateTopic(db, topic.id, { text: "Rust releases" }, clock);

    expect(listTopicVersions(db, topic.id).map((version) => [version.createdAt, version.trigger, version.text, version.interpreted, version.criteria])).toEqual([
      ["2026-03-03T00:00:00.000Z", "edited", "Rust releases", false, "releases"],
      ["2026-03-02T00:00:00.000Z", "interpreted", "Rust", true, "releases"],
      ["2026-03-01T00:00:00.000Z", "created", "Rust", false, ""],
    ]);
  });

  it("makes no version for a save of the same values, for switching the topic off, or for a request to interpret again", () => {
    const { db, clock, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Rust", sources: { feeds: [], newsSearch: true, llmSearch: false } }, clock);

    updateTopic(db, topic.id, { text: "Rust", sources: { newsSearch: true } }, clock);
    updateTopic(db, topic.id, { enabled: false }, clock);
    requestInterpretation(db, topic.id);

    expect(listTopicVersions(db, topic.id)).toHaveLength(1);
  });

  it("counts the search words, the sources and the search locale as kept values", () => {
    const { db, clock, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Rust" }, clock);

    updateTopic(db, topic.id, { queries: ["rust lang"] }, clock);
    updateTopic(db, topic.id, { sources: { feeds: ["https://example.org/feed"] } }, clock);
    updateTopic(db, topic.id, { search: { language: "ja", region: "JP" } }, clock);

    expect(listTopicVersions(db, topic.id).map((version) => version.trigger)).toEqual(["edited", "edited", "edited", "created"]);
  });

  it("marks the last version interpreted when an interpretation brings back the same values", () => {
    const { db, clock, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Rust" }, clock);
    applyInterpretation(db, topic.id, { queries: ["rust"], criteria: "releases", suggestedSources: sources });
    requestInterpretation(db, topic.id);
    updateTopic(db, topic.id, { text: "Rust 2" }, clock);
    updateTopic(db, topic.id, { text: "Rust" }, clock);

    applyInterpretation(db, topic.id, { queries: ["rust"], criteria: "releases", suggestedSources: sources });

    const [last] = listTopicVersions(db, topic.id);
    expect(last).toMatchObject({ trigger: "edited", text: "Rust", interpreted: true });
    expect(listTopicVersions(db, topic.id)).toHaveLength(4);
  });

  it("leaves the versions out when told to, for a settings file to make one of its own", () => {
    const { db, clock, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Rust" }, clock);

    updateTopic(db, topic.id, { queries: ["x"] }, clock, false);
    applyInterpretation(db, topic.id, { queries: ["rust"], criteria: "c", suggestedSources: sources }, undefined, false);

    expect(listTopicVersions(db, topic.id)).toHaveLength(1);
  });

  it("goes with its topic, and reports a missing topic", () => {
    const { db, clock, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Rust" }, clock);
    db.prepare("DELETE FROM topics WHERE id = ?").run(topic.id);

    expect(db.prepare("SELECT count(*) AS n FROM topic_versions").get()).toEqual({ n: 0 });
    expect(() => listTopicVersions(db, topic.id)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

describe("restoreTopicVersion", () => {
  function changed() {
    const s = setup();
    const topic = createTopic(s.db, s.categoryId, { text: "Rust" }, s.clock);
    s.clock.set("2026-03-02T00:00:00.000Z");
    applyInterpretation(s.db, topic.id, { queries: ["rust"], criteria: "A", suggestedSources: sources }, s.clock().toISOString());
    s.clock.set("2026-03-03T00:00:00.000Z");
    updateTopic(s.db, topic.id, { text: "Rust compiler" }, s.clock);
    s.clock.set("2026-03-04T00:00:00.000Z");
    applyInterpretation(s.db, topic.id, { queries: ["rustc"], criteria: "B", suggestedSources: { newsSearch: false, llmSearch: true } }, s.clock().toISOString());
    const versions = listTopicVersions(s.db, topic.id);
    return { ...s, topic, versions };
  }

  it("brings back an interpreted version as interpreted, from the time it went back", () => {
    const { db, clock, topic, versions } = changed();
    const target = versions.find((version) => version.criteria === "A" && version.interpreted)!;
    clock.set("2026-03-05T00:00:00.000Z");

    const restored = restoreTopicVersion(db, topic.id, target.id, clock);

    expect(restored).toMatchObject({
      text: "Rust",
      interpreted: true,
      queries: ["rust"],
      criteria: "A",
      sources: { feeds: [], newsSearch: true, llmSearch: false },
      sourcesSetByUser: true,
    });
    expect(db.prepare("SELECT interpreted_at FROM topics WHERE id = ?").get(topic.id)).toEqual({ interpreted_at: "2026-03-05T00:00:00.000Z" });
    const after = listTopicVersions(db, topic.id);
    expect(after).toHaveLength(versions.length + 1);
    expect(after[0]).toMatchObject({ trigger: "restored", restoredFrom: target.id, createdAt: "2026-03-05T00:00:00.000Z", criteria: "A", interpreted: true });
    expect(after.slice(1)).toEqual(versions);
  });

  it("brings back a version that was not interpreted as not interpreted", () => {
    const { db, clock, topic, versions } = changed();
    const target = versions.find((version) => version.trigger === "edited")!;

    const restored = restoreTopicVersion(db, topic.id, target.id, clock);

    expect(restored).toMatchObject({ text: "Rust compiler", interpreted: false });
    expect(listTopicVersions(db, topic.id)[0]).toMatchObject({ trigger: "restored", interpreted: false });
  });

  it("keeps whether the topic is enabled", () => {
    const { db, clock, topic, versions } = changed();
    updateTopic(db, topic.id, { enabled: false }, clock);

    expect(restoreTopicVersion(db, topic.id, versions.at(-1)!.id, clock).enabled).toBe(false);
  });

  it("refuses a version of another topic, and one that does not exist, changing nothing", () => {
    const { db, clock, categoryId, topic, versions } = changed();
    const other = createTopic(db, categoryId, { text: "Go" }, clock);
    const before = getTopic(db, other.id);

    expect(() => restoreTopicVersion(db, other.id, versions[0]!.id, clock)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => restoreTopicVersion(db, topic.id, 9999, clock)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(getTopic(db, other.id)).toEqual(before);
    expect(listTopicVersions(db, other.id)).toHaveLength(1);
    expect(listTopicVersions(db, topic.id)).toEqual(versions);
  });
});

describe("category versions", () => {
  it("makes one when the category is made and one for each change of the minimum or the limit, newest first", () => {
    const { db, clock, categoryId } = setup();
    clock.set("2026-03-02T00:00:00.000Z");
    updateCategory(db, categoryId, { minImportance: 4 }, clock);
    updateCategory(db, categoryId, { name: "Sec", schedule: ["06:00"], enabled: false }, clock);
    updateCategory(db, categoryId, { minImportance: 4, maxArticlesPerRun: 5 }, clock);
    clock.set("2026-03-03T00:00:00.000Z");
    updateCategory(db, categoryId, { maxArticlesPerRun: 8 }, clock, "settings-file");

    expect(listCategoryVersions(db, categoryId)).toEqual([
      { id: expect.any(Number), categoryId, createdAt: "2026-03-03T00:00:00.000Z", trigger: "settings-file", minImportance: 4, maxArticlesPerRun: 8 },
      { id: expect.any(Number), categoryId, createdAt: "2026-03-02T00:00:00.000Z", trigger: "edited", minImportance: 4, maxArticlesPerRun: 5 },
      { id: expect.any(Number), categoryId, createdAt: "2026-03-01T00:00:00.000Z", trigger: "created", minImportance: 3, maxArticlesPerRun: 5 },
    ]);
  });

  it("reports a missing category", () => {
    const { db } = setup();
    expect(() => listCategoryVersions(db, 42)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});
