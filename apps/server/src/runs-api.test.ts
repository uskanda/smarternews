import { finishRun, insertCandidate } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runs", () => {
  it("starts a run of a category at once and records it as manual", async () => {
    const s = testServer();
    const category = s.category();

    const response = await s.post(`/api/v1/categories/${category.id}/runs`);
    await tick();

    expect(response.status).toBe(202);
    const run = await response.json();
    expect(run).toMatchObject({ categoryId: category.id, trigger: "manual" });
    expect(await (await s.get(`/api/v1/runs/${run.id}`)).json()).toMatchObject({ status: "running" });
  });

  it("answers 409 and points at the run in progress when the category is already running", async () => {
    const s = testServer();
    const category = s.category();
    const first = await (await s.post(`/api/v1/categories/${category.id}/runs`)).json();
    await tick();

    const response = await s.post(`/api/v1/categories/${category.id}/runs`);

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toContain(`run ${first.id}`);
  });

  it("lists the runs, newest first, and can narrow them to one category", async () => {
    const s = testServer();
    const a = s.category("A");
    const b = s.category("B");
    const first = await (await s.post(`/api/v1/categories/${a.id}/runs`)).json();
    const second = await (await s.post(`/api/v1/categories/${b.id}/runs`)).json();

    const all = await (await s.get("/api/v1/runs")).json();
    const onlyA = await (await s.get(`/api/v1/runs?category=${a.id}`)).json();

    expect(all.map((run: { id: number }) => run.id)).toEqual([second.id, first.id]);
    expect(onlyA.map((run: { id: number }) => run.id)).toEqual([first.id]);
  });

  it("lists the rejected candidates of a run with title, URL, topics and reason", async () => {
    const s = testServer();
    const category = s.category();
    const topic = await (await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Exploited bugs" })).json();
    const run = await (await s.post(`/api/v1/categories/${category.id}/runs`)).json();
    const base = {
      categoryId: category.id,
      runId: run.id,
      fetchable: true,
      snippet: "",
      siteName: "Example",
      publishedAt: null,
      sourceKind: "feed" as const,
      topicIds: [topic.id],
      now: s.clock().toISOString(),
    };
    insertCandidate(s.db, { ...base, url: "https://example.org/ad", title: "Buy now", status: "rejected", reason: "advertising", importance: 1 });
    insertCandidate(s.db, { ...base, url: "https://example.org/ok", title: "Real story", status: "pending", reason: "relevant", importance: 4 });

    const rejected = await (await s.get(`/api/v1/runs/${run.id}/candidates`)).json();
    const everything = await (await s.get(`/api/v1/runs/${run.id}/candidates?status=all`)).json();

    expect(rejected).toEqual([
      expect.objectContaining({
        title: "Buy now",
        url: "https://example.org/ad",
        reason: "advertising",
        topics: [{ id: topic.id, text: "Exploited bugs" }],
      }),
    ]);
    expect(everything).toHaveLength(2);
  });

  it("shows the counts and failures of a finished run", async () => {
    const s = testServer();
    const category = s.category();
    const run = await (await s.post(`/api/v1/categories/${category.id}/runs`)).json();
    finishRun(s.db, run.id, {
      status: "partial",
      finishedAt: s.clock().toISOString(),
      collected: 40,
      rejected: 32,
      articlesCreated: 3,
      articlesUpdated: 1,
      llmCalls: 9,
      failures: [{ stage: "feed", target: "https://example.org/down.xml", message: "HTTP status 500" }],
    });

    expect(await (await s.get(`/api/v1/runs/${run.id}`)).json()).toMatchObject({
      status: "partial",
      collected: 40,
      rejected: 32,
      articlesCreated: 3,
      articlesUpdated: 1,
      llmCalls: 9,
      failures: [{ stage: "feed", target: "https://example.org/down.xml", message: "HTTP status 500" }],
    });
  });

  it("answers 404 for a run or category that does not exist", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/runs/55")).status).toBe(404);
    expect((await s.get("/api/v1/runs/55/candidates")).status).toBe(404);
    expect((await s.post("/api/v1/categories/55/runs")).status).toBe(404);
  });
});
