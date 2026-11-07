import { describe, expect, it } from "vitest";
import type { LlmRequest } from "../llm/adapter.ts";
import { insertCandidate, markSeen, rejectCandidates } from "../db/candidates.ts";
import { createCategory } from "../db/categories.ts";
import { createRun } from "../db/runs.ts";
import { updateSettings } from "../db/settings.ts";
import { applyInterpretation, createTopic } from "../db/topics.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { fakeLlm, materialLines, type FakeHandler } from "../testing/llm.ts";
import { planTopicTrial } from "./trial.ts";

const interpretation = { queries: ["rust 2.0"], criteria: "Only releases of the Rust compiler.", suggestedSources: { newsSearch: true, llmSearch: false } };

interface Line {
  id: number;
  title: string;
  topicIds: number[];
}

/** A judge that accepts the candidates whose title holds "release", with importance 4, or 2 for "minor". */
const judgeByTitle: FakeHandler = (request) => ({
  judgments: materialLines<Line>(request.prompt).map((line) => ({
    id: line.id,
    relevant: line.title.includes("release"),
    reason: line.title.includes("release") ? "a release" : "not a release",
    importance: line.title.includes("minor") ? 2 : 4,
  })),
});

function setup(options: { judge?: FakeHandler; count?: { accepted: number; rejected: number }; limits?: { topicTrialsPerDay?: number } } = {}) {
  const db = createTestDb();
  const clock = fakeClock("2026-03-20T00:00:00.000Z");
  updateSettings(db, { outputLanguage: "ja" });
  const category = createCategory(db, { name: "Rust", kind: "news", minImportance: 3 }, clock);
  const topic = applyInterpretation(db, createTopic(db, category.id, { text: "Rust news" }, clock).id, {
    queries: ["rust"],
    criteria: "Anything about Rust.",
    suggestedSources: { newsSearch: true, llmSearch: false },
  });
  const other = applyInterpretation(db, createTopic(db, category.id, { text: "Go news" }, clock).id, {
    queries: ["go"],
    criteria: "Anything about Go.",
    suggestedSources: { newsSearch: true, llmSearch: false },
  });
  const run = createRun(db, { categoryId: category.id, trigger: "manual", slot: null }, clock);
  let n = 0;
  const add = (status: "pending" | "rejected", title: string, reason: string, topicIds = [topic.id]) => {
    n += 1;
    const now = new Date(Date.parse("2026-03-01T00:00:00.000Z") + n * 3_600_000).toISOString();
    const id = insertCandidate(db, {
      categoryId: category.id,
      runId: run.id,
      url: `https://example.org/${n}`,
      fetchable: true,
      title,
      snippet: "",
      siteName: "Example",
      publishedAt: now,
      sourceKind: "feed",
      status,
      reason,
      importance: status === "pending" ? 4 : 1,
      topicIds,
      now,
    });
    markSeen(db, category.id, [`https://example.org/${n}`], now);
    return id;
  };
  const llm = fakeLlm(db, clock, { interpret: () => interpretation, judge: options.judge ?? judgeByTitle }, { limits: { llmCallsPerRun: 40, llmCallsPerDay: 300, ...options.limits } });
  const deps = { db, runner: llm.runner, judgeBatchSize: 30 };
  return { db, clock, category, topic, other, run, add, requests: llm.requests, runner: llm.runner, deps };
}

const snapshot = (db: ReturnType<typeof createTestDb>) =>
  Object.fromEntries(["topics", "candidates", "candidate_topics", "seen_urls", "articles", "runs"].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

function judgeTopics(request: LlmRequest): string[] {
  return request.prompt.split("\n").filter((line) => line.startsWith("- topic ") || line.startsWith("  relevance test: "));
}

describe("a topic trial", () => {
  it("interprets the draft once and judges two batches of sixty candidates", async () => {
    const s = setup();
    for (let i = 0; i < 40; i += 1) s.add("pending", `Rust story ${i}`, "relevant");
    for (let i = 0; i < 40; i += 1) s.add("rejected", `Rust release ${i}`, "advertising");

    const plan = planTopicTrial(s.deps, s.topic.id, { text: "Rust compiler releases", search: { language: "en", region: "US" } });
    expect(plan.calls).toBe(3);
    expect(plan.blocked).toBeNull();
    const result = await plan.run();

    expect(s.requests.interpret).toHaveLength(1);
    expect(s.requests.interpret[0]!.prompt).toContain("Rust compiler releases");
    expect(s.requests.interpret[0]!.prompt).toContain("Search language: en. Search region: US.");
    expect(s.requests.judge).toHaveLength(2);
    expect(result).toMatchObject({ queries: ["rust 2.0"], criteria: interpretation.criteria, tried: 60, minImportance: 3 });
    // 30 of each side; every one is turned around by the judge that only wants releases.
    expect(result.changes).toHaveLength(60);
    expect(s.runner.topicTrialsToday()).toBe(3);
    expect(s.db.prepare("SELECT count(*) AS n FROM llm_calls WHERE purpose = 'trial' AND run_id IS NULL").get()).toEqual({ n: 3 });
  });

  it("replaces only the tried topic in what the judge reads, and keeps the other topics a candidate matched", async () => {
    const s = setup();
    s.add("pending", "Rust and Go story", "relevant", [s.topic.id, s.other.id]);

    await planTopicTrial(s.deps, s.topic.id, { text: "Rust compiler releases" }).run();

    expect(judgeTopics(s.requests.judge[0]!)).toEqual([
      `- topic ${s.topic.id}: Rust compiler releases`,
      `  relevance test: ${interpretation.criteria}`,
      `- topic ${s.other.id}: Go news`,
      "  relevance test: Anything about Go.",
    ]);
    expect(s.requests.interpret[0]!.prompt).toContain("Search language: ja. Search region: JP.");
  });

  it("gives each batch the time its newest candidate was made as the current time", async () => {
    const s = setup();
    for (let i = 0; i < 31; i += 1) s.add(i % 2 === 0 ? "pending" : "rejected", `Story ${i}`, "x");
    const plan = planTopicTrial({ ...s.deps, judgeBatchSize: 20 }, s.topic.id, { text: "Rust" });
    expect(plan.calls).toBe(3);
    await plan.run();

    const times = s.requests.judge.map((request) => /Current time: (\S+)/.exec(request.prompt)![1]);
    // Candidates are made an hour apart from 01:00 on: the 20th and the 31st.
    expect(times).toEqual(["2026-03-01T20:00:00.000Z", "2026-03-02T07:00:00.000Z"]);
  });

  it("reports the candidates whose verdict turns around, with the old and new reasons", async () => {
    const s = setup();
    const kept = s.add("pending", "Rust release 1.90", "relevant");
    const dropped = s.add("pending", "Rust conference", "relevant");
    const below = s.add("pending", "Rust story", "relevant");
    rejectCandidates(s.db, [below], "重要度が基準未満", s.run.id);
    const gained = s.add("rejected", "Rust minor release", "advertising");
    const ignored = s.add("rejected", "Rust blog", "off topic");

    const result = await planTopicTrial(s.deps, s.topic.id, { text: "Rust releases" }).run();

    expect(result.tried).toBe(5);
    const byId = new Map(result.changes.map((change) => [change.candidateId, change]));
    expect([...byId.keys()].sort()).toEqual([dropped, below, gained].sort());
    expect(byId.has(kept) || byId.has(ignored)).toBe(false);
    expect(byId.get(dropped)).toMatchObject({
      title: "Rust conference",
      url: "https://example.org/2",
      before: { verdict: "accepted", reason: "relevant", byProgram: false },
      after: { verdict: "rejected", reason: "not a release", importance: 4 },
      belowMinimum: false,
    });
    expect(byId.get(below)).toMatchObject({ before: { verdict: "accepted", reason: "重要度が基準未満", byProgram: true }, after: { verdict: "rejected" } });
    expect(byId.get(gained)).toMatchObject({ before: { verdict: "rejected", reason: "advertising" }, after: { verdict: "accepted", importance: 2 }, belowMinimum: true });
  });

  it("changes nothing but the record of its model calls", async () => {
    const s = setup();
    s.add("pending", "Rust conference", "relevant");
    s.add("rejected", "Rust release", "advertising");
    const before = snapshot(s.db);

    await planTopicTrial(s.deps, s.topic.id, { text: "Rust releases" }).run();

    expect(snapshot(s.db)).toEqual(before);
  });

  it("calls the interpret task alone for a topic without candidates", async () => {
    const s = setup();
    const plan = planTopicTrial(s.deps, s.topic.id, { text: "Rust releases" });
    expect(plan.calls).toBe(1);
    await expect(plan.run()).resolves.toMatchObject({ tried: 0, changes: [] });
    expect(s.requests.judge).toHaveLength(0);
  });

  it("says when the allowance of trials leaves too few calls", () => {
    const s = setup({ limits: { topicTrialsPerDay: 2 } });
    s.add("pending", "Rust conference", "relevant");
    s.add("pending", "Rust conference", "relevant");
    expect(planTopicTrial({ ...s.deps, judgeBatchSize: 1 }, s.topic.id, { text: "Rust" }).blocked).toBe("limit");
    expect(planTopicTrial(s.deps, s.topic.id, { text: "Rust" }).blocked).toBeNull();
  });
});
