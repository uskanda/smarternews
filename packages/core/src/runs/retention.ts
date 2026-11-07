import type { Clock } from "../clock.ts";
import { deleteUnstarredArticlesBefore, deleteUnstarredFeedArticlesBefore } from "../db/articles.ts";
import { deleteCandidatesBefore } from "../db/candidates.ts";
import type { Database } from "../db/database.ts";
import { deleteDigestsBefore, DIGEST_RETENTION_DAYS } from "../db/digests.ts";
import { deleteSeenItemsBefore, FEED_RETENTION_DAYS } from "../db/feeds.ts";
import { deleteRunsBefore } from "../db/runs.ts";
import { num } from "../db/rows.ts";
import { deleteSearchAttemptsBefore } from "../db/search-attempts.ts";
import { deleteAttentionDismissalsBefore } from "./attention.ts";

const DAY = 86_400_000;
export const ARTICLE_RETENTION_DAYS = 180;
export const HISTORY_RETENTION_DAYS = 30;

/**
 * Deletes what has outlived its retention period: articles without a star or an annotation (generated ones after 180 days,
 * feed articles after 90), and candidates (with the page text they hold), run history and model call
 * records, the record of searches and of dismissed attention items, and digests after 180 days. The list of settled URLs is kept on purpose.
 */
export function purgeExpired(
  db: Database,
  clock: Clock,
): { articles: number; feedArticles: number; candidates: number; runs: number; digests: number } {
  const now = clock().getTime();
  const historyCutoff = new Date(now - HISTORY_RETENTION_DAYS * DAY).toISOString();
  const articles = deleteUnstarredArticlesBefore(db, new Date(now - ARTICLE_RETENTION_DAYS * DAY).toISOString());
  const feedCutoff = new Date(now - FEED_RETENTION_DAYS * DAY).toISOString();
  const feedArticles = deleteUnstarredFeedArticlesBefore(db, feedCutoff);
  // An item is remembered for as long as its feed lists it, so that its purged article does not come back.
  deleteSeenItemsBefore(db, feedCutoff);
  const candidates = deleteCandidatesBefore(db, historyCutoff);
  const runs = deleteRunsBefore(db, historyCutoff);
  num(db.prepare("DELETE FROM llm_calls WHERE created_at < ?").run(historyCutoff).changes);
  // Most searches go with their runs; these are the ones of runs still kept for some other reason.
  deleteSearchAttemptsBefore(db, historyCutoff);
  deleteAttentionDismissalsBefore(db, historyCutoff);
  // A digest outlives its source articles: the ids of its lines are not references.
  const digests = deleteDigestsBefore(db, new Date(now - DIGEST_RETENTION_DAYS * DAY).toISOString());
  return { articles, feedArticles, candidates, runs, digests };
}
