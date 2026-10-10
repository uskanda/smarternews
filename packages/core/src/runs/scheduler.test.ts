import { describe, expect, it } from "vitest";
import { createCategory, updateCategory } from "../db/categories.ts";
import { createRun, failInterruptedRuns, getRun, listRuns, startRun } from "../db/runs.ts";
import { updateSettings } from "../db/settings.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { RunQueue } from "./queue.ts";
import { Scheduler } from "./scheduler.ts";

function setup(start: string, timeZone = "UTC") {
  const db = createTestDb();
  const clock = fakeClock(start);
  updateSettings(db, { timeZone });
  const executed: number[] = [];
  const queue = new RunQueue({ db, clock, execute: async (runId) => void executed.push(runId) });
  const scheduler = new Scheduler({ db, clock, queue });
  const category = (name: string, schedule: string[]) => createCategory(db, { name, kind: "news", schedule }, clock);
  /** A category that has existed for a week, as on a server that was running before. */
  const oldCategory = (name: string, schedule: string[]) =>
    createCategory(db, { name, kind: "news", schedule }, () => new Date(clock().getTime() - 7 * 86_400_000));
  const scheduled = () => listRuns(db).map((run) => `${run.categoryId}@${run.slot}`).sort();
  return { db, clock, queue, scheduler, category, oldCategory, scheduled, executed };
}

const MINUTE = 60_000;

describe("Scheduler.tick", () => {
  it("starts a run when the clock reaches a time of the category's schedule", async () => {
    const { clock, scheduler, category, db } = setup("2026-03-01T04:59:00.000Z");
    const news = category("News", ["05:00"]);
    scheduler.begin({ catchUp: false });
    scheduler.tick();
    expect(listRuns(db)).toEqual([]);

    clock.advance(MINUTE);
    scheduler.tick();

    expect(listRuns(db)).toMatchObject([{ categoryId: news.id, trigger: "schedule", slot: "2026-03-01T05:00" }]);
  });

  it("reads the schedule in the configured time zone, not the server's", async () => {
    const { clock, scheduler, category, db } = setup("2026-03-01T19:59:00.000Z", "Asia/Tokyo");
    category("News", ["05:00"]);
    scheduler.begin({ catchUp: false });
    scheduler.tick();
    expect(listRuns(db)).toEqual([]);

    clock.set("2026-03-01T20:00:00.000Z"); // 05:00 on March 2 in Tokyo
    scheduler.tick();

    expect(listRuns(db)).toMatchObject([{ slot: "2026-03-02T05:00" }]);
  });

  it("does not start a disabled category", async () => {
    const { clock, scheduler, category, db } = setup("2026-03-01T04:59:00.000Z");
    const news = category("News", ["05:00"]);
    updateCategory(db, news.id, { enabled: false });
    scheduler.begin({ catchUp: false });

    clock.advance(MINUTE);
    scheduler.tick();

    expect(listRuns(db)).toEqual([]);
  });

  it("starts a scheduled time once, however often it is checked", async () => {
    const { clock, scheduler, category, db } = setup("2026-03-01T04:59:30.000Z");
    category("News", ["05:00"]);
    scheduler.begin({ catchUp: false });

    clock.advance(MINUTE);
    scheduler.tick();
    scheduler.tick();
    clock.advance(20_000);
    scheduler.tick();

    expect(listRuns(db)).toHaveLength(1);
  });

  it("still starts a run when a check comes a few minutes late", async () => {
    const { clock, scheduler, category, db } = setup("2026-03-01T04:58:00.000Z");
    category("News", ["05:00"]);
    scheduler.begin({ catchUp: false });
    scheduler.tick();

    clock.set("2026-03-01T05:03:00.000Z");
    scheduler.tick();

    expect(listRuns(db)).toMatchObject([{ slot: "2026-03-01T05:00" }]);
  });

  it("queues two categories due at the same time and runs them one after the other", async () => {
    const { clock, scheduler, category, queue, executed } = setup("2026-03-01T04:59:00.000Z");
    const a = category("A", ["05:00"]);
    const b = category("B", ["05:00"]);
    scheduler.begin({ catchUp: false });

    clock.advance(MINUTE);
    scheduler.tick();
    await queue.idle();

    expect(executed).toHaveLength(2);
    expect(executed.map((id) => id)).toEqual([...executed].sort((x, y) => x - y));
    expect([a.id, b.id]).toHaveLength(2);
  });

  it("does not run a past time for a category created after it", async () => {
    const { clock, scheduler, category, db } = setup("2026-03-01T10:00:00.000Z");
    scheduler.begin({ catchUp: false });
    scheduler.tick();
    category("Late", ["05:00"]);

    clock.advance(MINUTE);
    scheduler.tick();

    expect(listRuns(db)).toEqual([]);
  });
});

describe("Scheduler at start-up", () => {
  it("runs once for a scheduled time missed within the last six hours", async () => {
    const { scheduler, oldCategory, scheduled } = setup("2026-03-01T07:00:00.000Z");
    const news = oldCategory("News", ["05:00"]);

    scheduler.begin({ catchUp: true });
    scheduler.tick();

    expect(scheduled()).toEqual([`${news.id}@2026-03-01T05:00`]);
  });

  it("runs only the latest of several missed times", async () => {
    const { scheduler, oldCategory, scheduled } = setup("2026-03-01T19:00:00.000Z");
    const news = oldCategory("News", ["05:00", "12:00", "18:00"]);

    scheduler.begin({ catchUp: true });
    scheduler.tick();

    expect(scheduled()).toEqual([`${news.id}@2026-03-01T18:00`]);
  });

  it("does not make up for a time missed more than six hours ago", async () => {
    const { scheduler, oldCategory, scheduled } = setup("2026-03-01T12:00:00.000Z");
    oldCategory("News", ["05:00"]);

    scheduler.begin({ catchUp: true });
    scheduler.tick();

    expect(scheduled()).toEqual([]);
  });

  it("does not make up for a time that passed before the category existed", async () => {
    const { clock, scheduler, category, scheduled } = setup("2026-03-01T06:00:00.000Z");
    category("Just imported", ["05:00"]); // created at 06:00, an hour after its scheduled time
    clock.advance(60_000);

    scheduler.begin({ catchUp: true });
    scheduler.tick();

    expect(scheduled()).toEqual([]);
  });

  it("does not repeat a scheduled time that already has a run", async () => {
    const { db, clock, scheduler, oldCategory } = setup("2026-03-01T07:00:00.000Z");
    const news = oldCategory("News", ["05:00"]);
    createRun(db, { categoryId: news.id, trigger: "schedule", slot: "2026-03-01T05:00" }, clock);

    scheduler.begin({ catchUp: true });
    scheduler.tick();

    expect(listRuns(db)).toHaveLength(1);
  });
});

describe("failInterruptedRuns", () => {
  it("closes a run that was in progress when the server stopped, and says it was interrupted", () => {
    const { db, clock, category } = setup("2026-03-01T07:00:00.000Z");
    const news = category("News", ["05:00"]);
    const run = createRun(db, { categoryId: news.id, trigger: "manual", slot: null }, clock);
    startRun(db, run.id, clock().toISOString());

    expect(failInterruptedRuns(db, clock)).toBe(1);

    expect(getRun(db, run.id)).toMatchObject({
      status: "failed",
      finishedAt: "2026-03-01T07:00:00.000Z",
      failures: [expect.objectContaining({ message: expect.stringContaining("interrupted") })],
    });
  });
});
