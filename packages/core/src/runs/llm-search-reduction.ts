// Web search by the model that keeps finding no new candidate is cut to once a day. Whether a topic's search is
// cut is worked out from the record of its attempts each time, by this module alone: the run, the attention items
// and the topic's answer all ask here. Only the point the user put the search back from is stored.
import type { Topic } from "../api.ts";
import type { Clock } from "../clock.ts";
import type { Database } from "../db/database.ts";
import { num } from "../db/rows.ts";
import { listLlmSearchAttempts, type SearchAttempt } from "../db/search-attempts.ts";
import { notFound } from "../errors.ts";

/** How many attempts in a row without a new candidate cut the search to once a day. */
export const LLM_SEARCH_STREAK = 3;

/**
 * The trailing attempts that found no new candidate, the oldest first, when there are at least three of them;
 * otherwise null. `attempts` are the topic's web searches by the model, the oldest first. Only the attempts that did
 * not fail, made with the topic's current text, after the attempt the user last put the search back from, count.
 */
export function emptyStreak(attempts: SearchAttempt[], text: string, afterAttemptId: number): SearchAttempt[] | null {
  const counted = attempts.filter((attempt) => attempt.ok && attempt.query === text && attempt.id > afterAttemptId);
  let start = counted.length;
  while (start > 0 && counted[start - 1]!.returned === 0) start -= 1;
  const streak = counted.slice(start);
  return streak.length >= LLM_SEARCH_STREAK ? streak : null;
}

/** The last attempt on record when the user last put the topic's search back to every run, or 0. */
function resetAfter(db: Database, topicId: number): number {
  const row = db.prepare("SELECT after_attempt_id FROM llm_search_resets WHERE topic_id = ?").get(topicId);
  return row ? num(row.after_attempt_id) : 0;
}

/**
 * The attempts that cut the topic's web search by the model to once a day, the oldest first, or null when it is
 * not cut. A topic without web search by the model is never cut.
 */
export function llmSearchReduction(db: Database, topic: Pick<Topic, "id" | "text" | "sources">): SearchAttempt[] | null {
  if (!topic.sources.llmSearch) return null;
  return emptyStreak(listLlmSearchAttempts(db, topic.id), topic.text, resetAfter(db, topic.id));
}

export function isLlmSearchReduced(db: Database, topic: Pick<Topic, "id" | "text" | "sources">): boolean {
  return llmSearchReduction(db, topic) !== null;
}

/** Whether a web search by the model of the topic that did not fail was made at or after `since`. */
export function llmSearchedSince(db: Database, topicId: number, since: string): boolean {
  return (
    db.prepare("SELECT 1 FROM search_attempts WHERE topic_id = ? AND kind = 'llm-search' AND ok = 1 AND created_at >= ? LIMIT 1").get(topicId, since) !==
    undefined
  );
}

/**
 * Puts the topic's web search by the model back to every run. Only the attempts made after now count towards
 * cutting it again.
 */
export function restoreLlmSearch(db: Database, topicId: number, clock: Clock): void {
  if (!db.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) throw notFound("topic", topicId);
  const last = num(db.prepare("SELECT IFNULL(MAX(id), 0) AS last FROM search_attempts").get()?.last);
  db.prepare(
    `INSERT INTO llm_search_resets (topic_id, after_attempt_id, reset_at) VALUES (?, ?, ?)
       ON CONFLICT (topic_id) DO UPDATE SET after_attempt_id = excluded.after_attempt_id, reset_at = excluded.reset_at`,
  ).run(topicId, last, clock().toISOString());
}
