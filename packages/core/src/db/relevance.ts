import { FEED_STATS_DAYS } from "../api.ts";
import { hiddenByFilters, hiddenDuplicate } from "./articles.ts";
import { transaction, type Database } from "./database.ts";
import { num } from "./rows.ts";

// The behaviour score of each subscribed feed, half of the relevance of its articles in the relevance order: how
// often the reader opened or starred what the feed delivered lately, compared with the other feeds. Counted from
// what the articles are now; no model is involved.

const DAY = 86_400_000;

/** A feed with fewer recent articles than this takes the average of the others: a few say too little. */
export const BEHAVIOUR_MIN_ARTICLES = 10;

export interface FeedRelevanceScores {
  /** The score of every feed, from 0 to 1. */
  scores: Map<number, number>;
  /** What a feed with too few recent articles takes, a new one too. */
  fallback: number;
}

/**
 * Works out the scores without writing them. Of the feed articles stored within the last `FEED_STATS_DAYS` days,
 * left out what filters hide and the hidden duplicates, which the reader cannot open: the share opened or
 * starred, divided by the highest share among the feeds with enough articles. A feed with too few takes the
 * average of those; without any, or without a single article opened or starred, every score is 0.
 */
export function feedRelevanceScores(db: Database, now: Date): FeedRelevanceScores {
  const since = new Date(now.getTime() - FEED_STATS_DAYS * DAY).toISOString();
  const counts = new Map(
    db
      .prepare(
        `SELECT a.feed_id, count(*) AS counted, coalesce(sum(a.opened_at IS NOT NULL OR a.starred = 1), 0) AS engaged
           FROM articles a
          WHERE a.origin = 'feed' AND a.feed_id IS NOT NULL AND a.created_at >= ?
            AND NOT ${hiddenByFilters("a")} AND NOT ${hiddenDuplicate("a")}
          GROUP BY a.feed_id`,
      )
      .all(since)
      .map((row) => [num(row.feed_id), { counted: num(row.counted), engaged: num(row.engaged) }] as const),
  );
  const feedIds = db
    .prepare("SELECT id FROM feeds ORDER BY id")
    .all()
    .map((row) => num(row.id));
  const shares = new Map<number, number>();
  for (const id of feedIds) {
    const count = counts.get(id);
    if (count && count.counted >= BEHAVIOUR_MIN_ARTICLES) shares.set(id, count.engaged / count.counted);
  }
  const highest = Math.max(0, ...shares.values());
  const scored = [...shares.values()].map((share) => (highest > 0 ? share / highest : 0));
  const fallback = scored.length > 0 ? scored.reduce((sum, score) => sum + score, 0) / scored.length : 0;
  const scores = new Map<number, number>();
  for (const id of feedIds) {
    const share = shares.get(id);
    scores.set(id, share === undefined ? fallback : highest > 0 ? share / highest : 0);
  }
  return { scores, fallback };
}

/**
 * Works out the scores and stores each on its feed and on every article of it, whatever its age, so that the
 * relevance order changes only here and when terms match differently. Only what changed is written.
 */
export function refreshFeedScores(db: Database, now: Date): void {
  const { scores } = feedRelevanceScores(db, now);
  const onFeed = db.prepare("UPDATE feeds SET relevance_score = ? WHERE id = ? AND relevance_score <> ?");
  const onArticles = db.prepare("UPDATE articles SET feed_score = ? WHERE origin = 'feed' AND feed_id = ? AND feed_score <> ?");
  transaction(db, () => {
    for (const [id, score] of scores) {
      onFeed.run(score, id, score);
      onArticles.run(score, id, score);
    }
  });
}
