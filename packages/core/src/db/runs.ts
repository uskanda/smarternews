import type { Run, RunFailure, RunStatus } from "../api.ts";
import type { Clock } from "../clock.ts";
import { notFound } from "../errors.ts";
import type { Database } from "./database.ts";
import { json, num, str, strOrNull, type Row } from "./rows.ts";

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
  };
}

export function createRun(
  db: Database,
  input: { categoryId: number; trigger: Run["trigger"]; slot: string | null },
  clock: Clock,
): Run {
  const result = db
    .prepare("INSERT INTO runs (category_id, trigger, slot, status, queued_at) VALUES (?, ?, ?, 'queued', ?)")
    .run(input.categoryId, input.trigger, input.slot, clock().toISOString());
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

/** Runs left waiting or in progress by a server that stopped are closed as failed. Returns how many. */
export function failInterruptedRuns(db: Database, clock: Clock): number {
  const rows = db.prepare("SELECT id, failures FROM runs WHERE status IN ('queued', 'running')").all();
  for (const row of rows) {
    const failures = [
      ...json<RunFailure[]>(row.failures),
      { stage: "run", target: null, message: "interrupted: the server stopped before the run finished" },
    ];
    db.prepare("UPDATE runs SET status = 'failed', finished_at = ?, failures = ? WHERE id = ?").run(
      clock().toISOString(),
      JSON.stringify(failures),
      num(row.id),
    );
  }
  return rows.length;
}

export function deleteRunsBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM runs WHERE queued_at < ? AND status NOT IN ('queued', 'running')").run(before).changes);
}
