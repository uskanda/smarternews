import type { CategoryVersion, CategoryVersionTrigger, TopicVersion, TopicVersionTrigger } from "../api.ts";
import { notFound } from "../errors.ts";
import type { Database } from "./database.ts";
import { bool, json, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";

// Versions of topics and categories: their kept values each time one of them changed. A version is added only when
// a kept value differs from the last version; the only thing ever changed in a version is whether it was interpreted.
// Nothing here asks a model.

/** The columns of a topic that a version keeps, compared to tell whether a new version is due. */
const TOPIC_KEPT = ["text", "queries", "criteria", "feeds", "news_search", "llm_search", "search_language", "search_region"] as const;

function toTopicVersion(row: Row): TopicVersion {
  const language = strOrNull(row.search_language);
  const region = strOrNull(row.search_region);
  return {
    id: num(row.id),
    topicId: num(row.topic_id),
    createdAt: str(row.created_at),
    trigger: str(row.trigger) as TopicVersionTrigger,
    restoredFrom: numOrNull(row.restored_from),
    text: str(row.text),
    interpreted: bool(row.interpreted),
    queries: json<string[]>(row.queries),
    criteria: str(row.criteria),
    sources: { feeds: json<string[]>(row.feeds), newsSearch: bool(row.news_search), llmSearch: bool(row.llm_search) },
    search: language !== null && region !== null ? { language, region } : null,
  };
}

function lastTopicVersionRow(db: Database, topicId: number): Row | undefined {
  return db.prepare("SELECT * FROM topic_versions WHERE topic_id = ? ORDER BY id DESC LIMIT 1").get(topicId);
}

/**
 * Adds a version of the topic's current values when a kept value differs from its last version. When none does but
 * the topic is interpreted and the last version is not, the last version is marked interpreted instead: going back
 * to it then needs no interpretation. Answers the version added, or null.
 */
export function recordTopicVersion(
  db: Database,
  topicId: number,
  trigger: TopicVersionTrigger,
  at: string,
  restoredFrom: number | null = null,
): number | null {
  const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(topicId);
  if (!topic) throw notFound("topic", topicId);
  const last = lastTopicVersionRow(db, topicId);
  if (last && TOPIC_KEPT.every((column) => last[column] === topic[column])) {
    if (num(topic.interpreted) === 1 && num(last.interpreted) === 0) {
      db.prepare("UPDATE topic_versions SET interpreted = 1 WHERE id = ?").run(num(last.id));
    }
    return null;
  }
  const result = db
    .prepare(
      `INSERT INTO topic_versions
         (topic_id, created_at, trigger, restored_from, text, interpreted, queries, criteria, feeds, news_search, llm_search,
          search_language, search_region)
       SELECT id, ?, ?, ?, text, interpreted, queries, criteria, feeds, news_search, llm_search, search_language, search_region
         FROM topics WHERE id = ?`,
    )
    .run(at, trigger, restoredFrom, topicId);
  return num(result.lastInsertRowid);
}

/** The versions of the topic, newest first. */
export function listTopicVersions(db: Database, topicId: number): TopicVersion[] {
  if (!db.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId)) throw notFound("topic", topicId);
  return db.prepare("SELECT * FROM topic_versions WHERE topic_id = ? ORDER BY id DESC").all(topicId).map(toTopicVersion);
}

/** One version of the topic. A version of another topic is as missing as one that does not exist. */
export function getTopicVersion(db: Database, topicId: number, versionId: number): TopicVersion {
  const row = db.prepare("SELECT * FROM topic_versions WHERE id = ? AND topic_id = ?").get(versionId, topicId);
  if (!row) throw notFound("topic version", versionId);
  return toTopicVersion(row);
}

function toCategoryVersion(row: Row): CategoryVersion {
  return {
    id: num(row.id),
    categoryId: num(row.category_id),
    createdAt: str(row.created_at),
    trigger: str(row.trigger) as CategoryVersionTrigger,
    minImportance: num(row.min_importance),
    maxArticlesPerRun: num(row.max_articles_per_run),
  };
}

/** Adds a version of the category's minimum importance and limit of articles when either differs from its last version. */
export function recordCategoryVersion(db: Database, categoryId: number, trigger: CategoryVersionTrigger, at: string): void {
  const category = db.prepare("SELECT min_importance, max_articles_per_run FROM categories WHERE id = ?").get(categoryId);
  if (!category) throw notFound("category", categoryId);
  const last = db
    .prepare("SELECT min_importance, max_articles_per_run FROM category_versions WHERE category_id = ? ORDER BY id DESC LIMIT 1")
    .get(categoryId);
  if (last && last.min_importance === category.min_importance && last.max_articles_per_run === category.max_articles_per_run) return;
  db.prepare(
    `INSERT INTO category_versions (category_id, created_at, trigger, min_importance, max_articles_per_run)
     SELECT id, ?, ?, min_importance, max_articles_per_run FROM categories WHERE id = ?`,
  ).run(at, trigger, categoryId);
}

/** The versions of the category, newest first. */
export function listCategoryVersions(db: Database, categoryId: number): CategoryVersion[] {
  if (!db.prepare("SELECT 1 FROM categories WHERE id = ?").get(categoryId)) throw notFound("category", categoryId);
  return db.prepare("SELECT * FROM category_versions WHERE category_id = ? ORDER BY id DESC").all(categoryId).map(toCategoryVersion);
}

/** The times and triggers of the versions of each topic of the category, oldest first, with whether each was interpreted. */
export function topicVersionMarks(db: Database, categoryId: number): Map<number, Array<{ at: string; trigger: TopicVersionTrigger; interpreted: boolean }>> {
  const marks = new Map<number, Array<{ at: string; trigger: TopicVersionTrigger; interpreted: boolean }>>();
  const rows = db
    .prepare(
      `SELECT v.topic_id, v.created_at, v.trigger, v.interpreted
         FROM topic_versions v JOIN topics t ON t.id = v.topic_id
        WHERE t.category_id = ? ORDER BY v.topic_id, v.id`,
    )
    .all(categoryId);
  for (const row of rows) {
    const id = num(row.topic_id);
    const list = marks.get(id) ?? [];
    list.push({ at: str(row.created_at), trigger: str(row.trigger) as TopicVersionTrigger, interpreted: bool(row.interpreted) });
    marks.set(id, list);
  }
  return marks;
}
