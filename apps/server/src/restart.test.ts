// A server that is stopped while runs are in progress and waiting, and then started again on the same data.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCategory, createRun, createTopic, finishRun, getRun, listRuns, setRetry, startRun, type Clock } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "./runtime.ts";

function sandbox(start: string) {
  const root = mkdtempSync(join(tmpdir(), "sn-restart-"));
  const env = { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") };
  mkdirSync(env.SMARTERNEWS_CONFIG_DIR, { recursive: true });
  // No test here needs a model. A command that does not exist makes sure that none is reached by mistake.
  writeFileSync(
    join(env.SMARTERNEWS_CONFIG_DIR, "config.yaml"),
    `providers:\n  none: { adapter: claude-cli, model: test, command: ${JSON.stringify(join(root, "no-such-command"))} }\n`,
  );
  // Every reading is a second later than the one before, so that the order of what happened can be told.
  let now = new Date(start).getTime();
  const clock = (() => new Date((now += 1000))) as Clock;
  const advance = (ms: number) => void (now += ms);
  const boot = () => createRuntime({ env, home: root, clock });
  /** A category whose runs have nothing to collect: they end as succeeded without any request. */
  const category = (runtime: Runtime, name: string) => {
    const created = createCategory(runtime.db, { name, kind: "news", schedule: ["03:00"] }, clock);
    createTopic(
      runtime.db,
      created.id,
      { text: "anything new", sources: { feeds: [], newsSearch: false, llmSearch: false }, interpretation: { queries: ["anything"], criteria: "anything" } },
      clock,
    );
    return created;
  };
  /** What `serve` does after it has opened the data: settle what the stop left behind, then check the schedule. */
  const startUp = async (runtime: Runtime) => {
    const recovered = runtime.recover();
    runtime.scheduler.begin({ catchUp: true });
    runtime.scheduler.tick();
    await runtime.queue.idle();
    return recovered;
  };
  return { clock, advance, boot, category, startUp };
}

const MINUTE = 60_000;

describe("a server stopped in the middle of a run and started again", () => {
  it("fails the run that was in progress, carries out the runs that were waiting in their order, and then retries the interrupted one", async () => {
    const s = sandbox("2026-03-01T12:00:00.000Z");
    const stopped = s.boot();
    const [a, b, c] = ["A", "B", "C"].map((name) => s.category(stopped, name));
    const interrupted = createRun(stopped.db, { categoryId: a!.id, trigger: "schedule", slot: "2026-03-01T12:00" }, s.clock);
    startRun(stopped.db, interrupted.id, s.clock().toISOString());
    const waitingB = createRun(stopped.db, { categoryId: b!.id, trigger: "schedule", slot: "2026-03-01T12:00" }, s.clock);
    const waitingC = createRun(stopped.db, { categoryId: c!.id, trigger: "manual", slot: null }, s.clock);
    stopped.close();

    s.advance(5 * MINUTE);
    const restarted = s.boot();
    try {
      expect(await s.startUp(restarted)).toEqual({ closed: 1, resumed: 2 });

      expect(getRun(restarted.db, interrupted.id)).toMatchObject({
        status: "failed",
        failures: [expect.objectContaining({ message: expect.stringContaining("interrupted") })],
      });
      const [retry, ...earlier] = listRuns(restarted.db);
      expect(earlier.map((run) => run.id)).toEqual([waitingC.id, waitingB.id, interrupted.id]);
      const afterB = getRun(restarted.db, waitingB.id);
      const afterC = getRun(restarted.db, waitingC.id);
      expect(afterB).toMatchObject({ status: "succeeded", failures: [], attempt: 0 });
      expect(afterC).toMatchObject({ status: "succeeded", failures: [], attempt: 0 });
      expect(retry).toMatchObject({ categoryId: a!.id, trigger: "schedule", attempt: 1, retryOf: interrupted.id, status: "succeeded" });
      expect([afterB.startedAt, afterC.startedAt, retry!.startedAt]).toEqual([afterB.startedAt, afterC.startedAt, retry!.startedAt].sort());
      expect(afterB.finishedAt! <= afterC.startedAt!).toBe(true);
    } finally {
      restarted.close();
    }
  });

  it("does not retry a manual run that was in progress", async () => {
    const s = sandbox("2026-03-01T12:00:00.000Z");
    const stopped = s.boot();
    const a = s.category(stopped, "A");
    const interrupted = createRun(stopped.db, { categoryId: a.id, trigger: "manual", slot: null }, s.clock);
    startRun(stopped.db, interrupted.id, s.clock().toISOString());
    stopped.close();

    const restarted = s.boot();
    try {
      expect(await s.startUp(restarted)).toEqual({ closed: 1, resumed: 0 });
      expect(listRuns(restarted.db)).toMatchObject([{ id: interrupted.id, status: "failed", retryAt: null, retrySkipped: "manual" }]);
    } finally {
      restarted.close();
    }
  });

  it("starts a retry whose time passed while the server was down", async () => {
    const s = sandbox("2026-03-01T12:00:00.000Z");
    const stopped = s.boot();
    const a = s.category(stopped, "A");
    const failed = createRun(stopped.db, { categoryId: a.id, trigger: "schedule", slot: "2026-03-01T12:00" }, s.clock);
    startRun(stopped.db, failed.id, s.clock().toISOString());
    finishRun(stopped.db, failed.id, {
      status: "failed",
      finishedAt: "2026-03-01T12:03:00.000Z",
      collected: 0,
      rejected: 0,
      articlesCreated: 0,
      articlesUpdated: 0,
      llmCalls: 0,
      failures: [{ stage: "feed", target: "https://example.org/feed.xml", message: "HTTP status 500" }],
    });
    setRetry(stopped.db, failed.id, { at: "2026-03-01T12:13:00.000Z" });
    stopped.close();

    s.advance(30 * MINUTE);
    const restarted = s.boot();
    try {
      expect(await s.startUp(restarted)).toEqual({ closed: 0, resumed: 0 });
      expect(listRuns(restarted.db)).toMatchObject([
        { attempt: 1, retryOf: failed.id, status: "succeeded" },
        { id: failed.id, status: "failed", retryAt: null, retrySkipped: null },
      ]);
    } finally {
      restarted.close();
    }
  });
});
