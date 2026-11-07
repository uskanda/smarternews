// What a proposal of a topic rewrite reads about a topic: the articles the reader opened and starred, the misses,
// and the candidates the judge found not relevant. Only reads; no model is involved.
import { programReasonCode } from "../pipeline/reasons.ts";
import type { Database } from "./database.ts";
import { recentMissTitles } from "./misses.ts";
import { str } from "./rows.ts";

const DAY = 86_400_000;
/** How far back the opened and starred articles and the rejected candidates go. */
export const REWRITE_WINDOW_DAYS = 30;
export const REWRITE_OPENED_LIMIT = 20;
export const REWRITE_STARRED_LIMIT = 20;
export const REWRITE_REJECTED_LIMIT = 30;

export interface RewriteInputs {
  opened: Array<{ title: string; summary: string }>;
  starred: Array<{ title: string; summary: string }>;
  misses: string[];
  rejected: Array<{ title: string; reason: string }>;
}

/**
 * The material of a proposal for the topic, newest first in each list. Opened articles go by when they were first
 * opened; starred articles by when they were made, since the time of a star is not kept. Candidates rejected for
 * a reason of the program are left out: a new wording does not change them. The misses are those an
 * interpretation reads.
 */
export function rewriteInputs(db: Database, topicId: number, now: string): RewriteInputs {
  const since = new Date(Date.parse(now) - REWRITE_WINDOW_DAYS * DAY).toISOString();
  const articles = (condition: string, order: string, limit: number) =>
    db
      .prepare(
        `SELECT a.title, a.summary FROM articles a JOIN article_topics at ON at.article_id = a.id
          WHERE at.topic_id = ? AND a.origin = 'generated' AND ${condition} >= ?
          ORDER BY ${order} DESC, a.id DESC LIMIT ?`,
      )
      .all(topicId, since, limit)
      .map((row) => ({ title: str(row.title), summary: str(row.summary) }));

  const rejected: RewriteInputs["rejected"] = [];
  const rows = db
    .prepare(
      `SELECT c.title, c.reason FROM candidates c JOIN candidate_topics ct ON ct.candidate_id = c.id
        WHERE ct.topic_id = ? AND c.status = 'rejected' AND c.created_at >= ?
        ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all(topicId, since);
  for (const row of rows) {
    if (rejected.length >= REWRITE_REJECTED_LIMIT) break;
    const reason = str(row.reason);
    if (programReasonCode(reason) !== null) continue;
    rejected.push({ title: str(row.title), reason });
  }

  return {
    opened: articles("a.opened_at", "a.opened_at", REWRITE_OPENED_LIMIT),
    starred: articles("a.starred = 1 AND a.created_at", "a.created_at", REWRITE_STARRED_LIMIT),
    misses: recentMissTitles(db, topicId, now),
    rejected,
  };
}
