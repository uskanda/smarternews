import type { Database } from "./database.ts";
import { bool, num, str, strOrNull, type Row } from "./rows.ts";

/** One search a run made, as the attention items read it. */
export interface SearchAttempt {
  id: number;
  runId: number;
  topicId: number;
  kind: "news-search" | "llm-search";
  /** Null for web search by the model. */
  engine: string | null;
  /** The query of news search, or the topic's text for web search by the model. */
  query: string;
  ok: boolean;
  /** The results the source returned, before those an earlier run settled were left out. */
  returned: number;
  googleAttempted: number;
  googleUnresolved: number;
  createdAt: string;
}

export type SearchAttemptInput = Omit<SearchAttempt, "id">;

function toAttempt(row: Row): SearchAttempt {
  return {
    id: num(row.id),
    runId: num(row.run_id),
    topicId: num(row.topic_id),
    kind: str(row.kind) as SearchAttempt["kind"],
    engine: strOrNull(row.engine),
    query: str(row.query),
    ok: bool(row.ok),
    returned: num(row.returned),
    googleAttempted: num(row.google_attempted),
    googleUnresolved: num(row.google_unresolved),
    createdAt: str(row.created_at),
  };
}

export function recordSearchAttempt(db: Database, input: SearchAttemptInput): void {
  db.prepare(
    `INSERT INTO search_attempts (run_id, topic_id, kind, engine, query, ok, returned, google_attempted, google_unresolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.runId,
    input.topicId,
    input.kind,
    input.engine,
    input.query,
    input.ok ? 1 : 0,
    input.returned,
    input.googleAttempted,
    input.googleUnresolved,
    input.createdAt,
  );
}

/** The searches of one run, in the order they were made. */
export function listSearchAttempts(db: Database, runId: number): SearchAttempt[] {
  return db.prepare("SELECT * FROM search_attempts WHERE run_id = ? ORDER BY id").all(runId).map(toAttempt);
}

/** Every search still on record, the oldest first. The records of 30 days of one person's topics are few. */
export function listAllSearchAttempts(db: Database): SearchAttempt[] {
  return db.prepare("SELECT * FROM search_attempts ORDER BY id").all().map(toAttempt);
}

export function deleteSearchAttemptsBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM search_attempts WHERE created_at < ?").run(before).changes);
}
