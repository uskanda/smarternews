// Retries carried out by the real pipeline: what a retry may spend, and what it must not write twice.
import { describe, expect, it, vi } from "vitest";
import { listRuns, recoverInterruptedRuns } from "../db/runs.ts";
import { resolvePricing } from "../llm/pricing.ts";
import { defaultHandlers, pipelineHarness, sourcesIn, type HarnessOptions } from "../testing/pipeline.ts";
import { RunQueue } from "./queue.ts";
import { CATCH_UP_MS, Scheduler } from "./scheduler.ts";

const FEED = "https://example.org/feed.xml";
const MINUTE = 60_000;

/** A category scheduled for 05:00, one minute before that time, with a server that retries twice. */
function setup(options: HarnessOptions = {}) {
  const h = pipelineHarness({ now: "2026-03-01T04:59:00.000Z", category: { schedule: ["05:00"] }, ...options });
  h.addTopic("Topic", { feeds: [FEED] });
  /** A server process: its queue and its scheduler over the same database. */
  const server = () => {
    const queue = new RunQueue({ db: h.db, clock: h.clock, retries: 2, execute: (runId) => h.execute(runId) });
    return { queue, scheduler: new Scheduler({ db: h.db, clock: h.clock, queue }) };
  };
  return { h, server };
}

/** Lets the scheduled run of 05:00 fail because the feed cannot be fetched, without a model call. */
async function failAtFive(s: ReturnType<typeof setup>) {
  const { queue, scheduler } = s.server();
  scheduler.begin({ catchUp: false });
  s.h.clock.advance(MINUTE);
  scheduler.tick();
  await queue.idle();
  expect(listRuns(s.h.db)).toMatchObject([{ status: "failed", llmCalls: 0, retryAt: "2026-03-01T05:10:00.000Z" }]);
  return { queue, scheduler };
}

describe("a retry and the limits of model calls", () => {
  it("stops at the day's limit like any run, and is not retried after that", async () => {
    const s = setup({ llmLimits: { llmCallsPerRun: 40, llmCallsPerDay: 1 } });
    const { queue, scheduler } = await failAtFive(s);
    // Another run used up the day's one call in the meantime.
    s.h.db.prepare("INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at) VALUES ('judge', 'judge', 10, 1, ?)").run(s.h.clock().toISOString());
    s.h.feed(FEED, [{ title: "Story", link: "https://example.org/story" }]);

    s.h.clock.advance(10 * MINUTE);
    scheduler.tick();
    await queue.idle();
    expect(listRuns(s.h.db)[0]).toMatchObject({ attempt: 1, status: "stopped_by_limit", llmCalls: 0, retryAt: null, retrySkipped: null });
    expect(s.h.requests.judge).toHaveLength(0);

    s.h.clock.advance(120 * MINUTE);
    scheduler.tick();
    await queue.idle();
    expect(listRuns(s.h.db)).toHaveLength(2);
  });

  it("stops at the monthly budget like any run, and is not retried after that", async () => {
    const s = setup({ llmPricing: resolvePricing("claude-sonnet-5-5")! });
    const { queue, scheduler } = await failAtFive(s);
    // Other calls used up the budget of the period in the meantime.
    s.h.db
      .prepare("INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES ('write', 'write', 10, 1, ?, 100, 1)")
      .run(s.h.clock().toISOString());
    s.h.feed(FEED, [{ title: "Story", link: "https://example.org/story" }]);

    s.h.clock.advance(10 * MINUTE);
    scheduler.tick();
    await queue.idle();
    expect(listRuns(s.h.db)[0]).toMatchObject({ attempt: 1, status: "stopped_by_limit", stoppedBy: "budget", llmCalls: 0, retryAt: null, retrySkipped: null });
    expect(s.h.requests.judge).toHaveLength(0);

    s.h.clock.advance(120 * MINUTE);
    scheduler.tick();
    await queue.idle();
    expect(listRuns(s.h.db)).toHaveLength(2);
  });

  it("stops at the limit of calls for one run", async () => {
    const s = setup({ llmLimits: { llmCallsPerRun: 1, llmCallsPerDay: 300 } });
    const { queue, scheduler } = await failAtFive(s);
    s.h.feed(FEED, [
      { title: "First story", link: "https://example.org/first" },
      { title: "Second story", link: "https://example.org/second" },
    ]);

    s.h.clock.advance(10 * MINUTE);
    scheduler.tick();
    await queue.idle();

    // The judge call was the one call allowed; grouping the two stories would have been the second.
    expect(listRuns(s.h.db)[0]).toMatchObject({ attempt: 1, status: "stopped_by_limit", llmCalls: 1, retryAt: null });
    expect(s.h.articles()).toEqual([]);
  });
});

describe("the retry of a run that failed while it was writing", () => {
  it("writes what was left, and not a second article about the story that was already written", async () => {
    const s = setup();
    s.h.feed(FEED, [
      { title: "Written before the stop [i5]", link: "https://example.org/a" },
      { title: "Left unwritten [i4]", link: "https://example.org/b" },
    ]);
    // The second article is never finished: the server stops while the model is writing it.
    s.h.handlers.write = (request) => (s.h.requests.write.length === 1 ? defaultHandlers.write(request) : new Promise(() => {}));
    const before = s.server();
    before.scheduler.begin({ catchUp: false });
    s.h.clock.advance(MINUTE);
    before.scheduler.tick();
    await vi.waitFor(() => expect(s.h.requests.write).toHaveLength(2));
    expect(s.h.articles().map((article) => article.title)).toEqual(["Written before the stop [i5]"]);
    const interrupted = listRuns(s.h.db)[0]!;
    expect(interrupted.status).toBe("running");

    // The server starts again ten minutes later.
    s.h.clock.advance(10 * MINUTE);
    s.h.handlers.write = defaultHandlers.write;
    recoverInterruptedRuns(s.h.db, s.h.clock, { retries: 2, staleAfterMs: CATCH_UP_MS });
    const after = s.server();
    after.scheduler.begin({ catchUp: true });
    after.scheduler.tick();
    await after.queue.idle();

    expect(listRuns(s.h.db)[0]).toMatchObject({ attempt: 1, retryOf: interrupted.id, status: "succeeded", collected: 0, articlesCreated: 1 });
    expect(s.h.articles().map((article) => article.title).sort()).toEqual(["Left unwritten [i4]", "Written before the stop [i5]"]);
    expect(sourcesIn(s.h.requests.write[2]!).map((source) => source.url)).toEqual(["https://example.org/b"]);
  });
});
