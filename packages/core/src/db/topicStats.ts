import { TOPIC_STATS_DAYS, TOPIC_STATS_TOP_SITES, type SourceKind, type TopicStats, type TopicStatsEntry } from "../api.ts";
import { getCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { num, str } from "./rows.ts";

// The stats of the topics of a category: what their candidates and generated articles of the last 30 days became.
// Counted from the rows as they are now; no model is involved. Candidates go after 30 days, so nothing older is kept.

const DAY = 86_400_000;

/** The topics of the category with what they brought within the last `TOPIC_STATS_DAYS` days before `now`. */
export function topicStats(db: Database, categoryId: number, now: Date): TopicStats {
  getCategory(db, categoryId);
  const since = new Date(now.getTime() - TOPIC_STATS_DAYS * DAY).toISOString();

  const entries = new Map<number, TopicStatsEntry>();
  for (const row of db.prepare("SELECT id, text FROM topics WHERE category_id = ? ORDER BY id").all(categoryId)) {
    entries.set(num(row.id), {
      topicId: num(row.id),
      text: str(row.text),
      collected: { total: 0, bySource: { feed: 0, "news-search": 0, "llm-search": 0 } },
      rejectedByJudge: 0,
      belowMinimum: 0,
      overLimit: 0,
      rejectedByDate: 0,
      created: 0,
      updated: 0,
      opened: 0,
      starred: 0,
      missed: 0,
      topRejectedSites: [],
    });
  }

  const candidates = db
    .prepare(
      `SELECT ct.topic_id, c.source_kind, count(*) AS total,
              coalesce(sum(c.status = 'rejected' AND c.reason_code IS NULL), 0) AS by_judge,
              coalesce(sum(c.reason_code = 'below-minimum'), 0) AS below_minimum,
              coalesce(sum(c.reason_code = 'over-limit'), 0) AS over_limit,
              coalesce(sum(c.reason_code IN ('no-date', 'event-outside-window', 'event-no-date')), 0) AS by_date
         FROM candidates c JOIN candidate_topics ct ON ct.candidate_id = c.id
        WHERE c.category_id = ? AND c.created_at >= ?
        GROUP BY ct.topic_id, c.source_kind`,
    )
    .all(categoryId, since);
  for (const row of candidates) {
    const entry = entries.get(num(row.topic_id));
    if (!entry) continue;
    entry.collected.total += num(row.total);
    entry.collected.bySource[str(row.source_kind) as SourceKind] += num(row.total);
    entry.rejectedByJudge += num(row.by_judge);
    entry.belowMinimum += num(row.below_minimum);
    entry.overLimit += num(row.over_limit);
    entry.rejectedByDate += num(row.by_date);
  }

  const articles = db
    .prepare(
      `SELECT at.topic_id,
              coalesce(sum(a.created_at >= ?1), 0) AS created,
              coalesce(sum(a.revision > 0 AND a.updated_at >= ?1), 0) AS updated,
              coalesce(sum(a.created_at >= ?1 AND a.opened_at IS NOT NULL), 0) AS opened,
              coalesce(sum(a.created_at >= ?1 AND a.starred = 1), 0) AS starred,
              coalesce(sum(a.created_at >= ?1 AND EXISTS (
                SELECT 1 FROM misses m JOIN miss_topics mt ON mt.miss_id = m.id
                 WHERE m.article_id = a.id AND mt.topic_id = at.topic_id)), 0) AS missed
         FROM articles a JOIN article_topics at ON at.article_id = a.id
        WHERE a.origin = 'generated' AND a.category_id = ?2 AND (a.created_at >= ?1 OR a.updated_at >= ?1)
        GROUP BY at.topic_id`,
    )
    .all(since, categoryId);
  for (const row of articles) {
    const entry = entries.get(num(row.topic_id));
    if (!entry) continue;
    entry.created = num(row.created);
    entry.updated = num(row.updated);
    entry.opened = num(row.opened);
    entry.starred = num(row.starred);
    entry.missed = num(row.missed);
  }

  const sites = db.prepare(
    `SELECT c.site_name, count(*) AS count
       FROM candidates c JOIN candidate_topics ct ON ct.candidate_id = c.id
      WHERE ct.topic_id = ? AND c.category_id = ? AND c.created_at >= ? AND c.status = 'rejected' AND c.site_name <> ''
      GROUP BY c.site_name ORDER BY count DESC, c.site_name LIMIT ?`,
  );
  for (const entry of entries.values()) {
    if (entry.collected.total === 0) continue;
    entry.topRejectedSites = sites
      .all(entry.topicId, categoryId, since, TOPIC_STATS_TOP_SITES)
      .map((row) => ({ siteName: str(row.site_name), count: num(row.count) }));
  }

  return { since, topics: [...entries.values()] };
}
