import type { Candidate, SourceKind } from "../api.ts";
import type { Database } from "./database.ts";
import { bool, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";

export function isSeenUrl(db: Database, categoryId: number, url: string): boolean {
  return db.prepare("SELECT 1 FROM seen_urls WHERE category_id = ? AND url = ?").get(categoryId, url) !== undefined;
}

export function markSeen(db: Database, categoryId: number, urls: string[], now: string): void {
  const statement = db.prepare("INSERT OR IGNORE INTO seen_urls (category_id, url, first_seen_at) VALUES (?, ?, ?)");
  for (const url of urls) statement.run(categoryId, url, now);
}

export interface NewCandidate {
  categoryId: number;
  runId: number;
  url: string;
  fetchable: boolean;
  title: string;
  snippet: string;
  siteName: string;
  publishedAt: string | null;
  sourceKind: SourceKind;
  status: "rejected" | "pending";
  reason: string;
  importance: number | null;
  topicIds: number[];
  now: string;
}

export function insertCandidate(db: Database, candidate: NewCandidate): number {
  const result = db
    .prepare(
      `INSERT INTO candidates
         (category_id, run_id, url, fetchable, title, snippet, site_name, published_at, source_kind, status, reason,
          importance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      candidate.categoryId,
      candidate.runId,
      candidate.url,
      candidate.fetchable ? 1 : 0,
      candidate.title,
      candidate.snippet,
      candidate.siteName,
      candidate.publishedAt,
      candidate.sourceKind,
      candidate.status,
      candidate.reason,
      candidate.importance,
      candidate.now,
    );
  const id = num(result.lastInsertRowid);
  const link = db.prepare("INSERT OR IGNORE INTO candidate_topics (candidate_id, topic_id) VALUES (?, ?)");
  for (const topicId of candidate.topicIds) link.run(id, topicId);
  return id;
}

/** A relevant candidate that is waiting to be written into an article. */
export interface PendingCandidate {
  id: number;
  url: string;
  fetchable: boolean;
  title: string;
  snippet: string;
  siteName: string;
  publishedAt: string | null;
  importance: number;
  topicIds: number[];
}

function topicIdsOf(db: Database, candidateId: number): number[] {
  return db
    .prepare("SELECT topic_id FROM candidate_topics WHERE candidate_id = ? ORDER BY topic_id")
    .all(candidateId)
    .map((row) => num(row.topic_id));
}

export function listPending(db: Database, categoryId: number): PendingCandidate[] {
  return db
    .prepare("SELECT * FROM candidates WHERE category_id = ? AND status = 'pending' ORDER BY id")
    .all(categoryId)
    .map((row) => ({
      id: num(row.id),
      url: str(row.url),
      fetchable: bool(row.fetchable),
      title: str(row.title),
      snippet: str(row.snippet),
      siteName: str(row.site_name),
      publishedAt: strOrNull(row.published_at),
      importance: numOrNull(row.importance) ?? 1,
      topicIds: topicIdsOf(db, num(row.id)),
    }));
}

/** Closes pending candidates as rejected, and files them under the run that decided it. */
export function rejectCandidates(db: Database, ids: number[], reason: string, runId: number): void {
  const statement = db.prepare("UPDATE candidates SET status = 'rejected', reason = ?, run_id = ? WHERE id = ?");
  for (const id of ids) statement.run(reason, runId, id);
}

export function acceptCandidates(db: Database, ids: number[], articleId: number, groupKey: string, runId: number): void {
  const statement = db.prepare(
    "UPDATE candidates SET status = 'accepted', article_id = ?, group_key = ?, run_id = ? WHERE id = ?",
  );
  for (const id of ids) statement.run(articleId, groupKey, runId, id);
}

export function setCandidateBody(db: Database, id: number, body: string): void {
  db.prepare("UPDATE candidates SET body = ? WHERE id = ?").run(body, id);
}

function toCandidate(db: Database, row: Row): Candidate {
  const id = num(row.id);
  return {
    id,
    runId: numOrNull(row.run_id),
    url: str(row.url),
    title: str(row.title),
    siteName: str(row.site_name),
    publishedAt: strOrNull(row.published_at),
    sourceKind: str(row.source_kind) as SourceKind,
    status: str(row.status) as Candidate["status"],
    reason: str(row.reason),
    importance: numOrNull(row.importance),
    topics: db
      .prepare("SELECT t.id, t.text FROM candidate_topics ct JOIN topics t ON t.id = ct.topic_id WHERE ct.candidate_id = ? ORDER BY t.id")
      .all(id)
      .map((topic) => ({ id: num(topic.id), text: str(topic.text) })),
  };
}

export function listRunCandidates(db: Database, runId: number, status?: Candidate["status"]): Candidate[] {
  const rows =
    status === undefined
      ? db.prepare("SELECT * FROM candidates WHERE run_id = ? ORDER BY id").all(runId)
      : db.prepare("SELECT * FROM candidates WHERE run_id = ? AND status = ? ORDER BY id").all(runId, status);
  return rows.map((row) => toCandidate(db, row));
}

/** Removes candidates created before the given time, and with them the page text they hold. */
export function deleteCandidatesBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM candidates WHERE created_at < ?").run(before).changes);
}
