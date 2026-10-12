import { describe, expect, it } from "vitest";
import { createCategory, deleteCategory, updateCategory } from "../db/categories.ts";
import { createRun, finishRun, getRun, listRuns, recoverInterruptedRuns, setRetry, startRun } from "../db/runs.ts";
import { updateSettings } from "../db/settings.ts";
import { createTopic, listTopics, updateTopic } from "../db/topics.ts";
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
  const withTopic = (created: ReturnType<typeof createCategory>) => {
    createTopic(db, created.id, { text: "anything new" }, clock);
    return created;
  };
  const category = (name: string, schedule: string[]) => withTopic(createCategory(db, { name, kind: "news", schedule }, clock));
  /** A category that has existed for a week, as on a server that was running before. */
  const oldCategory = (name: string, schedule: string[]) =>
    withTopic(createCategory(db, { name, kind: "news", schedule }, () => new Date(clock().getTime() - 7 * 86_400_000)));
  const scheduled = () => listRuns(db).map((run) => `${run.categoryId}@${run.slot}`).sort();
  return { db, clock, queue, scheduler, category, oldCategory, scheduled, executed };
}

const MINUTE = 60_000;

describe("a category without topics", () => {
  it("is not run by its schedule: it only holds subscribed feeds", () => {
    const { db, clock, scheduler } = setup("2026-03-01T04:59:00.000Z");
    createCategory(db, { name: "Feeds only", kind: "news", schedule: ["05:00"] }, clock);
    scheduler.begin({ catchUp: false });
    clock.advance(MINUTE);
    scheduler.tick();
    expect(listRuns(db)).toEqual([]);
  });

  it("is not run when its only topic is disabled", () => {
    const { db, clock, scheduler } = setup("2026-03-01T04:59:00.000Z");
    const created = createCategory(db, { name: "Paused", kind: "news", schedule: ["05:00"] }, clock);
    updateTopic(db, createTopic(db, created.id, { text: "anything" }, clock).id, { enabled: false });
    scheduler.begin({ catchUp: false });
    clock.advance(MINUTE);
    scheduler.tick();
    expect(listRuns(db)).toEqual([]);
  });

  it("can still be run by hand", () => {
    const { db, clock, queue } = setup("2026-03-01T04:59:00.000Z");
    const created = createCategory(db, { name: "Feeds only", kind: "news", schedule: ["05:00"] }, clock);
    expect(queue.enqueue(created.id, "manual", null)).toMatchObject({ categoryId: created.id, trigger: "manual" });
  });
});

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

/** A run that started at the clock's time and failed three minutes later, as the queue leaves it. */
function failed(
  s: ReturnType<typeof setup>,
  categoryId: number,
  options: { slot?: string | null; retry?: { attempt: number; of: number }; retryAt?: string; trigger?: "schedule" | "manual" } = {},
) {
  const run = createRun(s.db, { categoryId, trigger: options.trigger ?? "schedule", slot: options.slot ?? null, retry: options.retry }, s.clock);
  startRun(s.db, run.id, s.clock().toISOString());
  s.clock.advance(3 * MINUTE);
  finishRun(s.db, run.id, {
    status: "failed",
    finishedAt: s.clock().toISOString(),
    collected: 0,
    rejected: 0,
    articlesCreated: 0,
    articlesUpdated: 0,
    llmCalls: 0,
    failures: [{ stage: "run", target: null, message: "disk full" }],
  });
  if (options.retryAt) setRetry(s.db, run.id, { at: options.retryAt });
  return run;
}

describe("a retry that is due", () => {
  it("is queued at the first check after its time, as a run of its own that names the run it retries", async () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const first = failed(s, news.id, { slot: "2026-03-01T05:00", retryAt: "2026-03-01T05:13:00.000Z" });
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T05:12:00.000Z");
    s.scheduler.tick();
    expect(listRuns(s.db)).toHaveLength(1);

    s.clock.set("2026-03-01T05:13:00.000Z");
    s.scheduler.tick();
    await s.queue.idle();

    const [retry, original] = listRuns(s.db);
    expect(retry).toMatchObject({ categoryId: news.id, trigger: "schedule", slot: null, attempt: 1, retryOf: first.id, queuedAt: "2026-03-01T05:13:00.000Z" });
    expect(original).toMatchObject({ id: first.id, status: "failed", retryAt: null, retrySkipped: null });
    expect(s.executed).toEqual([retry!.id]);
  });

  it("is queued once, however often it is checked", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    failed(s, news.id, { slot: "2026-03-01T05:00", retryAt: "2026-03-01T05:13:00.000Z" });
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T05:13:00.000Z");
    s.scheduler.tick();
    s.clock.advance(MINUTE);
    s.scheduler.tick();

    expect(listRuns(s.db)).toHaveLength(2);
  });

  it("names the scheduled run, not the retry before it, when it is the second retry", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const first = failed(s, news.id, { slot: "2026-03-01T05:00" });
    s.clock.set("2026-03-01T05:13:00.000Z");
    failed(s, news.id, { retry: { attempt: 1, of: first.id }, retryAt: "2026-03-01T05:46:00.000Z" });
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T05:46:30.000Z");
    s.scheduler.tick();

    expect(listRuns(s.db)[0]).toMatchObject({ attempt: 2, retryOf: first.id, status: "queued" });
  });

  it("is queued right after start-up when its time passed while the server was down", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const first = failed(s, news.id, { slot: "2026-03-01T05:00", retryAt: "2026-03-01T05:13:00.000Z" });

    s.clock.set("2026-03-01T05:40:00.000Z"); // the server was down from 05:05 to 05:40
    s.scheduler.begin({ catchUp: true });
    s.scheduler.tick();

    expect(listRuns(s.db)[0]).toMatchObject({ attempt: 1, retryOf: first.id, queuedAt: "2026-03-01T05:40:00.000Z" });
  });
});

describe("a retry that is called off", () => {
  it("is not made when the category's next scheduled run came first", () => {
    const s = setup("2026-03-01T11:00:00.000Z");
    const news = s.oldCategory("News", ["11:00", "12:00"]);
    s.clock.set("2026-03-01T11:47:00.000Z");
    const first = failed(s, news.id, { slot: "2026-03-01T11:00", retryAt: "2026-03-01T12:20:00.000Z" });
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T12:00:00.000Z");
    s.scheduler.tick();
    s.clock.set("2026-03-01T12:20:00.000Z");
    s.scheduler.tick();

    expect(listRuns(s.db).map((run) => [run.slot, run.attempt])).toEqual([
      ["2026-03-01T12:00", 0],
      ["2026-03-01T11:00", 0],
    ]);
    expect(getRun(s.db, first.id)).toMatchObject({ retryAt: null, retrySkipped: "superseded" });
  });

  it("is not made when the next scheduled run is queued by the very check that finds the retry due", () => {
    const s = setup("2026-03-01T11:00:00.000Z");
    const news = s.oldCategory("News", ["11:00", "12:00"]);
    s.clock.set("2026-03-01T11:47:00.000Z");
    const first = failed(s, news.id, { slot: "2026-03-01T11:00", retryAt: "2026-03-01T12:00:00.000Z" });
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T12:00:00.000Z");
    s.scheduler.tick();

    expect(listRuns(s.db).map((run) => run.slot)).toEqual(["2026-03-01T12:00", "2026-03-01T11:00"]);
    expect(getRun(s.db, first.id).retrySkipped).toBe("superseded");
  });

  it("is not made for a category that was disabled in the meantime", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const first = failed(s, news.id, { slot: "2026-03-01T05:00", retryAt: "2026-03-01T05:13:00.000Z" });
    updateCategory(s.db, news.id, { enabled: false });
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T05:13:00.000Z");
    s.scheduler.tick();

    expect(listRuns(s.db)).toHaveLength(1);
    expect(getRun(s.db, first.id)).toMatchObject({ retryAt: null, retrySkipped: "disabled" });
  });

  it("is not made for a category whose topics were all disabled in the meantime", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const first = failed(s, news.id, { slot: "2026-03-01T05:00", retryAt: "2026-03-01T05:13:00.000Z" });
    for (const topic of listTopics(s.db, news.id)) updateTopic(s.db, topic.id, { enabled: false });
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T05:13:00.000Z");
    s.scheduler.tick();

    expect(listRuns(s.db)).toHaveLength(1);
    expect(getRun(s.db, first.id)).toMatchObject({ retryAt: null, retrySkipped: "disabled" });
  });

  it("goes away with a category that was deleted in the meantime", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    failed(s, news.id, { slot: "2026-03-01T05:00", retryAt: "2026-03-01T05:13:00.000Z" });
    deleteCategory(s.db, news.id);
    s.scheduler.begin({ catchUp: false });

    s.clock.set("2026-03-01T05:13:00.000Z");
    s.scheduler.tick();

    expect(listRuns(s.db)).toEqual([]);
  });
});

const SIX_HOURS = 6 * 60 * MINUTE;

describe("recoverInterruptedRuns", () => {
  it("closes a run that was in progress when the server stopped, and says it was interrupted", () => {
    const s = setup("2026-03-01T07:00:00.000Z");
    const news = s.category("News", ["05:00"]);
    const run = createRun(s.db, { categoryId: news.id, trigger: "manual", slot: null }, s.clock);
    startRun(s.db, run.id, s.clock().toISOString());

    expect(recoverInterruptedRuns(s.db, s.clock, { retries: 2, staleAfterMs: SIX_HOURS })).toEqual({ closed: 1, waiting: [] });

    expect(getRun(s.db, run.id)).toMatchObject({
      status: "failed",
      finishedAt: "2026-03-01T07:00:00.000Z",
      failures: [expect.objectContaining({ message: expect.stringContaining("interrupted") })],
      retryAt: null,
      retrySkipped: "manual",
    });
  });

  it("plans the retry of an interrupted scheduled run for at once, so that the first check starts it as the first retry", () => {
    const s = setup("2026-03-01T05:02:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const run = createRun(s.db, { categoryId: news.id, trigger: "schedule", slot: "2026-03-01T05:00" }, s.clock);
    startRun(s.db, run.id, s.clock().toISOString());

    s.clock.set("2026-03-01T05:30:00.000Z");
    recoverInterruptedRuns(s.db, s.clock, { retries: 2, staleAfterMs: SIX_HOURS });
    expect(getRun(s.db, run.id)).toMatchObject({ status: "failed", retryAt: "2026-03-01T05:30:00.000Z", retrySkipped: null });

    s.scheduler.begin({ catchUp: true });
    s.scheduler.tick();
    expect(listRuns(s.db)[0]).toMatchObject({ attempt: 1, retryOf: run.id, status: "queued" });
  });

  it("counts the interrupted run: the last retry allowed is not retried again", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const first = failed(s, news.id, { slot: "2026-03-01T05:00" });
    const last = createRun(s.db, { categoryId: news.id, trigger: "schedule", slot: null, retry: { attempt: 2, of: first.id } }, s.clock);
    startRun(s.db, last.id, s.clock().toISOString());

    recoverInterruptedRuns(s.db, s.clock, { retries: 2, staleAfterMs: SIX_HOURS });

    expect(getRun(s.db, last.id)).toMatchObject({ status: "failed", retryAt: null, retrySkipped: "limit" });
  });

  it("leaves the runs that were waiting as they are and hands them back in the order they were queued", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const [a, b, c] = ["A", "B", "C"].map((name) => s.oldCategory(name, ["05:00"]));
    const running = createRun(s.db, { categoryId: a!.id, trigger: "schedule", slot: "2026-03-01T05:00" }, s.clock);
    startRun(s.db, running.id, s.clock().toISOString());
    const second = createRun(s.db, { categoryId: b!.id, trigger: "schedule", slot: "2026-03-01T05:00" }, s.clock);
    const third = createRun(s.db, { categoryId: c!.id, trigger: "manual", slot: null }, s.clock);

    s.clock.advance(30 * MINUTE);
    expect(recoverInterruptedRuns(s.db, s.clock, { retries: 2, staleAfterMs: SIX_HOURS })).toEqual({ closed: 1, waiting: [second.id, third.id] });

    expect(getRun(s.db, second.id)).toMatchObject({ status: "queued", failures: [], attempt: 0 });
    expect(getRun(s.db, third.id)).toMatchObject({ status: "queued", failures: [] });
  });

  it("closes a waiting run that is older than the time a missed schedule is made up for, without a retry", () => {
    const s = setup("2026-03-01T05:00:00.000Z");
    const news = s.oldCategory("News", ["05:00"]);
    const old = createRun(s.db, { categoryId: news.id, trigger: "schedule", slot: "2026-03-01T05:00" }, s.clock);
    s.clock.set("2026-03-01T11:00:00.000Z");
    const recent = createRun(s.db, { categoryId: news.id, trigger: "manual", slot: null }, s.clock);

    s.clock.set("2026-03-01T11:00:01.000Z");
    expect(recoverInterruptedRuns(s.db, s.clock, { retries: 2, staleAfterMs: SIX_HOURS })).toEqual({ closed: 1, waiting: [recent.id] });

    expect(getRun(s.db, old.id)).toMatchObject({
      status: "failed",
      failures: [expect.objectContaining({ message: expect.stringContaining("interrupted") })],
      retryAt: null,
      retrySkipped: null,
    });
  });
});
