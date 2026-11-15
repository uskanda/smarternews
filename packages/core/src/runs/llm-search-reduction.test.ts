import { describe, expect, it } from "vitest";
import { createCategory } from "../db/categories.ts";
import { createRun } from "../db/runs.ts";
import { recordSearchAttempt, type SearchAttempt } from "../db/search-attempts.ts";
import { createTopic, deleteTopic, getTopic, updateTopic } from "../db/topics.ts";
import { DomainError } from "../errors.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { emptyStreak, isLlmSearchReduced, llmSearchedSince, llmSearchReduction, restoreLlmSearch } from "./llm-search-reduction.ts";

const NOW = "2026-03-01T12:00:00.000Z";

function attempt(id: number, returned: number, overrides: Partial<SearchAttempt> = {}): SearchAttempt {
  return {
    id,
    runId: id,
    topicId: 1,
    kind: "llm-search",
    engine: null,
    query: "Topic",
    ok: true,
    returned,
    googleAttempted: 0,
    googleUnresolved: 0,
    createdAt: NOW,
    ...overrides,
  };
}

describe("the streak that cuts web search by the model", () => {
  it("is the trailing attempts without a new candidate, once there are three", () => {
    expect(emptyStreak([attempt(1, 2), attempt(2, 0), attempt(3, 0)], "Topic", 0)).toBeNull();
    expect(emptyStreak([attempt(1, 2), attempt(2, 0), attempt(3, 0), attempt(4, 0)], "Topic", 0)?.map((entry) => entry.id)).toEqual([2, 3, 4]);
  });

  it("ends when an attempt finds a new candidate", () => {
    expect(emptyStreak([attempt(1, 0), attempt(2, 0), attempt(3, 0), attempt(4, 1)], "Topic", 0)).toBeNull();
  });

  it("leaves out the attempts that failed", () => {
    const attempts = [attempt(1, 0), attempt(2, 0, { ok: false }), attempt(3, 0), attempt(4, 0)];
    expect(emptyStreak(attempts, "Topic", 0)?.map((entry) => entry.id)).toEqual([1, 3, 4]);
    expect(emptyStreak([attempt(1, 0), attempt(2, 0, { ok: false }), attempt(3, 0)], "Topic", 0)).toBeNull();
  });

  it("counts only the attempts made with the topic's current text", () => {
    const attempts = [attempt(1, 0, { query: "Old" }), attempt(2, 0, { query: "Old" }), attempt(3, 0), attempt(4, 0)];
    expect(emptyStreak(attempts, "Topic", 0)).toBeNull();
  });

  it("counts only the attempts after the one the user put the search back from", () => {
    const attempts = [attempt(1, 0), attempt(2, 0), attempt(3, 0), attempt(4, 0), attempt(5, 0)];
    expect(emptyStreak(attempts, "Topic", 3)).toBeNull();
    expect(emptyStreak([...attempts, attempt(6, 0)], "Topic", 3)?.map((entry) => entry.id)).toEqual([4, 5, 6]);
  });
});

describe("the topic's web search by the model, from the record", () => {
  function setup() {
    const db = createTestDb();
    const clock = fakeClock(NOW);
    const category = createCategory(db, { name: "News", kind: "news" }, clock);
    const topic = createTopic(db, category.id, { text: "Topic", sources: { llmSearch: true } }, clock);
    const search = (returned: number, overrides: { ok?: boolean; createdAt?: string; query?: string } = {}) => {
      const run = createRun(db, { categoryId: category.id, trigger: "schedule", slot: null }, clock);
      recordSearchAttempt(db, {
        runId: run.id,
        topicId: topic.id,
        kind: "llm-search",
        engine: null,
        query: overrides.query ?? "Topic",
        ok: overrides.ok ?? true,
        returned,
        googleAttempted: 0,
        googleUnresolved: 0,
        createdAt: overrides.createdAt ?? NOW,
      });
    };
    return { db, clock, topic, search };
  }

  it("is cut after three attempts in a row without a new candidate, and shows so on the topic", () => {
    const { db, topic, search } = setup();
    search(0);
    search(0);
    expect(isLlmSearchReduced(db, topic)).toBe(false);
    search(0);
    expect(isLlmSearchReduced(db, topic)).toBe(true);
    expect(getTopic(db, topic.id).llmSearchReduced).toBe(true);
  });

  it("is not cut for a topic without web search by the model", () => {
    const { db, clock, topic, search } = setup();
    for (let index = 0; index < 3; index += 1) search(0);
    updateTopic(db, topic.id, { sources: { llmSearch: false } }, clock);
    expect(llmSearchReduction(db, getTopic(db, topic.id))).toBeNull();
    expect(getTopic(db, topic.id).llmSearchReduced).toBe(false);
  });

  it("goes back to every run when the user restores it, and is cut again after three more", () => {
    const { db, clock, topic, search } = setup();
    for (let index = 0; index < 3; index += 1) search(0);
    restoreLlmSearch(db, topic.id, clock);
    expect(getTopic(db, topic.id).llmSearchReduced).toBe(false);
    search(0);
    search(0);
    expect(isLlmSearchReduced(db, topic)).toBe(false);
    search(0);
    expect(isLlmSearchReduced(db, topic)).toBe(true);
  });

  it("refuses to restore a topic that does not exist, and forgets the restore with the topic", () => {
    const { db, clock, topic } = setup();
    expect(() => restoreLlmSearch(db, 999, clock)).toThrow(DomainError);
    restoreLlmSearch(db, topic.id, clock);
    deleteTopic(db, topic.id);
    expect(db.prepare("SELECT * FROM llm_search_resets").all()).toEqual([]);
  });

  it("tells whether a search that did not fail was made since a time", () => {
    const { db, topic, search } = setup();
    search(0, { ok: false, createdAt: "2026-03-01T06:00:00.000Z" });
    expect(llmSearchedSince(db, topic.id, "2026-03-01T00:00:00.000Z")).toBe(false);
    search(0, { createdAt: "2026-02-28T18:00:00.000Z" });
    expect(llmSearchedSince(db, topic.id, "2026-03-01T00:00:00.000Z")).toBe(false);
    search(0, { createdAt: "2026-03-01T06:00:00.000Z" });
    expect(llmSearchedSince(db, topic.id, "2026-03-01T00:00:00.000Z")).toBe(true);
  });
});
