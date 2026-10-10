import { z } from "zod";
import type { TaskName } from "../api.ts";
import type { Clock } from "../clock.ts";
import type { Database } from "../db/database.ts";
import { num } from "../db/rows.ts";
import { startOfLocalDay } from "../time.ts";
import type { LlmAdapter } from "./adapter.ts";
import { tasks, type TaskDefinition, type TaskIo } from "./tasks.ts";

export interface Provider {
  name: string;
  adapterKind: string;
  model: string;
  adapter: LlmAdapter;
}

/** The model was not called because an allowance is used up. */
export class LlmLimitError extends Error {
  readonly scope: "run" | "day";

  constructor(scope: "run" | "day") {
    super(scope === "run" ? "the run reached its limit of model calls" : "the day reached its limit of model calls");
    this.name = "LlmLimitError";
    this.scope = scope;
  }
}

/** The task produced nothing usable: the provider failed, timed out, or answered outside the schema twice. */
export class TaskFailedError extends Error {
  readonly task: TaskName;

  constructor(task: TaskName, message: string) {
    super(`${task}: ${message}`);
    this.name = "TaskFailedError";
    this.task = task;
  }
}

/** Counts the model calls of one run. */
export interface CallBudget {
  runId: number | null;
  calls: number;
}

export interface TaskRunnerOptions {
  db: Database;
  clock: Clock;
  providers: Map<string, Provider>;
  assignment: Record<TaskName, string>;
  limits: { llmCallsPerRun: number; llmCallsPerDay: number };
  timeouts: { defaultMs: number; searchMs: number };
  timeZone: () => string;
}

export class TaskRunner {
  readonly #options: TaskRunnerOptions;

  constructor(options: TaskRunnerOptions) {
    this.#options = options;
  }

  get limits(): { llmCallsPerRun: number; llmCallsPerDay: number } {
    return this.#options.limits;
  }

  providerFor(task: TaskName): Provider {
    return this.#options.providers.get(this.#options.assignment[task])!;
  }

  /** Providers and assignments for display. Holds no credentials. */
  describe(): { providers: Array<{ name: string; adapter: string; model: string; webSearch: boolean }>; tasks: Record<TaskName, string> } {
    return {
      providers: [...this.#options.providers.values()].map((provider) => ({
        name: provider.name,
        adapter: provider.adapterKind,
        model: provider.model,
        webSearch: provider.adapter.capabilities.webSearch,
      })),
      tasks: { ...this.#options.assignment },
    };
  }

  canSearch(): boolean {
    return this.providerFor("search").adapter.capabilities.webSearch;
  }

  /** Model calls made since the start of the current day in the configured time zone. */
  callsToday(): number {
    const { db, clock, timeZone } = this.#options;
    const since = startOfLocalDay(clock(), timeZone()).toISOString();
    return num(db.prepare("SELECT count(*) AS n FROM llm_calls WHERE created_at >= ?").get(since)!.n);
  }

  async run<N extends TaskName>(name: N, input: TaskIo[N]["input"], budget: CallBudget): Promise<TaskIo[N]["output"]> {
    const definition = tasks[name] as unknown as TaskDefinition<TaskIo[N]["input"], TaskIo[N]["output"]>;
    const provider = this.providerFor(name);
    const { system, prompt } = definition.build(input);
    // The dialect marker is dropped: the claude command refuses a schema that carries it.
    const { $schema: _dialect, ...outputSchema } = z.toJSONSchema(definition.output) as Record<string, unknown>;
    const timeoutMs = name === "search" ? this.#options.timeouts.searchMs : this.#options.timeouts.defaultMs;

    let problem = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      this.#spend(budget);
      const started = Date.now();
      let raw: unknown;
      try {
        raw = await this.#call(provider, { system, prompt, outputSchema, webSearch: name === "search", timeoutMs });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#record(budget, name, provider, Date.now() - started, message);
        throw new TaskFailedError(name, message);
      }
      const parsed = definition.output.safeParse(raw);
      problem = parsed.success
        ? (definition.check?.(input, parsed.data) ?? "")
        : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      this.#record(budget, name, provider, Date.now() - started, problem.length > 0 ? `invalid output: ${problem}` : null);
      if (parsed.success && problem.length === 0) return parsed.data;
    }
    throw new TaskFailedError(name, `the output did not match the schema twice (${problem})`);
  }

  #spend(budget: CallBudget): void {
    if (budget.calls >= this.#options.limits.llmCallsPerRun) throw new LlmLimitError("run");
    if (this.callsToday() >= this.#options.limits.llmCallsPerDay) throw new LlmLimitError("day");
    budget.calls += 1;
  }

  async #call(
    provider: Provider,
    request: { system: string; prompt: string; outputSchema: Record<string, unknown>; webSearch: boolean; timeoutMs: number },
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Reject before aborting: the adapter rejects as soon as it sees the abort, and the timeout must win.
        reject(new Error(`timed out after ${request.timeoutMs} ms`));
        controller.abort();
      }, request.timeoutMs);
    });
    try {
      return await Promise.race([provider.adapter.complete({ ...request, signal: controller.signal }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  #record(budget: CallBudget, task: TaskName, provider: Provider, durationMs: number, error: string | null): void {
    this.#options.db
      .prepare("INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(budget.runId, task, provider.name, durationMs, error === null ? 1 : 0, error, this.#options.clock().toISOString());
  }
}
