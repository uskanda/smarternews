import {
  TOPIC_STATS_DAYS,
  TOPIC_STATS_TOP_SITES,
  type SourceKind,
  type TopicStats,
  type TopicStatsCounts,
  type TopicStatsEntry,
  type TopicVersionTrigger,
} from "../api.ts";
import { getCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { num, str } from "./rows.ts";
import { topicVersionMarks } from "./versions.ts";

// The stats of the topics of a category: what their candidates and generated articles of the last 30 days became.
// Counted from the rows as they are now; no model is involved. Candidates go after 30 days, so nothing older is kept.
// When a topic changed within the period, the counts are also split at its last version.

const DAY = 86_400_000;
/** The end of a period that has none: later than any stored time. */
const OPEN_END = "9999-12-31T23:59:59.999Z";

function zero(): TopicStatsCounts {
  return {
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
  };
}

/**
 * What the given topics of the category brought from `from` up to `to`: candidates by when they were collected,
 * articles by when they were made, rewrites by when they were last made.
 */
function countTopics(db: Database, categoryId: number, topicIds: number[], from: string, to: string = OPEN_END): Map<number, TopicStatsCounts> {
  const counts = new Map(topicIds.map((id) => [id, zero()]));
  const ids = JSON.stringify(topicIds);

  const candidates = db
    .prepare(
      `SELECT ct.topic_id, c.source_kind, count(*) AS total,
              coalesce(sum(c.status = 'rejected' AND c.reason_code IS NULL), 0) AS by_judge,
              coalesce(sum(c.reason_code = 'below-minimum'), 0) AS below_minimum,
              coalesce(sum(c.reason_code = 'over-limit'), 0) AS over_limit,
              coalesce(sum(c.reason_code IN ('no-date', 'event-outside-window', 'event-no-date')), 0) AS by_date
         FROM candidates c JOIN candidate_topics ct ON ct.candidate_id = c.id
        WHERE c.category_id = ? AND c.created_at >= ? AND c.created_at < ?
          AND ct.topic_id IN (SELECT value FROM json_each(?))
        GROUP BY ct.topic_id, c.source_kind`,
    )
    .all(categoryId, from, to, ids);
  for (const row of candidates) {
    const entry = counts.get(num(row.topic_id));
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
              coalesce(sum(a.created_at >= ?1 AND a.created_at < ?2), 0) AS created,
              coalesce(sum(a.revision > 0 AND a.updated_at >= ?1 AND a.updated_at < ?2), 0) AS updated,
              coalesce(sum(a.created_at >= ?1 AND a.created_at < ?2 AND a.opened_at IS NOT NULL), 0) AS opened,
              coalesce(sum(a.created_at >= ?1 AND a.created_at < ?2 AND a.starred = 1), 0) AS starred,
              coalesce(sum(a.created_at >= ?1 AND a.created_at < ?2 AND EXISTS (
                SELECT 1 FROM misses m JOIN miss_topics mt ON mt.miss_id = m.id
                 WHERE m.article_id = a.id AND mt.topic_id = at.topic_id)), 0) AS missed
         FROM articles a JOIN article_topics at ON at.article_id = a.id
        WHERE a.origin = 'generated' AND a.category_id = ?3
          AND ((a.created_at >= ?1 AND a.created_at < ?2) OR (a.updated_at >= ?1 AND a.updated_at < ?2))
          AND at.topic_id IN (SELECT value FROM json_each(?4))
        GROUP BY at.topic_id`,
    )
    .all(from, to, categoryId, ids);
  for (const row of articles) {
    const entry = counts.get(num(row.topic_id));
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
      WHERE ct.topic_id = ? AND c.category_id = ? AND c.created_at >= ? AND c.created_at < ? AND c.status = 'rejected'
        AND c.site_name <> ''
      GROUP BY c.site_name ORDER BY count DESC, c.site_name LIMIT ?`,
  );
  for (const [topicId, entry] of counts) {
    if (entry.collected.total === 0) continue;
    entry.topRejectedSites = sites
      .all(topicId, categoryId, from, to, TOPIC_STATS_TOP_SITES)
      .map((row) => ({ siteName: str(row.site_name), count: num(row.count) }));
  }

  return counts;
}

/**
 * The last version of a topic that changed it within the period, or null. The versions up to its first interpretation
 * are where the topic started, not changes: nothing was collected for it before them.
 */
function lastChange(
  versions: Array<{ at: string; trigger: TopicVersionTrigger; interpreted: boolean }>,
  since: string,
): { at: string; trigger: TopicVersionTrigger } | null {
  const start = versions.findIndex((version) => version.interpreted);
  if (start < 0) return null;
  const last = versions.slice(start + 1).at(-1);
  return last && last.at >= since ? { at: last.at, trigger: last.trigger } : null;
}

/** The topics of the category with what they brought within the last `TOPIC_STATS_DAYS` days before `now`. */
export function topicStats(db: Database, categoryId: number, now: Date): TopicStats {
  getCategory(db, categoryId);
  const since = new Date(now.getTime() - TOPIC_STATS_DAYS * DAY).toISOString();
  const topics = db.prepare("SELECT id, text FROM topics WHERE category_id = ? ORDER BY id").all(categoryId);
  const whole = countTopics(
    db,
    categoryId,
    topics.map((row) => num(row.id)),
    since,
  );
  const marks = topicVersionMarks(db, categoryId);

  const entries = topics.map((row): TopicStatsEntry => {
    const topicId = num(row.id);
    const entry: TopicStatsEntry = { topicId, text: str(row.text), ...whole.get(topicId)! };
    const boundary = lastChange(marks.get(topicId) ?? [], since);
    if (boundary) {
      entry.boundary = boundary;
      entry.before = countTopics(db, categoryId, [topicId], since, boundary.at).get(topicId)!;
      entry.after = countTopics(db, categoryId, [topicId], boundary.at).get(topicId)!;
    }
    return entry;
  });

  return { since, topics: entries };
}
