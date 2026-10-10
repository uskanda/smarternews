import type { Clock } from "../clock.ts";
import { deleteUnstarredArticlesBefore } from "../db/articles.ts";
import { deleteCandidatesBefore } from "../db/candidates.ts";
import type { Database } from "../db/database.ts";
import { deleteRunsBefore } from "../db/runs.ts";
import { num } from "../db/rows.ts";

const DAY = 86_400_000;
export const ARTICLE_RETENTION_DAYS = 180;
export const HISTORY_RETENTION_DAYS = 30;

/**
 * Deletes what has outlived its retention period: articles without a star, and candidates (with the page
 * text they hold), run history and model call records. The list of settled URLs is kept on purpose.
 */
export function purgeExpired(db: Database, clock: Clock): { articles: number; candidates: number; runs: number } {
  const now = clock().getTime();
  const historyCutoff = new Date(now - HISTORY_RETENTION_DAYS * DAY).toISOString();
  const articles = deleteUnstarredArticlesBefore(db, new Date(now - ARTICLE_RETENTION_DAYS * DAY).toISOString());
  const candidates = deleteCandidatesBefore(db, historyCutoff);
  const runs = deleteRunsBefore(db, historyCutoff);
  num(db.prepare("DELETE FROM llm_calls WHERE created_at < ?").run(historyCutoff).changes);
  return { articles, candidates, runs };
}
