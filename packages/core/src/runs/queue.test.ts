import { describe, expect, it } from "vitest";
import { createCategory, deleteCategory } from "../db/categories.ts";
import { finishRun, getRun, startRun } from "../db/runs.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { RunQueue } from "./queue.ts";

function setup() {
  const db = createTestDb();
  const clock = fakeClock("2026-03-01T12:00:00.000Z");
  const events: string[] = [];
  const gates = new Map<number, () => void>();
  const queue = new RunQueue({
    db,
    clock,
    // A stand-in for the pipeline: it holds each run open until the test releases it.
    execute: async (runId) => {
      events.push(`start ${runId}`);
      startRun(db, runId, clock().toISOString());
      await new Promise<void>((resolve) => gates.set(runId, resolve));
      finishRun(db, runId, {
        status: "succeeded",
        finishedAt: clock().toISOString(),
        collected: 0,
        rejected: 0,
        articlesCreated: 0,
        articlesUpdated: 0,
        llmCalls: 0,
        failures: [],
      });
      events.push(`end ${runId}`);
    },
  });
  const a = createCategory(db, { name: "A", kind: "news" }, clock);
  const b = createCategory(db, { name: "B", kind: "news" }, clock);
  const release = async (runId: number) => {
    gates.get(runId)!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { db, queue, events, release, a, b };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RunQueue", () => {
  it("starts a manual run at once when nothing is running", async () => {
    const { db, queue, events, a } = setup();
    const run = queue.enqueue(a.id, "manual", null);
    await tick();
    expect(run).toMatchObject({ categoryId: a.id, trigger: "manual", status: "queued" });
    expect(events).toEqual([`start ${run.id}`]);
    expect(getRun(db, run.id).status).toBe("running");
  });

  it("starts the second run only after the first has ended", async () => {
    const { queue, events, release, a, b } = setup();
    const first = queue.enqueue(a.id, "schedule", "2026-03-01T05:00");
    const second = queue.enqueue(b.id, "schedule", "2026-03-01T05:00");
    await tick();
    expect(events).toEqual([`start ${first.id}`]);

    await release(first.id);
    await tick();

    expect(events).toEqual([`start ${first.id}`, `end ${first.id}`, `start ${second.id}`]);
  });

  it("refuses a manual run for a category that is already running, and names the run in progress", async () => {
    const { queue, a } = setup();
    const first = queue.enqueue(a.id, "manual", null);
    await tick();
    expect(() => queue.enqueue(a.id, "manual", null)).toThrow(
      expect.objectContaining({ code: "conflict", message: expect.stringContaining(`run ${first.id}`) }),
    );
  });

  it("refuses a manual run for a category that is waiting in the queue", async () => {
    const { queue, a, b } = setup();
    queue.enqueue(a.id, "manual", null);
    queue.enqueue(b.id, "manual", null);
    expect(() => queue.enqueue(b.id, "manual", null)).toThrow(expect.objectContaining({ code: "conflict" }));
  });

  it("accepts a new manual run once the earlier one has ended", async () => {
    const { queue, release, a } = setup();
    const first = queue.enqueue(a.id, "manual", null);
    await tick();
    await release(first.id);
    await tick();
    expect(() => queue.enqueue(a.id, "manual", null)).not.toThrow();
  });

  it("carries on with the next run when a waiting run's category is deleted", async () => {
    const db = createTestDb();
    const clock = fakeClock("2026-03-01T12:00:00.000Z");
    const started: number[] = [];
    const queue = new RunQueue({
      db,
      clock,
      execute: async (runId) => {
        started.push(runId);
        getRun(db, runId); // the pipeline reads its run first, and fails when it is gone
      },
    });
    const a = createCategory(db, { name: "A", kind: "news" }, clock);
    const b = createCategory(db, { name: "B", kind: "news" }, clock);
    const doomed = queue.enqueue(a.id, "manual", null);
    const second = queue.enqueue(b.id, "manual", null);
    deleteCategory(db, a.id); // removes the waiting run with it

    await queue.idle();
    const third = queue.enqueue(b.id, "schedule", "2026-03-01T13:00");
    await queue.idle();

    expect(started).toEqual([doomed.id, second.id, third.id]);
  });

  it("closes a run as failed when the pipeline throws, and carries on with the next", async () => {
    const db = createTestDb();
    const clock = fakeClock("2026-03-01T12:00:00.000Z");
    const started: number[] = [];
    const queue = new RunQueue({
      db,
      clock,
      execute: async (runId) => {
        started.push(runId);
        if (started.length === 1) throw new Error("disk full");
      },
    });
    const a = createCategory(db, { name: "A", kind: "news" }, clock);
    const b = createCategory(db, { name: "B", kind: "news" }, clock);
    const first = queue.enqueue(a.id, "manual", null);
    const second = queue.enqueue(b.id, "manual", null);

    await queue.idle();

    expect(getRun(db, first.id)).toMatchObject({ status: "failed", failures: [expect.objectContaining({ message: "disk full" })] });
    expect(started).toEqual([first.id, second.id]);
  });
});
