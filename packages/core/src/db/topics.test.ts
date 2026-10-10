import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { createCategory } from "./categories.ts";
import { applyInterpretation, createTopic, getTopic, listTopics, updateTopic } from "./topics.ts";

const clock = fakeClock("2026-03-01T00:00:00.000Z");

function setup() {
  const db = createTestDb();
  const category = createCategory(db, { name: "Security", kind: "news" }, clock);
  return { db, categoryId: category.id };
}

describe("createTopic", () => {
  it("stores a topic given only its text as enabled and not yet interpreted", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "Vulnerabilities exploited in the wild" }, clock);
    expect(topic).toMatchObject({
      text: "Vulnerabilities exploited in the wild",
      enabled: true,
      interpreted: false,
      sources: { feeds: [], newsSearch: false, llmSearch: false },
      sourcesSetByUser: false,
      search: null,
    });
    expect(listTopics(db, categoryId)).toHaveLength(1);
  });

  it("treats an interpretation given at creation as done", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(
      db,
      categoryId,
      { text: "Rust releases", interpretation: { queries: ["rust release"], criteria: "official releases" } },
      clock,
    );
    expect(topic).toMatchObject({ interpreted: true, queries: ["rust release"], criteria: "official releases" });
  });

  it("reports a missing category", () => {
    const { db } = setup();
    expect(() => createTopic(db, 42, { text: "x" }, clock)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

describe("updateTopic", () => {
  it("marks the topic as not interpreted when its text changes", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "old" }, clock);
    applyInterpretation(db, topic.id, {
      queries: ["old"],
      criteria: "c",
      suggestedSources: { newsSearch: true, llmSearch: false },
    });
    expect(getTopic(db, topic.id).interpreted).toBe(true);

    expect(updateTopic(db, topic.id, { text: "new" }).interpreted).toBe(false);
  });

  it("keeps the interpretation when the text is sent unchanged", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "same" }, clock);
    applyInterpretation(db, topic.id, {
      queries: ["q"],
      criteria: "c",
      suggestedSources: { newsSearch: true, llmSearch: false },
    });
    expect(updateTopic(db, topic.id, { text: "same", enabled: false })).toMatchObject({ interpreted: true, enabled: false });
  });

  it("stores search queries edited by the user", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "t" }, clock);
    expect(updateTopic(db, topic.id, { queries: ["edited query"] }).queries).toEqual(["edited query"]);
  });

  it("stores a search language and region for the topic", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "t" }, clock);
    expect(updateTopic(db, topic.id, { search: { language: "en", region: "US" } }).search).toEqual({
      language: "en",
      region: "US",
    });
  });
});

describe("applyInterpretation", () => {
  it("sets the suggested sources when the user chose none", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "t" }, clock);
    const result = applyInterpretation(db, topic.id, {
      queries: ["a", "b"],
      criteria: "only official announcements",
      suggestedSources: { newsSearch: true, llmSearch: false },
    });
    expect(result).toMatchObject({
      interpreted: true,
      queries: ["a", "b"],
      criteria: "only official announcements",
      sources: { feeds: [], newsSearch: true, llmSearch: false },
    });
  });

  it("leaves sources chosen by the user untouched", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "t", sources: { llmSearch: true } }, clock);
    updateTopic(db, topic.id, { text: "t2" });
    const result = applyInterpretation(db, topic.id, {
      queries: ["a"],
      criteria: "c",
      suggestedSources: { newsSearch: true, llmSearch: false },
    });
    expect(result.sources).toEqual({ feeds: [], newsSearch: false, llmSearch: true });
  });

  it("stops suggesting once the user changes the sources", () => {
    const { db, categoryId } = setup();
    const topic = createTopic(db, categoryId, { text: "t" }, clock);
    updateTopic(db, topic.id, { sources: { feeds: ["https://example.org/feed.xml"] } });
    const result = applyInterpretation(db, topic.id, {
      queries: ["a"],
      criteria: "c",
      suggestedSources: { newsSearch: true, llmSearch: true },
    });
    expect(result.sources).toEqual({ feeds: ["https://example.org/feed.xml"], newsSearch: false, llmSearch: false });
  });
});
