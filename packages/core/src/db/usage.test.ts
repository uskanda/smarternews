import { describe, expect, it } from "vitest";
import { createCategory } from "./categories.ts";
import { createRun } from "./runs.ts";
import { resolvePricing } from "../llm/pricing.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { fakeLlm } from "../testing/llm.ts";

const SONNET = resolvePricing("claude-sonnet-5-5")!;

/** A server whose budget period runs from 10 October to 9 November, on 25 October at noon. */
function setup(options: { now?: string; resetDay?: number; billable?: boolean } = {}) {
  const db = createTestDb();
  const clock = fakeClock(options.now ?? "2026-10-25T12:00:00.000Z");
  const { runner } = fakeLlm(db, clock, {}, {
    pricing: options.billable === false ? undefined : SONNET,
    budget: { monthlyBudgetUsd: 100, warnRatio: 0.8, resetDay: options.resetDay ?? 10 },
  });
  const category = (name: string) => createCategory(db, { name, kind: "news" }, clock);
  const run = (categoryId: number) => createRun(db, { categoryId, trigger: "manual", slot: null }, clock).id;
  const insertCall = db.prepare(
    "INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES (?, ?, 'p', 1, 1, ?, ?, ?)",
  );
  /** A call at `at`; `cost` undefined for a call to a provider that costs nothing, null for one whose cost is unknown. */
  const call = (at: string, cost: number | null | undefined, options: { runId?: number | null; task?: string } = {}) =>
    insertCall.run(options.runId ?? null, options.task ?? "write", at, cost ?? null, cost === undefined ? 0 : 1);
  const insertArticle = db.prepare(
    `INSERT INTO articles (category_id, origin, kind, title, summary, body, importance, first_published_at, updated_at, created_at, opened_at)
     VALUES (?, 'generated', 'news', 'T', 'S', 'B', 3, ?, ?, ?, ?)`,
  );
  const article = (categoryId: number, createdAt: string, openedAt: string | null = null) =>
    insertArticle.run(categoryId, createdAt, createdAt, createdAt, openedAt);
  return { db, clock, runner, category, run, call, article };
}

describe("the usage of the budget period", () => {
  it("names the period and how much of it has passed", () => {
    const { runner } = setup();

    const usage = runner.usageStatus();

    expect(usage).toMatchObject({ periodStart: "2026-10-10", periodEnd: "2026-11-09", billable: true, monthlyBudgetUsd: 100 });
    expect(usage.elapsedRatio).toBeCloseTo(15.5 / 31, 8);
  });

  it("gives every category its calls, money, articles made and opened, and the money per opened article", () => {
    const s = setup();
    const a = s.category("A");
    const b = s.category("B");
    const runA = s.run(a.id);
    const runB = s.run(b.id);
    s.call("2026-10-12T00:00:00.000Z", 1.5, { runId: runA, task: "judge" });
    s.call("2026-10-12T00:00:00.000Z", 0.5, { runId: runA });
    s.call("2026-10-12T00:00:00.000Z", 0.3, { runId: runB });
    s.call("2026-10-12T00:00:00.000Z", null, { runId: runB });
    for (const opened of [true, true, false, false]) s.article(a.id, "2026-10-12T00:00:00.000Z", opened ? "2026-10-13T00:00:00.000Z" : null);
    // Made before the period: neither made nor opened in it.
    s.article(a.id, "2026-10-09T00:00:00.000Z", "2026-10-13T00:00:00.000Z");
    // A feed article is not one the runs made.
    seedFeedArticle(s.db, seedFeed(s.db, { categoryId: a.id }), { title: "Feed" });
    s.article(b.id, "2026-10-12T00:00:00.000Z");

    const { byCategory } = s.runner.usageStatus();

    expect(byCategory.map((row) => row.name)).toEqual(["A", "B"]);
    expect(byCategory[0]).toEqual({
      categoryId: a.id,
      name: "A",
      calls: 2,
      costUsd: 2,
      unknownCostCalls: 0,
      articlesCreated: 4,
      articlesOpened: 2,
      costPerOpenedUsd: 1,
    });
    expect(byCategory[1]).toMatchObject({ calls: 2, unknownCostCalls: 1, articlesCreated: 1, articlesOpened: 0, costPerOpenedUsd: null });
    expect(byCategory[1]!.costUsd).toBeCloseTo(0.3, 8);
  });

  it("lists a category without calls or articles with zeros", () => {
    const s = setup();
    const a = s.category("A");

    expect(s.runner.usageStatus().byCategory).toEqual([
      { categoryId: a.id, name: "A", calls: 0, costUsd: 0, unknownCostCalls: 0, articlesCreated: 0, articlesOpened: 0, costPerOpenedUsd: null },
    ]);
  });

  it("puts the calls outside any run in one row, those to providers that cost nothing counted", () => {
    const s = setup();
    s.call("2026-10-12T00:00:00.000Z", 0.1, { task: "summarize" });
    s.call("2026-10-12T00:00:00.000Z", 0.1, { task: "summarize" });
    s.call("2026-10-12T00:00:00.000Z", undefined, { task: "translate" });
    s.call("2026-10-12T00:00:00.000Z", null, { task: "digest" });

    const { outsideRuns } = s.runner.usageStatus();

    expect(outsideRuns.calls).toBe(4);
    expect(outsideRuns.costUsd).toBeCloseTo(0.2, 8);
    expect(outsideRuns.unknownCostCalls).toBe(1);
  });

  it("leaves out the calls made before the period", () => {
    const s = setup();
    s.call("2026-10-09T23:59:00.000Z", 5, { task: "summarize" });

    const usage = s.runner.usageStatus();

    expect(usage.outsideRuns).toEqual({ calls: 0, costUsd: 0, unknownCostCalls: 0 });
    expect(usage.spentUsd).toBe(0);
  });

  it("splits the calls by UTC day from the first day of the period to today, days without calls included", () => {
    const s = setup({ now: "2026-10-14T12:00:00.000Z" });
    s.call("2026-10-12T23:59:00.000Z", 0.25);
    s.call("2026-10-13T00:01:00.000Z", 0.5);
    s.call("2026-10-13T08:00:00.000Z", undefined);

    const { byDay } = s.runner.usageStatus();

    expect(byDay).toEqual([
      { day: "2026-10-10", calls: 0, costUsd: 0 },
      { day: "2026-10-11", calls: 0, costUsd: 0 },
      { day: "2026-10-12", calls: 1, costUsd: 0.25 },
      { day: "2026-10-13", calls: 2, costUsd: 0.5 },
      { day: "2026-10-14", calls: 0, costUsd: 0 },
    ]);
  });

  it("adds up to the total of the budget, by day and by category with the row outside runs", () => {
    const s = setup();
    const a = s.category("A");
    const runA = s.run(a.id);
    for (const [index, cost] of [0.11, 0.27, 1.3, 0.07, null, 2.2].entries()) {
      s.call(`2026-10-${String(11 + index).padStart(2, "0")}T10:00:00.000Z`, cost, { runId: index % 2 === 0 ? runA : null });
    }

    const usage = s.runner.usageStatus();
    const spent = s.runner.budgetStatus().spentUsd;

    expect(usage.spentUsd).toBeCloseTo(spent, 10);
    expect(usage.byDay.reduce((sum, day) => sum + day.costUsd, 0)).toBeCloseTo(spent, 10);
    expect(usage.byCategory.reduce((sum, row) => sum + row.costUsd, usage.outsideRuns.costUsd)).toBeCloseTo(spent, 10);
    expect(usage.unknownCostCalls).toBe(1);
  });

  it("projects the money at the end of the period at the average pace so far, and says when it passes the budget", () => {
    // November has 30 days; ten of them have passed.
    const s = setup({ now: "2026-11-11T00:00:00.000Z", resetDay: 1 });
    s.call("2026-11-02T00:00:00.000Z", 40);

    const { projection } = s.runner.usageStatus();

    expect(projection.projectedUsd).toBeCloseTo(120, 8);
    expect(projection.exceedsBudget).toBe(true);
  });

  it("does not say that a projection within the budget passes it", () => {
    const s = setup({ now: "2026-11-11T00:00:00.000Z", resetDay: 1 });
    s.call("2026-11-02T00:00:00.000Z", 10);

    expect(s.runner.usageStatus().projection).toEqual({ projectedUsd: 30, exceedsBudget: false });
  });

  it("projects what was spent at the very start of the period", () => {
    const s = setup({ now: "2026-11-01T00:00:00.000Z", resetDay: 1 });

    expect(s.runner.usageStatus().projection).toEqual({ projectedUsd: 0, exceedsBudget: false });
  });

  it("says that no provider costs money, and still counts the calls", () => {
    const s = setup({ billable: false });
    s.call("2026-10-12T00:00:00.000Z", undefined, { task: "summarize" });

    const usage = s.runner.usageStatus();

    expect(usage.billable).toBe(false);
    expect(usage.outsideRuns).toEqual({ calls: 1, costUsd: 0, unknownCostCalls: 0 });
    expect(usage.byDay.find((day) => day.day === "2026-10-12")).toEqual({ day: "2026-10-12", calls: 1, costUsd: 0 });
  });
});
