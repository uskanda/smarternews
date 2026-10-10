import type {
  Article,
  ArticleEvent,
  ArticleList,
  ArticleListQuery,
  ArticleRef,
  ArticleSummary,
  ArticleUpdate,
  Kind,
  Registration,
} from "../api.ts";
import { DomainError, notFound } from "../errors.ts";
import { renderMarkdown } from "../markdown.ts";
import type { Database } from "./database.ts";
import { bool, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";

const SUMMARY_COLUMNS = `a.*, (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS primary_url`;

function toEvent(row: Row): ArticleEvent | null {
  const startsAt = strOrNull(row.event_starts_at);
  const endsAt = strOrNull(row.event_ends_at);
  if (startsAt === null || endsAt === null) return null;
  return {
    startsAt,
    endsAt,
    venue: strOrNull(row.event_venue),
    fee: strOrNull(row.event_fee),
    registration: (strOrNull(row.event_registration) ?? "unknown") as Registration,
  };
}

function toSummary(row: Row): ArticleSummary {
  return {
    id: num(row.id),
    categoryId: num(row.category_id),
    kind: str(row.kind) as Kind,
    title: str(row.title),
    summary: str(row.summary),
    impact: strOrNull(row.impact),
    importance: num(row.importance),
    unconfirmed: bool(row.unconfirmed),
    firstPublishedAt: str(row.first_published_at),
    updatedAt: str(row.updated_at),
    revision: num(row.revision),
    isRead: bool(row.is_read),
    starred: bool(row.starred),
    primaryUrl: strOrNull(row.primary_url),
    event: toEvent(row),
  };
}

function refsOf(db: Database, articleId: number): ArticleRef[] {
  return db
    .prepare("SELECT url, site_name, title, published_at FROM article_refs WHERE article_id = ? ORDER BY position, id")
    .all(articleId)
    .map((row) => ({
      url: str(row.url),
      siteName: str(row.site_name),
      title: str(row.title),
      publishedAt: strOrNull(row.published_at),
    }));
}

function toArticle(db: Database, row: Row): Article {
  const id = num(row.id);
  const body = str(row.body);
  return {
    ...toSummary(row),
    body,
    bodyHtml: renderMarkdown(body),
    snippetOnly: bool(row.snippet_only),
    previousArticleId: numOrNull(row.previous_article_id),
    refs: refsOf(db, id),
    topics: db
      .prepare("SELECT t.id, t.text FROM article_topics at JOIN topics t ON t.id = at.topic_id WHERE at.article_id = ? ORDER BY t.id")
      .all(id)
      .map((topic) => ({ id: num(topic.id), text: str(topic.text) })),
  };
}

export function getArticle(db: Database, id: number): Article {
  const row = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM articles a WHERE a.id = ?`).get(id);
  if (!row) throw notFound("article", id);
  return toArticle(db, row);
}

export function listArticleIds(db: Database, categoryId: number): number[] {
  return db
    .prepare("SELECT id FROM articles WHERE category_id = ? ORDER BY id")
    .all(categoryId)
    .map((row) => num(row.id));
}

// ---- writing -----------------------------------------------------------------------------------

export interface EventFields {
  key: string;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  fee: string | null;
  registration: Registration;
}

export interface ArticleContent {
  title: string;
  summary: string;
  body: string;
  impact: string | null;
  importance: number;
  unconfirmed: boolean;
  snippetOnly: boolean;
  event: EventFields | null;
}

export type NewRef = ArticleRef;

function addRefs(db: Database, articleId: number, refs: NewRef[]): void {
  let position = num(db.prepare("SELECT coalesce(max(position), -1) + 1 AS next FROM article_refs WHERE article_id = ?").get(articleId)!.next);
  const statement = db.prepare(
    "INSERT OR IGNORE INTO article_refs (article_id, url, site_name, title, published_at, position) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const ref of refs) {
    const result = statement.run(articleId, ref.url, ref.siteName, ref.title, ref.publishedAt, position);
    if (num(result.changes) > 0) position += 1;
  }
}

function addTopics(db: Database, articleId: number, topicIds: number[]): void {
  const statement = db.prepare("INSERT OR IGNORE INTO article_topics (article_id, topic_id) VALUES (?, ?)");
  for (const topicId of topicIds) statement.run(articleId, topicId);
}

export function insertArticle(
  db: Database,
  input: ArticleContent & {
    categoryId: number;
    kind: Kind;
    now: string;
    previousArticleId: number | null;
    refs: NewRef[];
    topicIds: number[];
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO articles
         (category_id, kind, title, summary, body, impact, importance, unconfirmed, snippet_only, first_published_at,
          updated_at, previous_article_id, event_key, event_starts_at, event_ends_at, event_venue, event_fee,
          event_registration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.categoryId,
      input.kind,
      input.title,
      input.summary,
      input.body,
      input.impact,
      input.importance,
      input.unconfirmed ? 1 : 0,
      input.snippetOnly ? 1 : 0,
      input.now,
      input.now,
      input.previousArticleId,
      input.event?.key ?? null,
      input.event?.startsAt ?? null,
      input.event?.endsAt ?? null,
      input.event?.venue ?? null,
      input.event?.fee ?? null,
      input.event?.registration ?? null,
    );
  const id = num(result.lastInsertRowid);
  addRefs(db, id, input.refs);
  addTopics(db, id, input.topicIds);
  return id;
}

/** Rewrites an article with a follow-up: new content, more references, unread again, one revision further. */
export function reviseArticle(
  db: Database,
  id: number,
  input: ArticleContent & { now: string; refs: NewRef[]; topicIds: number[] },
): void {
  db.prepare(
    `UPDATE articles
        SET title = ?, summary = ?, body = ?, impact = ?, importance = max(importance, ?), unconfirmed = ?,
            snippet_only = ?, updated_at = ?, revision = revision + 1, is_read = 0,
            event_key = coalesce(?, event_key), event_starts_at = coalesce(?, event_starts_at),
            event_ends_at = coalesce(?, event_ends_at), event_venue = coalesce(?, event_venue),
            event_fee = coalesce(?, event_fee),
            event_registration = CASE WHEN ? IS NULL OR ? = 'unknown' THEN event_registration ELSE ? END
      WHERE id = ?`,
  ).run(
    input.title,
    input.summary,
    input.body,
    input.impact,
    input.importance,
    input.unconfirmed ? 1 : 0,
    input.snippetOnly ? 1 : 0,
    input.now,
    input.event?.key ?? null,
    input.event?.startsAt ?? null,
    input.event?.endsAt ?? null,
    input.event?.venue ?? null,
    input.event?.fee ?? null,
    input.event?.registration ?? null,
    input.event?.registration ?? null,
    input.event?.registration ?? null,
    id,
  );
  addRefs(db, id, input.refs);
  addTopics(db, id, input.topicIds);
}

// ---- reading for the pipeline ------------------------------------------------------------------

export interface ArticleDigest {
  id: number;
  title: string;
  summary: string;
  body: string;
  firstPublishedAt: string;
}

function toDigest(row: Row): ArticleDigest {
  return {
    id: num(row.id),
    title: str(row.title),
    summary: str(row.summary),
    body: str(row.body),
    firstPublishedAt: str(row.first_published_at),
  };
}

/** News articles of the category touched since the given time: what a new page could be a follow-up to. */
export function recentNewsArticles(db: Database, categoryId: number, since: string): ArticleDigest[] {
  return db
    .prepare("SELECT * FROM articles WHERE category_id = ? AND kind = 'news' AND updated_at >= ? ORDER BY id")
    .all(categoryId, since)
    .map(toDigest);
}

/** Event articles of the category whose event has not ended. */
export function openEventArticles(db: Database, categoryId: number, now: string): ArticleDigest[] {
  return db
    .prepare("SELECT * FROM articles WHERE category_id = ? AND kind = 'event' AND event_ends_at >= ? ORDER BY id")
    .all(categoryId, now)
    .map(toDigest);
}

export function findEventByKey(db: Database, categoryId: number, key: string): ArticleDigest | null {
  const row = db.prepare("SELECT * FROM articles WHERE category_id = ? AND event_key = ? ORDER BY id LIMIT 1").get(categoryId, key);
  return row ? toDigest(row) : null;
}

// ---- reading for the API and RSS ---------------------------------------------------------------

type CursorValue = [string, number];

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor: string): CursorValue {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number") return [value[0], value[1]];
  } catch {
    // fall through to the refusal below
  }
  throw new DomainError("invalid", "the cursor is not one this server issued", [{ path: "cursor", message: "invalid cursor" }]);
}

/**
 * A page of articles. Events are ordered by start time, soonest first, and leave out events that have ended;
 * everything else is ordered by last update, newest first.
 */
export function listArticles(db: Database, query: ArticleListQuery, now: string): ArticleList {
  const limit = query.limit ?? 50;
  const byEventStart = query.kind === "event";
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.category !== undefined) {
    where.push("a.category_id = ?");
    params.push(query.category);
  }
  if (query.kind !== undefined) {
    where.push("a.kind = ?");
    params.push(query.kind);
  }
  if (query.unread !== undefined) where.push(`a.is_read = ${query.unread === "true" ? 0 : 1}`);
  if (query.starred !== undefined) where.push(`a.starred = ${query.starred === "true" ? 1 : 0}`);
  if (byEventStart && query.includeEnded !== "true") {
    where.push("a.event_ends_at >= ?");
    params.push(now);
  }
  if (query.cursor !== undefined) {
    const [value, id] = decodeCursor(query.cursor);
    where.push(
      byEventStart
        ? "(a.event_starts_at > ? OR (a.event_starts_at = ? AND a.id > ?))"
        : "(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))",
    );
    params.push(value, value, id);
  }
  const order = byEventStart ? "a.event_starts_at ASC, a.id ASC" : "a.updated_at DESC, a.id DESC";
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM articles a ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${order} LIMIT ?`,
    )
    .all(...params, limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor([str(byEventStart ? last.event_starts_at : last.updated_at), num(last.id)])
      : null;
  return { items: page.map(toSummary), nextCursor };
}

export function setArticleFlags(db: Database, id: number, patch: ArticleUpdate): Article {
  getArticle(db, id);
  if (patch.isRead !== undefined) db.prepare("UPDATE articles SET is_read = ? WHERE id = ?").run(patch.isRead ? 1 : 0, id);
  if (patch.starred !== undefined) db.prepare("UPDATE articles SET starred = ? WHERE id = ?").run(patch.starred ? 1 : 0, id);
  return getArticle(db, id);
}

/** Marks as read the unread articles last updated before the given time. Returns how many changed. */
export function markArticlesRead(db: Database, filter: { categoryId?: number; before: string }): number {
  const before = new Date(filter.before).toISOString();
  const result =
    filter.categoryId === undefined
      ? db.prepare("UPDATE articles SET is_read = 1 WHERE is_read = 0 AND updated_at < ?").run(before)
      : db.prepare("UPDATE articles SET is_read = 1 WHERE is_read = 0 AND updated_at < ? AND category_id = ?").run(before, filter.categoryId);
  return num(result.changes);
}

/** The newest articles for a feed, events that have ended left out. `categoryId` null means every enabled category. */
export function listFeedArticles(db: Database, filter: { categoryId: number | null; now: string; limit: number }): Article[] {
  const scope =
    filter.categoryId === null
      ? "a.category_id IN (SELECT id FROM categories WHERE enabled = 1)"
      : "a.category_id = ?";
  const params: Array<string | number> = filter.categoryId === null ? [] : [filter.categoryId];
  return db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM articles a
        WHERE ${scope} AND (a.kind <> 'event' OR a.event_ends_at >= ?)
        ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`,
    )
    .all(...params, filter.now, filter.limit)
    .map((row) => toArticle(db, row));
}

/** Removes articles without a star that were last updated before the given time. */
export function deleteUnstarredArticlesBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM articles WHERE starred = 0 AND updated_at < ?").run(before).changes);
}
