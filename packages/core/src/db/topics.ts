import type { Topic, TopicCreate, TopicUpdate } from "../api.ts";
import type { Clock } from "../clock.ts";
import { notFound } from "../errors.ts";
import { getCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { bool, json, num, str, strOrNull, type Row } from "./rows.ts";

export interface Interpretation {
  queries: string[];
  criteria: string;
  suggestedSources: { newsSearch: boolean; llmSearch: boolean };
}

function toTopic(row: Row): Topic {
  const language = strOrNull(row.search_language);
  const region = strOrNull(row.search_region);
  return {
    id: num(row.id),
    categoryId: num(row.category_id),
    text: str(row.text),
    enabled: bool(row.enabled),
    interpreted: bool(row.interpreted),
    queries: json<string[]>(row.queries),
    criteria: str(row.criteria),
    sources: {
      feeds: json<string[]>(row.feeds),
      newsSearch: bool(row.news_search),
      llmSearch: bool(row.llm_search),
    },
    sourcesSetByUser: bool(row.sources_set_by_user),
    search: language !== null && region !== null ? { language, region } : null,
    createdAt: str(row.created_at),
    missesSinceInterpretation: num(row.misses_since_interpretation),
  };
}

/** A topic's columns, with how many of its misses were marked after its last interpretation, or all of them. */
const TOPIC_COLUMNS = `t.*,
  (SELECT count(*) FROM miss_topics mt JOIN misses m ON m.id = mt.miss_id
    WHERE mt.topic_id = t.id AND (t.interpreted_at IS NULL OR m.marked_at > t.interpreted_at)) AS misses_since_interpretation`;

export function listTopics(db: Database, categoryId: number): Topic[] {
  return db.prepare(`SELECT ${TOPIC_COLUMNS} FROM topics t WHERE t.category_id = ? ORDER BY t.id`).all(categoryId).map(toTopic);
}

export function getTopic(db: Database, id: number): Topic {
  const row = db.prepare(`SELECT ${TOPIC_COLUMNS} FROM topics t WHERE t.id = ?`).get(id);
  if (!row) throw notFound("topic", id);
  return toTopic(row);
}

function save(db: Database, topic: Topic): void {
  db.prepare(
    `UPDATE topics
        SET text = ?, enabled = ?, interpreted = ?, queries = ?, criteria = ?, feeds = ?, news_search = ?,
            llm_search = ?, sources_set_by_user = ?, search_language = ?, search_region = ?
      WHERE id = ?`,
  ).run(
    topic.text,
    topic.enabled ? 1 : 0,
    topic.interpreted ? 1 : 0,
    JSON.stringify(topic.queries),
    topic.criteria,
    JSON.stringify(topic.sources.feeds),
    topic.sources.newsSearch ? 1 : 0,
    topic.sources.llmSearch ? 1 : 0,
    topic.sourcesSetByUser ? 1 : 0,
    topic.search?.language ?? null,
    topic.search?.region ?? null,
    topic.id,
  );
}

export function createTopic(db: Database, categoryId: number, input: TopicCreate, clock: Clock): Topic {
  getCategory(db, categoryId);
  const result = db
    .prepare("INSERT INTO topics (category_id, text, created_at) VALUES (?, ?, ?)")
    .run(categoryId, input.text, clock().toISOString());
  const topic = getTopic(db, num(result.lastInsertRowid));
  topic.enabled = input.enabled ?? true;
  topic.search = input.search ?? null;
  if (input.sources !== undefined) {
    topic.sources = { ...topic.sources, ...input.sources };
    topic.sourcesSetByUser = true;
  }
  if (input.interpretation !== undefined) {
    topic.interpreted = true;
    topic.queries = input.interpretation.queries;
    topic.criteria = input.interpretation.criteria;
  }
  save(db, topic);
  return topic;
}

export function updateTopic(db: Database, id: number, patch: TopicUpdate): Topic {
  const topic = getTopic(db, id);
  if (patch.text !== undefined && patch.text !== topic.text) {
    topic.text = patch.text;
    topic.interpreted = false;
  }
  if (patch.enabled !== undefined) topic.enabled = patch.enabled;
  if (patch.search !== undefined) topic.search = patch.search;
  if (patch.queries !== undefined) topic.queries = patch.queries;
  if (patch.sources !== undefined) {
    topic.sources = { ...topic.sources, ...patch.sources };
    topic.sourcesSetByUser = true;
  }
  save(db, topic);
  return topic;
}

export function deleteTopic(db: Database, id: number): void {
  getTopic(db, id);
  db.prepare("DELETE FROM topics WHERE id = ?").run(id);
}

/** Marks the topic for interpretation before the next run. */
export function requestInterpretation(db: Database, id: number): Topic {
  const topic = getTopic(db, id);
  topic.interpreted = false;
  save(db, topic);
  return topic;
}

/**
 * Stores what the interpret task produced. Source choices made by the user are never overwritten. `interpretedAt`
 * is when the task ran, which the count of misses since the interpretation starts from; an interpretation brought
 * from elsewhere, such as a settings file, leaves the time as it was.
 */
export function applyInterpretation(db: Database, id: number, interpretation: Interpretation, interpretedAt?: string): Topic {
  const topic = getTopic(db, id);
  topic.interpreted = true;
  topic.queries = interpretation.queries;
  topic.criteria = interpretation.criteria;
  if (!topic.sourcesSetByUser) {
    topic.sources = { ...topic.sources, ...interpretation.suggestedSources };
  }
  save(db, topic);
  if (interpretedAt !== undefined) db.prepare("UPDATE topics SET interpreted_at = ? WHERE id = ?").run(interpretedAt, id);
  return getTopic(db, id);
}
