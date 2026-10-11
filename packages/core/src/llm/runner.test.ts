import { describe, expect, it } from "vitest";
import type { TaskName } from "../api.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import type { LlmAdapter, LlmRequest } from "./adapter.ts";
import { LlmLimitError, TaskFailedError, TaskRunner, type Provider } from "./runner.ts";

const interpretInput = { topicText: "Rust releases", kind: "news" as const, search: { language: "en", region: "US" } };
const validInterpretation = {
  queries: ["rust release"],
  criteria: "official releases",
  suggestedSources: { newsSearch: true, llmSearch: false },
};

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
      return Promise.resolve(answer);
    },
  };
  return { adapter, requests };
}

function provider(name: string, adapter: LlmAdapter): Provider {
  return { name, adapterKind: "fake", model: "m", adapter };
}

function setup(options: {
  providers: Provider[];
  assignment?: Partial<Record<TaskName, string>>;
  limits?: { llmCallsPerRun: number; llmCallsPerDay: number; summariesPerDay?: number };
  timeoutMs?: number;
  timeZone?: string;
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
      ...options.assignment,
    },
    limits: options.limits ?? { llmCallsPerRun: 40, llmCallsPerDay: 300 },
    timeouts: { defaultMs: options.timeoutMs ?? 1000, searchMs: options.timeoutMs ?? 1000 },
    timeZone: () => options.timeZone ?? "UTC",
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
