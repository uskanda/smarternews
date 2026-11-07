import { applyInterpretation, createRun, createTopic, insertCandidate } from "@smarternews/core";
import { materialLines, type FakeHandler } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const interpretation = { queries: ["rust 2.0"], criteria: "Only compiler releases.", suggestedSources: { newsSearch: true, llmSearch: false } };

/** Accepts only the candidates whose title holds "release". */
const judge: FakeHandler = (request) => ({
  judgments: materialLines<{ id: number; title: string }>(request.prompt).map((line) => ({
    id: line.id,
    relevant: line.title.includes("release"),
    reason: line.title.includes("release") ? "a release" : "not a release",
    importance: 4,
  })),
});

function seeded(options: Parameters<typeof testServer>[1] = {}) {
  const s = testServer("2026-03-20T00:00:00.000Z", { interpret: () => interpretation, judge, ...options });
  const category = s.category("Rust");
  const topic = applyInterpretation(s.db, createTopic(s.db, category.id, { text: "Rust news" }, s.clock).id, {
    queries: ["rust"],
    criteria: "Anything about Rust.",
    suggestedSources: { newsSearch: true, llmSearch: false },
  });
  const run = createRun(s.db, { categoryId: category.id, trigger: "manual", slot: null }, s.clock);
  const add = (status: "pending" | "rejected", title: string, reason: string) =>
    insertCandidate(s.db, {
      categoryId: category.id,
      runId: run.id,
      url: `https://example.org/${encodeURIComponent(title)}`,
      fetchable: true,
      title,
      snippet: "",
      siteName: "Example",
      publishedAt: "2026-03-19T00:00:00.000Z",
      sourceKind: "feed",
      status,
      reason,
      importance: 3,
      topicIds: [topic.id],
      now: "2026-03-19T00:00:00.000Z",
    });
  return { ...s, category, topic, add };
}

const tables = (db: ReturnType<typeof testServer>["db"]) =>
  ["topics", "candidates", "candidate_topics", "seen_urls", "articles"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

describe("the topic trials API", () => {
  it("starts a trial at once and answers its result when asked, without changing the topic or its candidates", async () => {
    const s = seeded();
    s.add("pending", "Rust conference", "relevant");
    s.add("rejected", "Rust release 1.90", "advertising");
    const before = tables(s.db);

    const started = await s.post(`/api/v1/topics/${s.topic.id}/trials`, { text: "Rust compiler releases", search: null });
    expect(started.status).toBe(202);
    const { status, id } = await started.json();
    expect(status).toBe("started");
    expect(typeof id).toBe("string");
    await s.trials.idle();

    const answer = await s.get(`/api/v1/topic-trials/${id}`);
    expect(answer.status).toBe(200);
    const trial = await answer.json();
    expect(trial).toMatchObject({ id, topicId: s.topic.id, status: "succeeded", stoppedBy: null, error: null });
    expect(trial.result).toMatchObject({ queries: ["rust 2.0"], tried: 2 });
    expect(trial.result.changes.map((change: { title: string }) => change.title).sort()).toEqual(["Rust conference", "Rust release 1.90"]);
    expect(s.llmRequests.interpret[0]!.prompt).toContain("Rust compiler releases");
    expect(tables(s.db)).toEqual(before);
  });

  it("answers that a trial is running, and refuses a second one meanwhile", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const s = seeded({
      interpret: async () => {
        await gate;
        return interpretation;
      },
    });
    const { id } = await (await s.post(`/api/v1/topics/${s.topic.id}/trials`, { text: "Rust releases" })).json();
    expect((await (await s.get(`/api/v1/topic-trials/${id}`)).json()).status).toBe("running");

    const second = await s.post(`/api/v1/topics/${s.topic.id}/trials`, { text: "Rust releases" });
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("conflict");

    release();
    await s.trials.idle();
    expect((await (await s.get(`/api/v1/topic-trials/${id}`)).json()).status).toBe("succeeded");
    expect((await s.post(`/api/v1/topics/${s.topic.id}/trials`, { text: "Rust releases" })).status).toBe(202);
  });

  it("refuses a trial without calling a model when trials are switched off", async () => {
    const s = seeded({ topicTrialsPerDay: 0 });
    const answer = await s.post(`/api/v1/topics/${s.topic.id}/trials`, { text: "Rust releases" });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ status: "limit", id: null });
    expect(s.llmRequests.interpret).toHaveLength(0);
  });

  it("closes a trial whose task fails as failed, with the reason", async () => {
    const s = seeded({
      interpret: () => {
        throw new Error("provider down");
      },
    });
    const { id } = await (await s.post(`/api/v1/topics/${s.topic.id}/trials`, { text: "Rust releases" })).json();
    await s.trials.idle();
    const trial = await (await s.get(`/api/v1/topic-trials/${id}`)).json();
    expect(trial).toMatchObject({ status: "failed", result: null });
    expect(trial.error).toContain("provider down");
  });

  it("answers 404 for a topic or a trial that does not exist, and 400 for an empty text", async () => {
    const s = seeded();
    expect((await s.post("/api/v1/topics/999/trials", { text: "Rust" })).status).toBe(404);
    expect((await s.get("/api/v1/topic-trials/no-such-trial")).status).toBe(404);
    expect((await s.post(`/api/v1/topics/${s.topic.id}/trials`, { text: "  " })).status).toBe(400);
    expect(s.llmRequests.interpret).toHaveLength(0);
  });
});
