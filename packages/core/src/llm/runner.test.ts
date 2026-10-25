import { describe, expect, it } from "vitest";
import type { TaskName } from "../api.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { LlmCallError, type LlmAdapter, type LlmRequest, type LlmUsage } from "./adapter.ts";
import { resolvePricing, type ModelPricing } from "./pricing.ts";
import { LlmLimitError, TaskFailedError, TaskRunner, type Provider } from "./runner.ts";

const interpretInput = { topicText: "Rust releases", kind: "news" as const, search: { language: "en", region: "US" } };
const validInterpretation = {
  queries: ["rust release"],
  criteria: "official releases",
  suggestedSources: { newsSearch: true, llmSearch: false },
};

/** An answer that comes with what the call used. */
class Billed {
  readonly answer: unknown;
  readonly usage: LlmUsage;

  constructor(answer: unknown, usage: LlmUsage) {
    this.answer = answer;
    this.usage = usage;
  }
}

/** What a call used: half a million input tokens cost $1 at the prices of Sonnet 5.5. */
const used = (inputTokens = 500_000): LlmUsage => ({ inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 });
const SONNET = resolvePricing("claude-sonnet-5-5")!;

/** An adapter that answers from a queue and remembers what it was asked. */
function scripted(answers: Array<unknown | Error | "hang">, webSearch = false) {
  const requests: LlmRequest[] = [];
  const adapter: LlmAdapter = {
    capabilities: { webSearch },
    complete(request) {
      requests.push(request);
      const answer = answers.shift();
      if (answer === "hang") {
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer instanceof Billed) return Promise.resolve({ answer: answer.answer, usage: answer.usage });
      return Promise.resolve({ answer, usage: null });
    },
  };
  return { adapter, requests };
}

function provider(name: string, adapter: LlmAdapter, pricing: ModelPricing | null = null): Provider {
  return { name, adapterKind: "fake", model: "m", pricing, adapter };
}

function setup(options: {
  providers: Provider[];
  assignment?: Partial<Record<TaskName, string>>;
  limits?: { llmCallsPerRun: number; llmCallsPerDay: number; summariesPerDay?: number };
  timeoutMs?: number;
  timeZone?: string;
  budget?: { monthlyBudgetUsd: number; warnRatio: number; resetDay: number };
}) {
  const db = createTestDb();
  const clock = fakeClock("2026-03-01T12:00:00.000Z");
  const first = options.providers[0]!.name;
  const runner = new TaskRunner({
    db,
    clock,
    providers: new Map(options.providers.map((p) => [p.name, p])),
    assignment: {
      interpret: first,
      search: first,
      judge: first,
      cluster: first,
      write: first,
      summarize: first,
      translate: first,
      ...options.assignment,
    },
    limits: options.limits ?? { llmCallsPerRun: 40, llmCallsPerDay: 300 },
    timeouts: { defaultMs: options.timeoutMs ?? 1000, searchMs: options.timeoutMs ?? 1000 },
    timeZone: () => options.timeZone ?? "UTC",
    budget: options.budget,
  });
  const calls = () => db.prepare("SELECT task, provider, ok, error FROM llm_calls ORDER BY id").all();
  return { db, clock, runner, calls };
}

describe("TaskRunner.run", () => {
  it("returns an output that matches the schema", async () => {
    const { adapter } = scripted([validInterpretation]);
    const { runner, calls } = setup({ providers: [provider("a", adapter)] });
    const budget = { runId: null, calls: 0 };

    await expect(runner.run("interpret", interpretInput, budget)).resolves.toEqual(validInterpretation);
    expect(budget.calls).toBe(1);
    expect(calls()).toEqual([{ task: "interpret", provider: "a", ok: 1, error: null }]);
  });

  it("hands the adapter the output schema without a $schema marker, which the claude command rejects", async () => {
    const { adapter, requests } = scripted([validInterpretation]);
    const { runner } = setup({ providers: [provider("a", adapter)] });

    await runner.run("interpret", interpretInput, { runId: null, calls: 0 });

    expect(requests[0]!.outputSchema).toMatchObject({ type: "object", required: ["queries", "criteria", "suggestedSources"] });
    expect(requests[0]!.outputSchema).not.toHaveProperty("$schema");
  });

  it("asks once more when the first output misses a required field, and uses the second", async () => {
    const { adapter, requests } = scripted([{ queries: ["x"] }, validInterpretation]);
    const { runner } = setup({ providers: [provider("a", adapter)] });
    const budget = { runId: null, calls: 0 };

    await expect(runner.run("interpret", interpretInput, budget)).resolves.toEqual(validInterpretation);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.prompt).toBe(requests[0]!.prompt);
    expect(budget.calls).toBe(2);
  });

  it("fails after two outputs that do not match the schema, without a third attempt", async () => {
    const { adapter, requests } = scripted([{ nope: 1 }, { nope: 2 }, validInterpretation]);
    const { runner, calls } = setup({ providers: [provider("a", adapter)] });

    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).rejects.toBeInstanceOf(TaskFailedError);
    expect(requests).toHaveLength(2);
    expect(calls().map((call) => call.ok)).toEqual([0, 0]);
  });

  it("does not retry when the provider itself fails", async () => {
    const { adapter, requests } = scripted([new Error("exit code 1"), validInterpretation]);
    const { runner } = setup({ providers: [provider("a", adapter)] });

    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).rejects.toThrow(/exit code 1/);
    expect(requests).toHaveLength(1);
  });

  it("gives up on a call that outlasts the time limit and records the timeout", async () => {
    const { adapter, requests } = scripted(["hang"]);
    const { runner, calls } = setup({ providers: [provider("a", adapter)], timeoutMs: 20 });

    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).rejects.toThrow(/timed out/);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(calls()).toEqual([{ task: "interpret", provider: "a", ok: 0, error: expect.stringContaining("timed out") }]);
  });

  it("runs each task on the provider assigned to it", async () => {
    const a = scripted([validInterpretation]);
    const b = scripted([{ results: [] }], true);
    const { runner } = setup({
      providers: [provider("a", a.adapter), provider("b", b.adapter)],
      assignment: { search: "b" },
    });
    const budget = { runId: null, calls: 0 };

    await runner.run("interpret", interpretInput, budget);
    await runner.run("search", { topicText: "t", criteria: "c", kind: "news", windowHours: 24, windowDays: null, now: "2026-03-01T12:00:00.000Z" }, budget);

    expect(a.requests).toHaveLength(1);
    expect(b.requests).toHaveLength(1);
    expect(a.requests[0]!.webSearch).toBe(false);
    expect(b.requests[0]!.webSearch).toBe(true);
  });
});

describe("TaskRunner limits", () => {
  it("stops calling the model once the run has used its allowance", async () => {
    const { adapter, requests } = scripted([validInterpretation, validInterpretation, validInterpretation]);
    const { runner } = setup({ providers: [provider("a", adapter)], limits: { llmCallsPerRun: 2, llmCallsPerDay: 300 } });
    const budget = { runId: null, calls: 0 };

    await runner.run("interpret", interpretInput, budget);
    await runner.run("interpret", interpretInput, budget);
    await expect(runner.run("interpret", interpretInput, budget)).rejects.toBeInstanceOf(LlmLimitError);
    expect(requests).toHaveLength(2);
  });

  it("stops calling the model once the day has used its allowance", async () => {
    const { adapter, requests } = scripted([validInterpretation, validInterpretation]);
    const { runner } = setup({ providers: [provider("a", adapter)], limits: { llmCallsPerRun: 40, llmCallsPerDay: 1 } });

    await runner.run("interpret", interpretInput, { runId: null, calls: 0 });
    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).rejects.toMatchObject({ scope: "day" });
    expect(requests).toHaveLength(1);
  });

  it("counts the day in the configured time zone", async () => {
    const { adapter } = scripted([validInterpretation, validInterpretation]);
    const { runner, clock } = setup({
      providers: [provider("a", adapter)],
      limits: { llmCallsPerRun: 40, llmCallsPerDay: 1 },
      timeZone: "Asia/Tokyo",
    });

    clock.set("2026-03-01T14:30:00.000Z"); // 23:30 on March 1 in Tokyo
    await runner.run("interpret", interpretInput, { runId: null, calls: 0 });
    clock.set("2026-03-01T15:30:00.000Z"); // 00:30 on March 2 in Tokyo
    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).resolves.toBeDefined();
    expect(runner.callsToday()).toBe(1);
  });
});

describe("TaskRunner.canSearch", () => {
  it("reports whether the provider assigned to the search task can search", () => {
    const plain = scripted([]);
    const searching = scripted([], true);
    expect(setup({ providers: [provider("a", plain.adapter)] }).runner.canSearch()).toBe(false);
    expect(
      setup({ providers: [provider("a", plain.adapter), provider("b", searching.adapter)], assignment: { search: "b" } }).runner.canSearch(),
    ).toBe(true);
  });
});

describe("the allowance of summaries", () => {
  const summarizeInput = { outputLanguage: "ja", title: "Headline", text: "The text of the article." };
  const fresh = () => ({ runId: null, calls: 0 });

  it("does not count summaries towards the day of the runs", async () => {
    const { adapter } = scripted([{ summary: "One." }, { summary: "Two." }, validInterpretation]);
    const { runner } = setup({ providers: [provider("a", adapter)], limits: { llmCallsPerRun: 40, llmCallsPerDay: 1, summariesPerDay: 2 } });

    await runner.run("summarize", summarizeInput, fresh());
    await runner.run("summarize", summarizeInput, fresh());
    expect(runner.canSummarize()).toBe(false);
    expect(runner.callsToday()).toBe(0);
    await expect(runner.run("interpret", interpretInput, fresh())).resolves.toBeDefined();
  });

  it("does not count the calls of runs towards the summaries", async () => {
    const { adapter } = scripted([validInterpretation, { summary: "One." }]);
    const { runner } = setup({ providers: [provider("a", adapter)], limits: { llmCallsPerRun: 40, llmCallsPerDay: 1, summariesPerDay: 1 } });

    await runner.run("interpret", interpretInput, fresh());
    expect(runner.summariesToday()).toBe(0);
    await expect(runner.run("summarize", summarizeInput, fresh())).resolves.toEqual({ summary: "One." });
    expect(runner.summariesToday()).toBe(1);
  });

  it("stops summarising once the day has used its allowance, and starts again the next day", async () => {
    const { adapter, requests } = scripted([{ summary: "One." }, { summary: "Two." }]);
    const { runner, clock } = setup({ providers: [provider("a", adapter)], limits: { llmCallsPerRun: 40, llmCallsPerDay: 300, summariesPerDay: 1 } });

    await runner.run("summarize", summarizeInput, fresh());
    await expect(runner.run("summarize", summarizeInput, fresh())).rejects.toMatchObject({ scope: "day" });
    expect(requests).toHaveLength(1);

    clock.advance(24 * 60 * 60_000);
    await expect(runner.run("summarize", summarizeInput, fresh())).resolves.toEqual({ summary: "Two." });
  });

  it("allows 100 summaries a day when no limit is given, and gives the model no tools", async () => {
    const { adapter, requests } = scripted([{ summary: "One." }]);
    const { runner, calls } = setup({ providers: [provider("a", adapter)] });

    expect(runner.limits.summariesPerDay).toBe(100);
    await runner.run("summarize", summarizeInput, fresh());
    expect(requests[0]!.webSearch).toBe(false);
    expect(calls()).toEqual([{ task: "summarize", provider: "a", ok: 1, error: null }]);
  });
});

describe("TaskRunner and the money the calls cost", () => {
  const costs = (db: ReturnType<typeof createTestDb>) =>
    db
      .prepare("SELECT task, provider, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost_usd, billable FROM llm_calls ORDER BY id")
      .all();

  it("keeps the tokens, the searches and the cost of each call, retries included", async () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 3, cacheWriteTokens: 4, webSearches: 2 };
    const { adapter } = scripted([new Billed({ queries: ["x"] }, usage), new Billed(validInterpretation, usage)]);
    const { runner, db } = setup({ providers: [provider("smart", adapter, SONNET)] });

    await runner.run("interpret", interpretInput, { runId: null, calls: 0 });

    const row = { task: "interpret", provider: "smart", input_tokens: 10_000, output_tokens: 1_000, cache_read_tokens: 3, cache_write_tokens: 4, web_searches: 2, billable: 1 };
    expect(costs(db)).toEqual([
      { ...row, cost_usd: expect.closeTo(0.0500103, 10) as number },
      { ...row, cost_usd: expect.closeTo(0.0500103, 10) as number },
    ]);
  });

  it("keeps the cost of a call that answered with something unusable", async () => {
    const { adapter } = scripted([new LlmCallError("the model declined to answer", used())]);
    const { runner, db } = setup({ providers: [provider("smart", adapter, SONNET)] });

    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).rejects.toBeInstanceOf(TaskFailedError);

    expect(costs(db)).toMatchObject([{ input_tokens: 500_000, cost_usd: 1, billable: 1 }]);
  });

  it("leaves the cost of a call that timed out unknown, and that of a provider that costs nothing empty", async () => {
    const paid = setup({ providers: [provider("smart", scripted(["hang"]).adapter, SONNET)], timeoutMs: 20 });
    const cli = setup({ providers: [provider("cli", scripted([validInterpretation]).adapter)] });

    await expect(paid.runner.run("interpret", interpretInput, { runId: null, calls: 0 })).rejects.toBeInstanceOf(TaskFailedError);
    await cli.runner.run("interpret", interpretInput, { runId: null, calls: 0 });

    expect(costs(paid.db)).toMatchObject([{ provider: "smart", input_tokens: null, cost_usd: null, billable: 1 }]);
    expect(costs(cli.db)).toMatchObject([{ provider: "cli", input_tokens: null, cost_usd: null, billable: 0 }]);
  });
});

describe("TaskRunner and the monthly budget", () => {
  const seedCost = (db: ReturnType<typeof createTestDb>, at: string, cost: number, task = "write", provider = "smart") =>
    db
      .prepare("INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES (NULL, ?, ?, 1, 1, ?, ?, 1)")
      .run(task, provider, at, cost);

  it("still calls at $99.99 of $100, and refuses the call after it", async () => {
    const { adapter, requests } = scripted([new Billed(validInterpretation, used(25_000)), validInterpretation]);
    const { runner, db } = setup({ providers: [provider("smart", adapter, SONNET)], budget: { monthlyBudgetUsd: 100, warnRatio: 0.8, resetDay: 1 } });
    seedCost(db, "2026-03-01T01:00:00.000Z", 99.99);

    await runner.run("interpret", interpretInput, { runId: null, calls: 0 });
    const error = await runner.run("interpret", interpretInput, { runId: null, calls: 0 }).catch((caught: unknown) => caught);

    expect(requests).toHaveLength(1);
    expect(error).toBeInstanceOf(LlmLimitError);
    expect((error as LlmLimitError).scope).toBe("budget");
    expect(runner.budgetStatus().spentUsd).toBeCloseTo(100.04, 8);
  });

  it("keeps calling a provider that costs nothing once the budget is used up", async () => {
    const paid = scripted([]);
    const free = scripted([validInterpretation]);
    const { runner, db } = setup({
      providers: [provider("smart", paid.adapter, SONNET), provider("cli", free.adapter)],
      assignment: { interpret: "cli" },
    });
    seedCost(db, "2026-03-01T01:00:00.000Z", 100);

    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).resolves.toEqual(validInterpretation);
    await expect(runner.run("summarize", { outputLanguage: "ja", title: "t", text: "x" }, { runId: null, calls: 0 })).rejects.toMatchObject({
      scope: "budget",
    });
  });

  it("calls again once the next budget period has started", async () => {
    const { adapter } = scripted([validInterpretation]);
    const { runner, db, clock } = setup({ providers: [provider("smart", adapter, SONNET)], budget: { monthlyBudgetUsd: 100, warnRatio: 0.8, resetDay: 10 } });
    clock.set("2026-03-09T23:00:00.000Z");
    seedCost(db, "2026-03-09T22:00:00.000Z", 100);
    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).rejects.toBeInstanceOf(LlmLimitError);

    clock.set("2026-03-10T00:00:00.000Z");
    await expect(runner.run("interpret", interpretInput, { runId: null, calls: 0 })).resolves.toEqual(validInterpretation);
  });

  it("reports the period, the total, and the money by task and by provider, with the calls of unknown cost", () => {
    const { adapter } = scripted([]);
    const { runner, db, clock } = setup({
      providers: [provider("fast", adapter, SONNET), provider("smart", adapter, SONNET), provider("cli", adapter)],
      budget: { monthlyBudgetUsd: 100, warnRatio: 0.8, resetDay: 10 },
    });
    clock.set("2026-10-25T12:00:00.000Z");
    seedCost(db, "2026-10-12T00:00:00.000Z", 1.2, "judge", "fast");
    seedCost(db, "2026-10-13T00:00:00.000Z", 3.4, "write", "smart");
    seedCost(db, "2026-10-09T23:59:59.000Z", 50, "write", "smart");
    db.prepare("INSERT INTO llm_calls (task, provider, duration_ms, ok, error, created_at, billable) VALUES ('judge', 'fast', 1, 0, 'timed out', ?, 1)").run(
      "2026-10-14T00:00:00.000Z",
    );

    const status = runner.budgetStatus();

    expect(status).toMatchObject({ periodStart: "2026-10-10", periodEnd: "2026-11-09", monthlyBudgetUsd: 100, warnRatio: 0.8, unknownCostCalls: 1 });
    expect(status.spentUsd).toBeCloseTo(4.6, 8);
    expect(status.byTask).toEqual({ interpret: 0, search: 0, judge: 1.2, cluster: 0, write: 3.4, summarize: 0, translate: 0 });
    expect(status.byProvider).toEqual({ fast: 1.2, smart: 3.4, cli: 0 });
  });
});
