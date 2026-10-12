import type { Run } from "../api.ts";
import type { Clock } from "../clock.ts";
import { getCategory } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import { createRun, findActiveRun, findRun, finishRun, planRetry, retryDelayMs } from "../db/runs.ts";
import { DomainError } from "../errors.ts";

export interface RunQueueOptions {
  db: Database;
  clock: Clock;
  /** Carries out one run. The pipeline in production; a stand-in in tests. */
  execute: (runId: number) => Promise<unknown>;
  /** How often a scheduled run that failed is tried again. Left out, nothing is retried. */
  retries?: number;
}

/** Runs wait here and are carried out one at a time, in the order they arrived. */
export class RunQueue {
  readonly #options: RunQueueOptions;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: RunQueueOptions) {
    this.#options = options;
  }

  /**
   * Adds a run. A manual request for a category that is already waiting or running is refused; a scheduled
   * run is queued behind it. A retry names which retry it is and the scheduled run it retries.
   */
  enqueue(categoryId: number, trigger: Run["trigger"], slot: string | null, retry?: { attempt: number; of: number }): Run {
    const { db, clock } = this.#options;
    getCategory(db, categoryId);
    if (trigger === "manual") {
      const active = findActiveRun(db, categoryId);
      if (active) {
        throw new DomainError("conflict", `run ${active.id} of this category is already ${active.status}`);
      }
    }
    const run = createRun(db, { categoryId, trigger, slot, retry }, clock);
    this.#tail = this.#tail.then(() => this.#carryOut(run.id));
    return run;
  }

  /** Resolves when every queued run has ended. */
  idle(): Promise<void> {
    return this.#tail;
  }

  async #carryOut(runId: number): Promise<void> {
    const { db, clock, execute } = this.#options;
    try {
      await execute(runId);
    } catch (error) {
      // Nothing may escape from here: a rejection would stop every run queued behind this one.
      const run = findRun(db, runId);
      if (!run) return; // the run went away with its category
      finishRun(db, runId, {
        status: "failed",
        finishedAt: clock().toISOString(),
        collected: run.collected,
        rejected: run.rejected,
        articlesCreated: run.articlesCreated,
        articlesUpdated: run.articlesUpdated,
        llmCalls: run.llmCalls,
        failures: [...run.failures, { stage: "run", target: null, message: error instanceof Error ? error.message : String(error) }],
      });
    }
    this.#planRetry(runId);
  }

  /** A run that ended as failed is given the time of its retry, or the reason it has none. */
  #planRetry(runId: number): void {
    const { db, clock, retries = 0 } = this.#options;
    try {
      const run = findRun(db, runId);
      if (run?.status !== "failed") return;
      const failedAt = run.finishedAt ? new Date(run.finishedAt) : clock();
      planRetry(db, run, retries, new Date(failedAt.getTime() + retryDelayMs(run.attempt)));
    } catch (error) {
      // As above, nothing may escape: the runs queued behind this one must still start.
      console.error("run queue:", error);
    }
  }
}
