import type { RetrySkipped, Run, RunFailure, RunStatus } from "../api.ts";
import type { Clock } from "../clock.ts";
import { notFound } from "../errors.ts";
import type { Database } from "./database.ts";
import { json, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";

function toRun(row: Row): Run {
  return {
    id: num(row.id),
    categoryId: num(row.category_id),
    trigger: str(row.trigger) as Run["trigger"],
    slot: strOrNull(row.slot),
    status: str(row.status) as RunStatus,
    queuedAt: str(row.queued_at),
    startedAt: strOrNull(row.started_at),
    finishedAt: strOrNull(row.finished_at),
    collected: num(row.collected),
    rejected: num(row.rejected),
    articlesCreated: num(row.articles_created),
    articlesUpdated: num(row.articles_updated),
    llmCalls: num(row.llm_calls),
    failures: json<RunFailure[]>(row.failures),
    attempt: num(row.attempt),
    retryOf: numOrNull(row.retry_of),
    retryAt: strOrNull(row.retry_at),
    retrySkipped: strOrNull(row.retry_skipped) as RetrySkipped | null,
  };
}

export function createRun(
  db: Database,
  input: { categoryId: number; trigger: Run["trigger"]; slot: string | null; retry?: { attempt: number; of: number } },
  clock: Clock,
): Run {
  const result = db
    .prepare("INSERT INTO runs (category_id, trigger, slot, status, queued_at, attempt, retry_of) VALUES (?, ?, ?, 'queued', ?, ?, ?)")
    .run(input.categoryId, input.trigger, input.slot, clock().toISOString(), input.retry?.attempt ?? 0, input.retry?.of ?? null);
  return getRun(db, num(result.lastInsertRowid));
}

export function findRun(db: Database, id: number): Run | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  return row ? toRun(row) : null;
}

export function getRun(db: Database, id: number): Run {
  const run = findRun(db, id);
  if (!run) throw notFound("run", id);
  return run;
}

export function listRuns(db: Database, filter: { categoryId?: number; limit?: number } = {}): Run[] {
  const limit = Math.min(filter.limit ?? 50, 200);
  const rows =
    filter.categoryId === undefined
      ? db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit)
      : db.prepare("SELECT * FROM runs WHERE category_id = ? ORDER BY id DESC LIMIT ?").all(filter.categoryId, limit);
  return rows.map(toRun);
}

/** The run of this category that is waiting or in progress, if there is one. */
export function findActiveRun(db: Database, categoryId: number): Run | null {
  const row = db
    .prepare("SELECT * FROM runs WHERE category_id = ? AND status IN ('queued', 'running') ORDER BY id LIMIT 1")
    .get(categoryId);
  return row ? toRun(row) : null;
}

export function hasRunForSlot(db: Database, categoryId: number, slot: string): boolean {
  return db.prepare("SELECT 1 FROM runs WHERE category_id = ? AND slot = ?").get(categoryId, slot) !== undefined;
}

export function startRun(db: Database, id: number, startedAt: string): void {
  db.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(startedAt, id);
}

export interface RunOutcome {
  status: Exclude<RunStatus, "queued" | "running">;
  finishedAt: string;
  collected: number;
  rejected: number;
  articlesCreated: number;
  articlesUpdated: number;
  llmCalls: number;
  failures: RunFailure[];
}

export function finishRun(db: Database, id: number, outcome: RunOutcome): Run {
  db.prepare(
    `UPDATE runs
        SET status = ?, finished_at = ?, collected = ?, rejected = ?, articles_created = ?, articles_updated = ?,
            llm_calls = ?, failures = ?
      WHERE id = ?`,
  ).run(
    outcome.status,
    outcome.finishedAt,
    outcome.collected,
    outcome.rejected,
    outcome.articlesCreated,
    outcome.articlesUpdated,
    outcome.llmCalls,
    JSON.stringify(outcome.failures),
    id,
  );
  return getRun(db, id);
}

/** Records when a failed run is retried, or why it is not. `null` clears both. */
export function setRetry(db: Database, id: number, plan: { at: string } | { skipped: RetrySkipped } | null): void {
  db.prepare("UPDATE runs SET retry_at = ?, retry_skipped = ? WHERE id = ?").run(
    plan && "at" in plan ? plan.at : null,
    plan && "skipped" in plan ? plan.skipped : null,
    id,
  );
}

const MINUTE = 60_000;
/** How long after a failure the first, the second and the third retry start. */
const RETRY_DELAYS_MS = [10 * MINUTE, 30 * MINUTE, 90 * MINUTE];

/** How long the retry that follows a failed run waits. `attempt` is that of the run that failed. */
export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
}

/**
 * Decides what follows a failed run. A scheduled run, or a retry of one, is retried at `at` while fewer than
 * `retries` retries were made; a manual run never is.
 */
export function planRetry(db: Database, run: Run, retries: number, at: Date): void {
  if (run.trigger === "manual") setRetry(db, run.id, { skipped: "manual" });
  else if (run.attempt >= retries) setRetry(db, run.id, { skipped: "limit" });
  else setRetry(db, run.id, { at: at.toISOString() });
}

/** Failed runs whose retry is due at `now`, the one due first at the head. */
export function listDueRetries(db: Database, now: string): Run[] {
  return db.prepare("SELECT * FROM runs WHERE retry_at IS NOT NULL AND retry_at <= ? ORDER BY retry_at, id").all(now).map(toRun);
}

/** Whether the category has a run of a scheduled time that was recorded after the run `afterId`. */
export function hasLaterScheduledRun(db: Database, categoryId: number, afterId: number): boolean {
  return db.prepare("SELECT 1 FROM runs WHERE category_id = ? AND slot IS NOT NULL AND id > ?").get(categoryId, afterId) !== undefined;
}

function closeInterrupted(db: Database, row: Row, finishedAt: string, message: string): void {
  const failures = [...json<RunFailure[]>(row.failures), { stage: "run", target: null, message }];
  db.prepare("UPDATE runs SET status = 'failed', finished_at = ?, failures = ? WHERE id = ?").run(finishedAt, JSON.stringify(failures), num(row.id));
}

/**
 * Settles the runs a server that stopped left behind. A run that was in progress is closed as failed; it
 * counts as an attempt, and its retry, when one is left, is due at once. A run that was still waiting stays
 * as it is and is handed back, in the order it was queued, to be queued again. One that has waited longer
 * than `staleAfterMs` is closed instead: its scheduled time is too far in the past to be made up for.
 */
export function recoverInterruptedRuns(
  db: Database,
  clock: Clock,
  options: { retries: number; staleAfterMs: number },
): { closed: number; waiting: number[] } {
  const now = clock();
  const staleBefore = new Date(now.getTime() - options.staleAfterMs).toISOString();
  const waiting: number[] = [];
  let closed = 0;
  for (const row of db.prepare("SELECT * FROM runs WHERE status IN ('queued', 'running') ORDER BY id").all()) {
    if (str(row.status) === "running") {
      closeInterrupted(db, row, now.toISOString(), "interrupted: the server stopped before the run finished");
      planRetry(db, toRun(row), options.retries, now);
      closed += 1;
    } else if (str(row.queued_at) < staleBefore) {
      closeInterrupted(db, row, now.toISOString(), "interrupted: the server stopped before the run started, and it waited too long to start now");
      closed += 1;
    } else {
      waiting.push(num(row.id));
    }
  }
  return { closed, waiting };
}

export function deleteRunsBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM runs WHERE queued_at < ? AND status NOT IN ('queued', 'running')").run(before).changes);
}
