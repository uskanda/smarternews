import { z } from "zod";
import type { BudgetStatus, TaskName } from "../api.ts";
import type { Clock } from "../clock.ts";
import type { Database } from "../db/database.ts";
import { num } from "../db/rows.ts";
import { budgetPeriod, startOfLocalDay } from "../time.ts";
import { LlmCallError, type LlmAdapter, type LlmCompletion, type LlmUsage } from "./adapter.ts";
import { costOf, type ModelPricing } from "./pricing.ts";
import { TASK_NAMES, tasks, type TaskDefinition, type TaskIo } from "./tasks.ts";

export interface Provider {
  name: string;
  adapterKind: string;
  model: string;
  /** The prices of a provider that costs money; null for one that does not, whose calls the budget ignores. */
  pricing: ModelPricing | null;
  adapter: LlmAdapter;
}

export type LimitScope = "run" | "day" | "budget";

const LIMIT_MESSAGE: Record<LimitScope, string> = {
  run: "the run reached its limit of model calls",
  day: "the day reached its limit of model calls",
  budget: "the budget period used up its monthly budget",
};

/** The model was not called because an allowance is used up. */
export class LlmLimitError extends Error {
  readonly scope: LimitScope;

  constructor(scope: LimitScope) {
    super(LIMIT_MESSAGE[scope]);
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

/** Summaries of feed articles a day, unless the configuration says otherwise. */
const SUMMARIES_PER_DAY = 100;

export interface TaskLimits {
  llmCallsPerRun: number;
  /** Calls for runs. Summaries of feed articles are not counted here. */
  llmCallsPerDay: number;
  /** Calls that summarise feed articles. The calls of runs are not counted here. */
  summariesPerDay: number;
}

/** The money the providers that cost money may use, and when its period starts again. */
export interface BudgetLimits {
  monthlyBudgetUsd: number;
  warnRatio: number;
  /** The day of the month on which a period starts, at midnight UTC. */
  resetDay: number;
}

const DEFAULT_BUDGET: BudgetLimits = { monthlyBudgetUsd: 100, warnRatio: 0.8, resetDay: 1 };

export interface TaskRunnerOptions {
  db: Database;
  clock: Clock;
  providers: Map<string, Provider>;
  assignment: Record<TaskName, string>;
  limits: Omit<TaskLimits, "summariesPerDay"> & { summariesPerDay?: number };
  timeouts: { defaultMs: number; searchMs: number };
  timeZone: () => string;
  budget?: BudgetLimits;
}

export class TaskRunner {
  readonly #options: TaskRunnerOptions;

  constructor(options: TaskRunnerOptions) {
    this.#options = options;
  }

  get limits(): TaskLimits {
    return { summariesPerDay: SUMMARIES_PER_DAY, ...this.#options.limits };
  }

  providerFor(task: TaskName): Provider {
    return this.#options.providers.get(this.#options.assignment[task])!;
  }

  /** Providers and assignments for display. Holds no credentials. */
  describe(): {
    providers: Array<{ name: string; adapter: string; model: string; webSearch: boolean; billable: boolean }>;
    tasks: Record<TaskName, string>;
  } {
    return {
      providers: [...this.#options.providers.values()].map((provider) => ({
        name: provider.name,
        adapter: provider.adapterKind,
        model: provider.model,
        webSearch: provider.adapter.capabilities.webSearch,
        billable: provider.pricing !== null,
      })),
      tasks: { ...this.#options.assignment },
    };
  }

  get budget(): BudgetLimits {
    return this.#options.budget ?? DEFAULT_BUDGET;
  }

  #period() {
    return budgetPeriod(this.#options.clock(), this.budget.resetDay);
  }

  /** US dollars the providers that cost money used in the current budget period. */
  spentThisPeriod(): number {
    const { start, end } = this.#period();
    return num(
      this.#options.db
        .prepare("SELECT coalesce(sum(cost_usd), 0) AS n FROM llm_calls WHERE billable = 1 AND created_at >= ? AND created_at < ?")
        .get(start.toISOString(), end.toISOString())!.n,
    );
  }

  budgetStatus(): BudgetStatus {
    const { db } = this.#options;
    const { start, end, firstDay, lastDay } = this.#period();
    const range = [start.toISOString(), end.toISOString()];
    const byTask = Object.fromEntries(TASK_NAMES.map((task) => [task, 0])) as Record<TaskName, number>;
    const byProvider = Object.fromEntries([...this.#options.providers.keys()].map((name) => [name, 0]));
    const rows = db
      .prepare(
        `SELECT task, provider, sum(cost_usd) AS cost FROM llm_calls
          WHERE billable = 1 AND cost_usd IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY task, provider`,
      )
      .all(...range);
    let spentUsd = 0;
    for (const row of rows) {
      const cost = Number(row.cost);
      spentUsd += cost;
      byTask[String(row.task) as TaskName] = (byTask[String(row.task) as TaskName] ?? 0) + cost;
      byProvider[String(row.provider)] = (byProvider[String(row.provider)] ?? 0) + cost;
    }
    const unknown = db
      .prepare("SELECT count(*) AS n FROM llm_calls WHERE billable = 1 AND cost_usd IS NULL AND created_at >= ? AND created_at < ?")
      .get(...range)!.n;
    const { monthlyBudgetUsd, warnRatio } = this.budget;
    return { periodStart: firstDay, periodEnd: lastDay, spentUsd, monthlyBudgetUsd, warnRatio, unknownCostCalls: num(unknown), byTask, byProvider };
  }

  canSearch(): boolean {
    return this.providerFor("search").adapter.capabilities.webSearch;
  }

  /**
   * Model calls made for runs since the start of the current day in the configured time zone. Summaries of
   * feed articles have an allowance of their own, so that neither uses up the other's.
   */
  callsToday(): number {
    return this.#countToday("task <> 'summarize'");
  }

  /** Calls that summarised a feed article since the start of the current day. */
  summariesToday(): number {
    return this.#countToday("task = 'summarize'");
  }

  /** False once the day has used its allowance of summaries. */
  canSummarize(): boolean {
    return this.summariesToday() < this.limits.summariesPerDay;
  }

  #countToday(condition: string): number {
    const { db, clock, timeZone } = this.#options;
    const since = startOfLocalDay(clock(), timeZone()).toISOString();
    return num(db.prepare(`SELECT count(*) AS n FROM llm_calls WHERE ${condition} AND created_at >= ?`).get(since)!.n);
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
      this.#spend(name, budget, provider);
      const started = Date.now();
      let completion: LlmCompletion;
      try {
        completion = await this.#call(provider, { system, prompt, outputSchema, webSearch: name === "search", timeoutMs });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const usage = error instanceof LlmCallError ? error.usage : null;
        this.#record(budget, name, provider, Date.now() - started, message, usage);
        throw new TaskFailedError(name, message);
      }
      const parsed = definition.output.safeParse(completion.answer);
      problem = parsed.success
        ? (definition.check?.(input, parsed.data) ?? "")
        : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      this.#record(budget, name, provider, Date.now() - started, problem.length > 0 ? `invalid output: ${problem}` : null, completion.usage);
      if (parsed.success && problem.length === 0) return parsed.data;
    }
    throw new TaskFailedError(name, `the output did not match the schema twice (${problem})`);
  }

  #spend(task: TaskName, budget: CallBudget, provider: Provider): void {
    if (task === "summarize") {
      if (!this.canSummarize()) throw new LlmLimitError("day");
    } else {
      if (budget.calls >= this.#options.limits.llmCallsPerRun) throw new LlmLimitError("run");
      if (this.callsToday() >= this.#options.limits.llmCallsPerDay) throw new LlmLimitError("day");
    }
    // Judged on what was spent before the call: one call can take the period a little past its budget.
    if (provider.pricing && this.spentThisPeriod() >= this.budget.monthlyBudgetUsd) throw new LlmLimitError("budget");
    budget.calls += 1;
  }

  async #call(
    provider: Provider,
    request: { system: string; prompt: string; outputSchema: Record<string, unknown>; webSearch: boolean; timeoutMs: number },
  ): Promise<LlmCompletion> {
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

  #record(budget: CallBudget, task: TaskName, provider: Provider, durationMs: number, error: string | null, usage: LlmUsage | null): void {
    const cost = provider.pricing && usage ? costOf(provider.pricing, usage) : null;
    this.#options.db
      .prepare(
        `INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, error, created_at,
                                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost_usd, billable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        budget.runId,
        task,
        provider.name,
        durationMs,
        error === null ? 1 : 0,
        error,
        this.#options.clock().toISOString(),
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.cacheReadTokens ?? null,
        usage?.cacheWriteTokens ?? null,
        usage?.webSearches ?? null,
        cost,
        provider.pricing ? 1 : 0,
      );
  }
}
