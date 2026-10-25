import { createRun, finishRun, insertCandidate, setRetry, startRun, type RetrySkipped } from "@smarternews/core";
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

  it("says which allowance stopped a run, and names none for a run that was not stopped by one", async () => {
    const s = testServer();
    const category = s.category();
    const outcome = { finishedAt: s.clock().toISOString(), collected: 0, rejected: 0, articlesCreated: 0, articlesUpdated: 0, llmCalls: 0, failures: [] };
    const stopped = await (await s.post(`/api/v1/categories/${category.id}/runs`)).json();
    finishRun(s.db, stopped.id, { ...outcome, status: "stopped_by_limit", stoppedBy: "budget" });
    const other = s.category();
    const succeeded = await (await s.post(`/api/v1/categories/${other.id}/runs`)).json();
    finishRun(s.db, succeeded.id, { ...outcome, status: "succeeded" });

    expect(await (await s.get(`/api/v1/runs/${stopped.id}`)).json()).toMatchObject({ status: "stopped_by_limit", stoppedBy: "budget" });
    expect(await (await s.get("/api/v1/runs")).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: stopped.id, stoppedBy: "budget" }),
        expect.objectContaining({ id: succeeded.id, stoppedBy: null }),
      ]),
    );
  });

  it("answers 404 for a run or category that does not exist", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/runs/55")).status).toBe(404);
    expect((await s.get("/api/v1/runs/55/candidates")).status).toBe(404);
    expect((await s.post("/api/v1/categories/55/runs")).status).toBe(404);
  });

  describe("what they say about retries", () => {
    /** A scheduled run that failed, and optionally the retries that followed it; the last one carries `plan`. */
    function failedRuns(s: ReturnType<typeof testServer>, retries: number, plan: { at: string } | { skipped: RetrySkipped } | null) {
      const category = s.category();
      const ids: number[] = [];
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const run = createRun(
          s.db,
          { categoryId: category.id, trigger: "schedule", slot: attempt === 0 ? "2026-03-01T05:00" : null, retry: attempt === 0 ? undefined : { attempt, of: ids[0]! } },
          s.clock,
        );
        startRun(s.db, run.id, s.clock().toISOString());
        finishRun(s.db, run.id, {
          status: "failed",
          finishedAt: s.clock().toISOString(),
          collected: 0,
          rejected: 0,
          articlesCreated: 0,
          articlesUpdated: 0,
          llmCalls: 0,
          failures: [{ stage: "feed", target: "https://example.org/down.xml", message: "HTTP status 500" }],
        });
        ids.push(run.id);
      }
      setRetry(s.db, ids.at(-1)!, plan);
      return ids;
    }

    it("say that an ordinary run is not a retry", async () => {
      const s = testServer();
      const run = await (await s.post(`/api/v1/categories/${s.category().id}/runs`)).json();
      expect(await (await s.get(`/api/v1/runs/${run.id}`)).json()).toMatchObject({ attempt: 0, retryOf: null, retryAt: null, retrySkipped: null });
    });

    it("say which retry a run is and which run it retries, in the detail and in the list", async () => {
      const s = testServer();
      const [first, retry] = failedRuns(s, 1, null);

      expect(await (await s.get(`/api/v1/runs/${retry}`)).json()).toMatchObject({ attempt: 1, retryOf: first, trigger: "schedule", slot: null });
      expect(await (await s.get("/api/v1/runs")).json()).toMatchObject([
        { id: retry, attempt: 1, retryOf: first },
        { id: first, attempt: 0, retryOf: null },
      ]);
    });

    it("say when the retry of a failed run is due", async () => {
      const s = testServer("2026-03-01T05:03:00.000Z");
      const [first] = failedRuns(s, 0, { at: "2026-03-01T05:13:00.000Z" });

      expect(await (await s.get(`/api/v1/runs/${first}`)).json()).toMatchObject({ status: "failed", retryAt: "2026-03-01T05:13:00.000Z", retrySkipped: null });
      expect((await (await s.get("/api/v1/runs")).json())[0]).toMatchObject({ retryAt: "2026-03-01T05:13:00.000Z" });
    });

    it("say that no retry follows the last one allowed, and that the limit is why", async () => {
      const s = testServer();
      const ids = failedRuns(s, 2, { skipped: "limit" });

      expect(await (await s.get(`/api/v1/runs/${ids[2]}`)).json()).toMatchObject({ status: "failed", attempt: 2, retryOf: ids[0], retryAt: null, retrySkipped: "limit" });
    });
  });
});
