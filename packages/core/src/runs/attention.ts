// Attention items: what the runs went through that the user should look at, worked out from the tables each
// time they are asked for. No model is called. Only the keys of the items the user dismissed are stored.
import type { AttentionItem, AttentionList, Category, RunFailure, RunStatus, Topic } from "../api.ts";
import type { Clock } from "../clock.ts";
import { listCategories } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import { json, num, str, strOrNull } from "../db/rows.ts";
import { listAllSearchAttempts, type SearchAttempt } from "../db/search-attempts.ts";
import { listTopics } from "../db/topics.ts";

const DAY = 86_400_000;
/** A topic without an article written or updated in this many days is pointed out. */
export const IDLE_TOPIC_DAYS = 14;
/** How many searches in a row, or runs in a row, make a pattern worth pointing out. */
export const STREAK = 3;

const EMPTY: Omit<AttentionItem, "kind" | "key"> = {
  categoryId: null,
  categoryName: null,
  topicId: null,
  topicText: null,
  runId: null,
  runStatus: null,
  source: null,
  engine: null,
  query: null,
  since: null,
};

interface Scope {
  categories: Category[];
  /** The enabled topics of the enabled categories, by id. */
  topics: Map<number, { topic: Topic; category: Category }>;
}

function scope(db: Database): Scope {
  const categories = listCategories(db).filter((category) => category.enabled);
  const topics = new Map<number, { topic: Topic; category: Category }>();
  for (const category of categories) {
    for (const topic of listTopics(db, category.id)) if (topic.enabled) topics.set(topic.id, { topic, category });
  }
  return { categories, topics };
}

/** A category whose latest scheduled run failed with no retry planned, or stopped at a limit, and that no later run mended. */
function failedRuns(db: Database, { categories }: Scope): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const category of categories) {
    const row = db
      .prepare("SELECT id, status, retry_at, finished_at FROM runs WHERE category_id = ? AND trigger = 'schedule' ORDER BY id DESC LIMIT 1")
      .get(category.id);
    if (!row) continue;
    const status = str(row.status) as RunStatus;
    const failed = (status === "failed" && strOrNull(row.retry_at) === null) || status === "stopped_by_limit";
    if (!failed) continue;
    const mended = db
      .prepare("SELECT 1 FROM runs WHERE category_id = ? AND id > ? AND status IN ('succeeded', 'partial')")
      .get(category.id, num(row.id));
    if (mended) continue;
    items.push({
      ...EMPTY,
      kind: "run-failed",
      key: `run:${num(row.id)}`,
      categoryId: category.id,
      categoryName: category.name,
      runId: num(row.id),
      runStatus: status,
      since: strOrNull(row.finished_at),
    });
  }
  return items;
}

/** An enabled topic still uninterpreted, that the category's latest finished run failed to interpret. */
function uninterpreted(db: Database, { categories, topics }: Scope): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const category of categories) {
    const waiting = [...topics.values()].filter((entry) => entry.category.id === category.id && !entry.topic.interpreted);
    if (waiting.length === 0) continue;
    const row = db.prepare("SELECT id, failures, finished_at FROM runs WHERE category_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1").get(category.id);
    if (!row) continue;
    const failed = new Set(json<RunFailure[]>(row.failures).filter((failure) => failure.stage === "interpret").map((failure) => failure.target));
    for (const { topic } of waiting) {
      if (!failed.has(topic.text)) continue;
      items.push({
        ...EMPTY,
        kind: "uninterpreted",
        key: `interpret:${topic.id}:${num(row.id)}`,
        categoryId: category.id,
        categoryName: category.name,
        topicId: topic.id,
        topicText: topic.text,
        runId: num(row.id),
        since: strOrNull(row.finished_at),
      });
    }
  }
  return items;
}

/** The trailing entries of `list` that `holds` is true of, the oldest first. */
function trailing<T>(list: T[], holds: (entry: T) => boolean): T[] {
  let start = list.length;
  while (start > 0 && holds(list[start - 1]!)) start -= 1;
  return list.slice(start);
}

/** A search that found nothing in the last three attempts that did not fail, while the topic still makes it. */
function emptySearches(attempts: SearchAttempt[], { topics }: Scope, engines: readonly string[] | undefined): AttentionItem[] {
  const groups = new Map<string, SearchAttempt[]>();
  for (const attempt of attempts) {
    if (!attempt.ok) continue;
    const id = JSON.stringify([attempt.topicId, attempt.kind, attempt.engine, attempt.query]);
    groups.set(id, [...(groups.get(id) ?? []), attempt]);
  }
  const items: AttentionItem[] = [];
  for (const group of groups.values()) {
    const empty = trailing(group, (attempt) => attempt.returned === 0);
    if (empty.length < STREAK) continue;
    const first = empty[0]!;
    const entry = topics.get(first.topicId);
    if (!entry) continue;
    const { topic, category } = entry;
    const news = first.kind === "news-search";
    const stillMade = news
      ? topic.sources.newsSearch && topic.queries.includes(first.query) && (engines === undefined || engines.includes(first.engine ?? ""))
      : topic.sources.llmSearch && topic.text === first.query;
    if (!stillMade) continue;
    items.push({
      ...EMPTY,
      kind: "empty-search",
      key: news ? `empty:news-search:${topic.id}:${first.engine}:${first.query}:${first.id}` : `empty:llm-search:${topic.id}:${first.id}`,
      categoryId: category.id,
      categoryName: category.name,
      topicId: topic.id,
      topicText: topic.text,
      source: first.kind,
      engine: first.engine,
      query: first.query,
      since: first.createdAt,
    });
  }
  return items;
}

/** An enabled topic, at least 14 days old, without an article written or updated in the last 14 days. */
function idleTopics(db: Database, { topics }: Scope, now: Date): AttentionItem[] {
  const cutoff = new Date(now.getTime() - IDLE_TOPIC_DAYS * DAY).toISOString();
  const last = db.prepare("SELECT MAX(a.updated_at) AS last FROM article_topics t JOIN articles a ON a.id = t.article_id WHERE t.topic_id = ?");
  const items: AttentionItem[] = [];
  for (const { topic, category } of topics.values()) {
    if (topic.createdAt > cutoff) continue;
    const written = strOrNull(last.get(topic.id)?.last);
    if (written !== null && written >= cutoff) continue;
    items.push({
      ...EMPTY,
      kind: "no-adoption",
      key: `idle:${topic.id}:${written ?? topic.createdAt}`,
      categoryId: category.id,
      categoryName: category.name,
      topicId: topic.id,
      topicText: topic.text,
      since: written,
    });
  }
  return items;
}

/** The last three runs that tried to resolve a Google News redirect link resolved none. */
function unresolvedGoogle(attempts: SearchAttempt[], engines: readonly string[] | undefined): AttentionItem[] {
  if (engines !== undefined && !engines.includes("google-news")) return [];
  const runs = new Map<number, { runId: number; attempted: number; unresolved: number; createdAt: string }>();
  for (const attempt of attempts) {
    if (attempt.googleAttempted === 0) continue;
    const run = runs.get(attempt.runId) ?? { runId: attempt.runId, attempted: 0, unresolved: 0, createdAt: attempt.createdAt };
    run.attempted += attempt.googleAttempted;
    run.unresolved += attempt.googleUnresolved;
    runs.set(attempt.runId, run);
  }
  const ordered = [...runs.values()].sort((a, b) => a.runId - b.runId);
  const failing = trailing(ordered, (run) => run.unresolved >= run.attempted);
  if (failing.length < STREAK) return [];
  return [{ ...EMPTY, kind: "google-unresolved", key: `google:${failing[0]!.runId}`, since: failing[0]!.createdAt }];
}

/**
 * The attention items that were not dismissed. `engines` are the news engines the server asks now: searches
 * of an engine it no longer asks are not pointed out. Without it, every engine counts.
 */
export function listAttention(db: Database, now: Date, options: { engines?: readonly string[] } = {}): AttentionList {
  const within = scope(db);
  const attempts = listAllSearchAttempts(db);
  const all = [
    ...failedRuns(db, within),
    ...uninterpreted(db, within),
    ...emptySearches(attempts, within, options.engines),
    ...idleTopics(db, within, now),
    ...unresolvedGoogle(attempts, options.engines),
  ];
  const dismissed = new Set(db.prepare("SELECT key FROM attention_dismissals").all().map((row) => str(row.key)));
  const items = all.filter((item) => !dismissed.has(item.key));
  return { items, count: items.length };
}

/** Hides the item of this key until what set it off changes. Dismissing it again only renews the record. */
export function dismissAttention(db: Database, key: string, clock: Clock): void {
  db.prepare("INSERT INTO attention_dismissals (key, dismissed_at) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET dismissed_at = excluded.dismissed_at").run(
    key,
    clock().toISOString(),
  );
}

export function isAttentionDismissed(db: Database, key: string): boolean {
  return db.prepare("SELECT 1 FROM attention_dismissals WHERE key = ?").get(key) !== undefined;
}

export function deleteAttentionDismissalsBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM attention_dismissals WHERE dismissed_at < ?").run(before).changes);
}
