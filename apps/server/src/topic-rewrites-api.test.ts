import { applyInterpretation, createTopic, resolvePricing, setArticleFlags } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const answer = {
  proposals: [
    { text: "Releases of the Rust compiler, without tutorials", explanation: "チュートリアルを除きます。" },
    { text: "Rust compiler releases and security advisories", explanation: "セキュリティの告知を足します。" },
  ],
};

function seeded(options: Parameters<typeof testServer>[1] = {}, interpreted = true) {
  const s = testServer("2026-03-20T00:00:00.000Z", { proposeTopicRewrite: () => answer, ...options });
  const category = s.category("Rust");
  const created = createTopic(s.db, category.id, { text: "Rust news" }, s.clock);
  const topic = interpreted
    ? applyInterpretation(s.db, created.id, { queries: ["rust"], criteria: "Anything about Rust.", suggestedSources: { newsSearch: true, llmSearch: false } })
    : created;
  setArticleFlags(s.db, s.article(category.id, { title: "Rust 2.0 ships", topicIds: [topic.id] }), { starred: true }, "2026-03-20T00:00:00.000Z");
  return { ...s, category, topic };
}

const tables = (db: ReturnType<typeof testServer>["db"]) =>
  ["topics", "articles", "candidates", "misses"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

describe("the topic rewrite proposals API", () => {
  it("answers with the proposals, records one call outside any run, and stores nothing else", async () => {
    const s = seeded();
    const before = tables(s.db);

    const response = await s.post(`/api/v1/topics/${s.topic.id}/rewrite-proposals`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "proposed", proposals: answer.proposals });
    expect(s.db.prepare("SELECT task, run_id FROM llm_calls").all()).toEqual([{ task: "proposeTopicRewrite", run_id: null }]);
    expect(tables(s.db)).toEqual(before);
    expect(s.llmRequests.proposeTopicRewrite[0]!.prompt).toContain("Rust 2.0 ships");
  });

  it("says why without calling the model when the allowance is 0 or the topic is not interpreted", async () => {
    const off = seeded({ topicRewritesPerDay: 0 });
    const refused = await off.post(`/api/v1/topics/${off.topic.id}/rewrite-proposals`);
    expect(refused.status).toBe(200);
    expect(await refused.json()).toEqual({ status: "limit", proposals: [] });

    const day = seeded({ llmCallsPerDay: 1 });
    day.db.prepare("INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, created_at) VALUES (NULL, 'judge', 'judge', 1, 1, ?)").run("2026-03-20T00:00:00.000Z");
    expect(await (await day.post(`/api/v1/topics/${day.topic.id}/rewrite-proposals`)).json()).toEqual({ status: "day", proposals: [] });

    const uninterpreted = seeded({}, false);
    expect(await (await uninterpreted.post(`/api/v1/topics/${uninterpreted.topic.id}/rewrite-proposals`)).json()).toEqual({
      status: "uninterpreted",
      proposals: [],
    });
    expect(off.llmRequests.proposeTopicRewrite).toHaveLength(0);
    expect(day.llmRequests.proposeTopicRewrite).toHaveLength(0);
    expect(uninterpreted.llmRequests.proposeTopicRewrite).toHaveLength(0);
  });

  it("says the budget is used up when a provider that costs money would be called", async () => {
    const s = seeded({ pricing: resolvePricing("claude-sonnet-5-5")!, budget: { monthlyBudgetUsd: 0, warnRatio: 0.8, resetDay: 1 } });
    expect(await (await s.post(`/api/v1/topics/${s.topic.id}/rewrite-proposals`)).json()).toEqual({ status: "budget", proposals: [] });
  });

  it("answers 503 when the task fails, and 404 for a topic that does not exist", async () => {
    const s = seeded({ proposeTopicRewrite: () => ({ proposals: [] }) });
    const failed = await s.post(`/api/v1/topics/${s.topic.id}/rewrite-proposals`);
    expect(failed.status).toBe(503);
    expect((await failed.json()).error.code).toBe("unavailable");

    expect((await s.post("/api/v1/topics/999/rewrite-proposals")).status).toBe(404);
  });
});
