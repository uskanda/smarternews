import type {
  Article,
  ArticleEvent,
  ArticleList,
  ArticleListQuery,
  ArticleRef,
  ArticleSearchHit,
  ArticleSearchQuery,
  ArticleSearchResult,
  ArticleSummary,
  ArticleUpdate,
  AutoSummarySource,
  Counts,
  FullContent,
  FullContentError,
  FullContentErrorReason,
  FullContentStatus,
  Kind,
  Origin,
  Registration,
} from "../api.ts";
import { DomainError, notFound } from "../errors.ts";
import { renderMarkdown } from "../markdown.ts";
import { searchBody } from "../search/plain.ts";
import { charCount, excerptOf, parseSearchTerms, SHORT_TERM_CHARS } from "../search/text.ts";
import { transaction, type Database } from "./database.ts";
import { bool, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";
import { deleteArticleTranslation, findArticleTranslation } from "./translations.ts";

/**
 * The condition every query must carry that is about generated articles only: follow-ups, event matching,
 * the RSS output and the 180-day purge. Feed articles share the table and must never take part in these.
 */
const GENERATED = "origin = 'generated'";

/**
 * Whether the article of the given table alias is hidden by filters: a feed article that an enabled filter
 * hides, unless it has a star. Every list, count, "mark all as read" and the summaries leave such a row out.
 * A generated article is never hidden.
 */
export function hiddenByFilters(alias: string): string {
  return `(${alias}.filtered = 1 AND ${alias}.starred = 0)`;
}

/**
 * Whether the article of the given table alias is a hidden duplicate: a feed article recorded as a duplicate
 * of one another feed delivered first, while duplicate removal is on. Such a row is left out of the lists
 * and counts over everything and over categories, waits for no summary, and is read with the article kept
 * for it. Switched off, recorded duplicates are like any other article; the record stays.
 */
export function hiddenDuplicate(alias: string): string {
  return `(${alias}.duplicate_of IS NOT NULL AND coalesce((SELECT s.remove_duplicates FROM settings s WHERE s.id = 1), 1) = 1)`;
}

/** A summary is tried this many times; after that the article stays without one. */
export const SUMMARY_ATTEMPTS = 2;

/**
 * A feed article `a` that waits for a summary: its feed summarises, it was stored after the feed began to,
 * and it is unread, visible, without a summary and not given up on.
 */
/** Everything that makes a feed article one that gets a summary, apart from whether it has been read. */
const CAN_BE_SUMMARIZED = `a.origin = 'feed' AND a.auto_summary IS NULL AND a.auto_summary_skipped = 0
  AND a.auto_summary_attempts < ${SUMMARY_ATTEMPTS} AND NOT ${hiddenByFilters("a")}
  AND EXISTS (SELECT 1 FROM feeds f WHERE f.id = a.feed_id AND f.auto_summarize = 1 AND a.created_at > f.auto_summarize_since)`;

// An article that was read is left out, and so is a hidden duplicate, whose summary the kept article has;
// either is in, though, when a reader opened it while its summary was waited for.
const WAITING_FOR_SUMMARY = `${CAN_BE_SUMMARIZED}
  AND ((a.is_read = 0 AND NOT ${hiddenDuplicate("a")}) OR a.auto_summary_requested_at IS NOT NULL)`;

/**
 * A feed article `a` that waits for its full content: its feed fetches full content, it was stored after the
 * feed began to, it has neither full content nor a failure, and it is unread and visible. A hidden duplicate
 * is left out: it is read with the article kept for it, and its page would be fetched for nobody. A failed
 * article is not tried again unless a reader asks.
 */
const WAITING_FOR_FULL_CONTENT = `a.origin = 'feed' AND a.full_content_status IS NULL AND a.is_read = 0
  AND NOT ${hiddenByFilters("a")} AND NOT ${hiddenDuplicate("a")}
  AND EXISTS (SELECT 1 FROM feeds f WHERE f.id = a.feed_id AND f.fetch_full_content = 1 AND a.created_at > f.fetch_full_content_since)`;

const SUMMARY_COLUMNS = `a.*,
  (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS primary_url,
  (SELECT count(*) FROM article_refs r WHERE r.article_id = a.id) AS ref_count`;

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
    categoryId: numOrNull(row.category_id),
    origin: str(row.origin) as Origin,
    feedId: numOrNull(row.feed_id),
    author: strOrNull(row.author),
    kind: str(row.kind) as Kind,
    title: str(row.title),
    translatedTitle: strOrNull(row.translated_title),
    summary: str(row.summary),
    impact: strOrNull(row.impact),
    importance: numOrNull(row.importance),
    unconfirmed: bool(row.unconfirmed),
    firstPublishedAt: str(row.first_published_at),
    updatedAt: str(row.updated_at),
    revision: num(row.revision),
    isRead: bool(row.is_read),
    readAt: strOrNull(row.read_at),
    starred: bool(row.starred),
    primaryUrl: strOrNull(row.primary_url),
    refCount: num(row.ref_count),
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

/** The duplicates recorded against an article, with their feed, in the order they were stored. */
function otherFeedsOf(db: Database, articleId: number): Article["otherFeeds"] {
  return db
    .prepare(
      `SELECT d.id, d.feed_id, f.title FROM articles d JOIN feeds f ON f.id = d.feed_id
        WHERE d.duplicate_of = ? AND NOT ${hiddenByFilters("d")} ORDER BY d.created_at, d.id`,
    )
    .all(articleId)
    .map((row) => ({ articleId: num(row.id), feedId: num(row.feed_id), feedTitle: str(row.title) }));
}

function fullContentOf(row: Row): FullContent | null {
  const body = strOrNull(row.full_content);
  if (body === null || str(row.full_content_status) !== "fetched") return null;
  return { body, bodyHtml: renderMarkdown(body, { images: true }), fetchedAt: str(row.full_content_at) };
}

function fullContentStatusOf(db: Database, row: Row): FullContentStatus {
  const status = strOrNull(row.full_content_status);
  if (status === "fetched" || status === "failed") return status;
  return db.prepare(`SELECT 1 FROM articles a WHERE a.id = ? AND ${WAITING_FOR_FULL_CONTENT}`).get(num(row.id)) !== undefined ? "waiting" : "none";
}

function fullContentErrorOf(row: Row): FullContentError | null {
  if (str(row.full_content_status) !== "failed") return null;
  return { reason: str(row.full_content_error) as FullContentErrorReason, detail: strOrNull(row.full_content_error_detail) };
}

function toArticle(db: Database, row: Row): Article {
  const id = num(row.id);
  const body = str(row.body);
  const autoSummary = strOrNull(row.auto_summary);
  return {
    ...toSummary(row),
    body,
    bodyHtml: renderMarkdown(body, { images: str(row.origin) === "feed" }),
    autoSummary:
      autoSummary === null
        ? null
        : { text: autoSummary, source: str(row.auto_summary_source) as AutoSummarySource, createdAt: str(row.auto_summary_at) },
    autoSummaryPending:
      autoSummary === null && db.prepare(`SELECT 1 FROM articles a WHERE a.id = ? AND ${WAITING_FOR_SUMMARY}`).get(id) !== undefined,
    translatable: db.prepare("SELECT 1 FROM feeds WHERE id = ? AND translate = 1").get(numOrNull(row.feed_id)) !== undefined,
    sourceLanguage: strOrNull(row.source_language),
    translation: findArticleTranslation(db, id, { translatedTitle: strOrNull(row.translated_title), sourceLanguage: strOrNull(row.source_language) }),
    fullContent: fullContentOf(row),
    fullContentStatus: fullContentStatusOf(db, row),
    fullContentError: fullContentErrorOf(row),
    snippetOnly: bool(row.snippet_only),
    previousArticleId: numOrNull(row.previous_article_id),
    otherFeeds: otherFeedsOf(db, id),
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
          updated_at, created_at, previous_article_id, event_key, event_starts_at, event_ends_at, event_venue, event_fee,
          event_registration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            snippet_only = ?, updated_at = ?, revision = revision + 1, is_read = 0, read_at = NULL,
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
    .prepare(`SELECT * FROM articles WHERE ${GENERATED} AND category_id = ? AND kind = 'news' AND updated_at >= ? ORDER BY id`)
    .all(categoryId, since)
    .map(toDigest);
}

/** Event articles of the category whose event has not ended. */
export function openEventArticles(db: Database, categoryId: number, now: string): ArticleDigest[] {
  return db
    .prepare(`SELECT * FROM articles WHERE ${GENERATED} AND category_id = ? AND kind = 'event' AND event_ends_at >= ? ORDER BY id`)
    .all(categoryId, now)
    .map(toDigest);
}

export function findEventByKey(db: Database, categoryId: number, key: string): ArticleDigest | null {
  const row = db.prepare(`SELECT * FROM articles WHERE ${GENERATED} AND category_id = ? AND event_key = ? ORDER BY id LIMIT 1`).get(categoryId, key);
  return row ? toDigest(row) : null;
}

// ---- summaries of feed articles ----------------------------------------------------------------

export interface ArticleToSummarize {
  id: number;
  title: string;
  /** The article's page, or null when the feed gave none. */
  url: string | null;
  /** What the feed delivered, without markup. */
  contentText: string;
}

/** The feed article that is summarised next: of those that wait, the newest by the time the lists sort by. */
export function nextArticleToSummarize(db: Database): ArticleToSummarize | null {
  const row = db
    .prepare(
      `SELECT a.id, a.title, a.content_text,
              (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS url
         FROM articles a WHERE ${WAITING_FOR_SUMMARY}
        ORDER BY a.auto_summary_requested_at IS NULL, a.auto_summary_requested_at DESC, a.updated_at DESC, a.id DESC LIMIT 1`,
    )
    .get();
  return row ? { id: num(row.id), title: str(row.title), url: strOrNull(row.url), contentText: str(row.content_text) } : null;
}

/**
 * Notes that a reader has the article open and wants its summary. The article then goes before the others
 * and keeps waiting after it is read. False when the article is not one that gets a summary.
 */
export function requestAutoSummary(db: Database, id: number, now: string): boolean {
  getArticle(db, id);
  return num(db.prepare(`UPDATE articles AS a SET auto_summary_requested_at = ? WHERE a.id = ? AND ${CAN_BE_SUMMARIZED}`).run(now, id).changes) > 0;
}

export function saveAutoSummary(db: Database, id: number, summary: { text: string; source: AutoSummarySource; now: string }): void {
  db.prepare("UPDATE articles SET auto_summary = ?, auto_summary_source = ?, auto_summary_at = ? WHERE id = ?").run(
    summary.text,
    summary.source,
    summary.now,
    id,
  );
}

/** Counts a failed call. At `SUMMARY_ATTEMPTS` the article no longer waits. */
export function recordSummaryFailure(db: Database, id: number): void {
  db.prepare("UPDATE articles SET auto_summary_attempts = auto_summary_attempts + 1 WHERE id = ?").run(id);
}

/** Marks an article as having too little text to summarise, so that it no longer waits. */
export function skipAutoSummary(db: Database, id: number): void {
  db.prepare("UPDATE articles SET auto_summary_skipped = 1 WHERE id = ?").run(id);
}

// ---- full content of feed articles -------------------------------------------------------------

export interface ArticleForFullContent {
  id: number;
  /** The article's page, or null when the feed gave none. */
  url: string | null;
  /** What the feed delivered, without markup. The full content must not be shorter. */
  contentText: string;
}

const FULL_CONTENT_COLUMNS = `a.id, a.content_text,
  (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS url`;

function toArticleForFullContent(row: Row): ArticleForFullContent {
  return { id: num(row.id), url: strOrNull(row.url), contentText: str(row.content_text) };
}

/** The feed article whose full content is fetched next: of those that wait, the one stored last. */
export function nextArticleForFullContent(db: Database): ArticleForFullContent | null {
  const row = db
    .prepare(`SELECT ${FULL_CONTENT_COLUMNS} FROM articles a WHERE ${WAITING_FOR_FULL_CONTENT} ORDER BY a.created_at DESC, a.id DESC LIMIT 1`)
    .get();
  return row ? toArticleForFullContent(row) : null;
}

/**
 * One feed article as a request for its full content needs it, with where it stands: fetched, failed, or
 * neither. Refuses a generated article, which has no full content, and an article that does not exist.
 */
export function articleForFullContent(
  db: Database,
  id: number,
): ArticleForFullContent & { status: "fetched" | "failed" | null; fullContentText: string | null; feedFetchesFullContent: boolean } {
  const row = db
    .prepare(
      `SELECT ${FULL_CONTENT_COLUMNS}, a.origin, a.full_content_status, a.full_content_text,
              (SELECT f.fetch_full_content FROM feeds f WHERE f.id = a.feed_id) AS feed_fetches
         FROM articles a WHERE a.id = ?`,
    )
    .get(id);
  if (!row) throw notFound("article", id);
  if (str(row.origin) !== "feed") {
    throw new DomainError("invalid", `article ${id} is not a feed article`, [{ path: "id", message: "only a feed article has full content" }]);
  }
  return {
    ...toArticleForFullContent(row),
    status: strOrNull(row.full_content_status) as "fetched" | "failed" | null,
    fullContentText: strOrNull(row.full_content_text),
    feedFetchesFullContent: bool(row.feed_fetches),
  };
}

/**
 * Stores the full content of a feed article, and forgets the translation of its content in the same
 * transaction: that translation is of what the feed delivered, and the full content is translated instead
 * the next time a reader asks. The translated title stays.
 */
export function saveFullContent(db: Database, id: number, content: { markdown: string; text: string; now: string }): void {
  transaction(db, () => {
    db.prepare(
      `UPDATE articles SET full_content = ?, full_content_text = ?, full_content_at = ?, full_content_status = 'fetched',
              full_content_error = NULL, full_content_error_detail = NULL
        WHERE id = ?`,
    ).run(content.markdown, content.text, content.now, id);
    deleteArticleTranslation(db, id);
  });
}

/** Records why the full content could not be had. The article then no longer waits for it. */
export function recordFullContentFailure(db: Database, id: number, failure: { reason: FullContentErrorReason; detail: string | null }): void {
  db.prepare("UPDATE articles SET full_content_status = 'failed', full_content_error = ?, full_content_error_detail = ? WHERE id = ?").run(
    failure.reason,
    failure.detail === null ? null : failure.detail.slice(0, 500),
    id,
  );
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

/** How far back the list of recently read articles goes: seven days of 24 hours, counted from now. */
export const RECENTLY_READ_MS = 7 * 24 * 60 * 60 * 1000;

/** What narrows the article list, none of which the list of recently read articles is combined with. */
const NARROWING = ["category", "uncategorized", "origin", "feed", "kind", "unread", "starred", "minImportance"] as const;

/**
 * A page of the articles read in the last seven days, last read first, ended events included. What filters
 * hide and hidden duplicates are left out, as in the list over everything: a duplicate is read with its kept
 * article, which is listed instead.
 */
function listRecentlyRead(db: Database, query: ArticleListQuery, now: string): ArticleList {
  const given = NARROWING.filter((name) => query[name] !== undefined);
  if (given.length > 0) {
    throw new DomainError(
      "invalid",
      "recentlyRead cannot be combined with another narrowing of the list",
      given.map((name) => ({ path: name, message: "not allowed with recentlyRead" })),
    );
  }
  const limit = query.limit ?? 50;
  const where = [
    "a.is_read = 1",
    "a.read_at IS NOT NULL",
    "a.read_at >= ?",
    `NOT ${hiddenByFilters("a")}`,
    `NOT ${hiddenDuplicate("a")}`,
  ];
  const params: Array<string | number> = [new Date(new Date(now).getTime() - RECENTLY_READ_MS).toISOString()];
  if (query.cursor !== undefined) {
    const [value, id] = decodeCursor(query.cursor);
    where.push("(a.read_at < ? OR (a.read_at = ? AND a.id < ?))");
    params.push(value, value, id);
  }
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM articles a WHERE ${where.join(" AND ")} ORDER BY a.read_at DESC, a.id DESC LIMIT ?`)
    .all(...params, limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { items: page.map(toSummary), nextCursor: rows.length > limit && last ? encodeCursor([str(last.read_at), num(last.id)]) : null };
}

/**
 * A page of articles, without events that have ended unless they are asked for. A list of events is ordered
 * by start time, soonest first; every other list by last update, newest first. The recently read articles
 * are a list of their own.
 */
export function listArticles(db: Database, query: ArticleListQuery, now: string): ArticleList {
  if (query.recentlyRead === "true") return listRecentlyRead(db, query, now);
  const limit = query.limit ?? 50;
  const byEventStart = query.kind === "event";
  const params: Array<string | number> = [];
  // A feed article that filters hide is in no list.
  const where: string[] = [`NOT ${hiddenByFilters("a")}`];
  if (query.category !== undefined) {
    where.push("a.category_id = ?");
    params.push(query.category);
  }
  if (query.uncategorized === "true") where.push("a.origin = 'feed' AND a.category_id IS NULL");
  if (query.origin !== undefined) {
    where.push("a.origin = ?");
    params.push(query.origin);
  }
  if (query.feed !== undefined) {
    where.push("a.feed_id = ?");
    params.push(query.feed);
  }
  // A duplicate is listed with its own feed and among the starred, and nowhere else.
  if (query.feed === undefined && query.starred !== "true") where.push(`NOT ${hiddenDuplicate("a")}`);
  if (query.kind !== undefined) {
    where.push("a.kind = ?");
    params.push(query.kind);
  }
  if (query.unread !== undefined) where.push(`a.is_read = ${query.unread === "true" ? 0 : 1}`);
  if (query.starred !== undefined) where.push(`a.starred = ${query.starred === "true" ? 1 : 0}`);
  if (query.minImportance !== undefined) {
    // Feed articles have no importance, so a lower bound leaves them out.
    where.push("a.importance >= ?");
    params.push(query.minImportance);
  }
  if (query.includeEnded !== "true") {
    where.push("(a.kind <> 'event' OR a.event_ends_at >= ?)");
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
      `SELECT ${SUMMARY_COLUMNS} FROM articles a WHERE ${where.join(" AND ")}
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

/** A page of the articles `a` that meet `where`, newest first by the time lists sort by, as the article list pages. */
export function pageArticles(
  db: Database,
  where: string,
  params: Array<string | number>,
  query: { limit?: number; cursor?: string },
): ArticleList {
  const limit = query.limit ?? 50;
  const conditions = [`(${where})`];
  const values = [...params];
  if (query.cursor !== undefined) {
    const [value, id] = decodeCursor(query.cursor);
    conditions.push("(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))");
    values.push(value, value, id);
  }
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM articles a WHERE ${conditions.join(" AND ")} ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`)
    .all(...values, limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { items: page.map(toSummary), nextCursor: rows.length > limit && last ? encodeCursor([str(last.updated_at), num(last.id)]) : null };
}

/** A term as an FTS5 phrase: in double quotes, a quote in it doubled, so that no sign or word is an operator. */
function ftsPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

/** A term as a LIKE pattern for a part of the text, its wildcards and the escape character escaped. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * A page of the articles that have every term of the query, newest first by last update, generated and
 * delivered alike, read ones and ended events included. Terms of three or more characters use the trigram
 * index; shorter ones are matched with LIKE against the same text. What filters hide is left out, and so are
 * hidden duplicates unless a feed is named, as in the article list. Each article comes with an excerpt.
 */
export function searchArticles(db: Database, query: ArticleSearchQuery): ArticleSearchResult {
  const terms = parseSearchTerms(query.q);
  const long = terms.filter((term) => charCount(term) > SHORT_TERM_CHARS);
  const short = terms.filter((term) => charCount(term) <= SHORT_TERM_CHARS);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (long.length > 0) {
    where.push("a.id IN (SELECT rowid FROM article_search WHERE article_search MATCH ?)");
    params.push(long.map(ftsPhrase).join(" "));
  }
  for (const term of short) {
    where.push("(SELECT s.text FROM article_search s WHERE s.rowid = a.id) LIKE ? ESCAPE '\\'");
    params.push(likePattern(term));
  }
  where.push(`NOT ${hiddenByFilters("a")}`);
  if (query.feed === undefined) where.push(`NOT ${hiddenDuplicate("a")}`);
  if (query.category !== undefined) {
    where.push("a.category_id = ?");
    params.push(query.category);
  }
  if (query.feed !== undefined) {
    where.push("a.feed_id = ?");
    params.push(query.feed);
  }
  if (query.unread === "true") where.push("a.is_read = 0");
  const page = pageArticles(db, where.join(" AND "), params, query);
  const ids = page.items.map((item) => item.id);
  const fields = new Map(
    db
      .prepare(
        `SELECT id, origin, summary, auto_summary, body, content_text, impact, event_venue FROM articles
          WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(ids))
      .map((row) => [num(row.id), row] as const),
  );
  const items = page.items.map((item): ArticleSearchHit => {
    const row = fields.get(item.id)!;
    const excerpt = excerptOf(
      {
        summary: str(row.summary),
        autoSummary: strOrNull(row.auto_summary),
        body: searchBody({ origin: str(row.origin), body: str(row.body), contentText: str(row.content_text) }),
        impact: strOrNull(row.impact),
        venue: strOrNull(row.event_venue),
      },
      terms,
    );
    return { ...item, excerpt };
  });
  return { items, nextCursor: page.nextCursor, terms };
}

/**
 * Marks read, at the given time, the unread hidden duplicates of the given kept articles, and returns them.
 * A duplicate that filters hide stays unread, as "mark all as read" leaves such articles. Never the other way
 * round: reading a duplicate, or putting the kept article back to unread, changes nothing else.
 */
function readDuplicatesOf(db: Database, keptIds: number[], now: string): number[] {
  if (keptIds.length === 0) return [];
  return db
    .prepare(
      `UPDATE articles AS d SET is_read = 1, read_at = ?
        WHERE d.duplicate_of IN (SELECT value FROM json_each(?)) AND d.is_read = 0
          AND ${hiddenDuplicate("d")} AND NOT ${hiddenByFilters("d")}
        RETURNING id`,
    )
    .all(now, JSON.stringify(keptIds))
    .map((row) => num(row.id));
}

/**
 * Changes whether an article is read or starred. An article that becomes read records `now` as its read time;
 * one that was read already keeps its time, and one put back to unread loses it.
 */
export function setArticleFlags(db: Database, id: number, patch: ArticleUpdate, now: string): Article {
  getArticle(db, id);
  transaction(db, () => {
    if (patch.isRead !== undefined) {
      const changed = num(
        db
          .prepare("UPDATE articles SET is_read = ?, read_at = ? WHERE id = ? AND is_read <> ?")
          .run(patch.isRead ? 1 : 0, patch.isRead ? now : null, id, patch.isRead ? 1 : 0).changes,
      );
      if (patch.isRead && changed > 0) readDuplicatesOf(db, [id], now);
    }
    if (patch.starred !== undefined) db.prepare("UPDATE articles SET starred = ? WHERE id = ?").run(patch.starred ? 1 : 0, id);
  });
  return getArticle(db, id);
}

/**
 * Marks as read, at `now`, the unread articles last updated before the given time, and returns which ones
 * changed: the hidden duplicates of those articles too, wherever they are.
 */
export function markArticlesRead(
  db: Database,
  filter: { categoryId?: number; uncategorized?: boolean; origin?: Origin; feedId?: number; minImportance?: number; before: string },
  now: string,
): number[] {
  // What filters hide is in no list, so it is not marked either: it comes back unread when the filter goes.
  const where = ["is_read = 0", "updated_at < ?", `NOT ${hiddenByFilters("articles")}`];
  const params: Array<string | number> = [new Date(filter.before).toISOString()];
  if (filter.categoryId !== undefined) {
    where.push("category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.uncategorized) where.push("origin = 'feed' AND category_id IS NULL");
  if (filter.origin !== undefined) {
    where.push("origin = ?");
    params.push(filter.origin);
  }
  if (filter.feedId !== undefined) {
    where.push("feed_id = ?");
    params.push(filter.feedId);
  }
  if (filter.minImportance !== undefined) {
    where.push("importance >= ?");
    params.push(filter.minImportance);
  }
  return transaction(db, () => {
    const marked = db
      .prepare(`UPDATE articles SET is_read = 1, read_at = ? WHERE ${where.join(" AND ")} RETURNING id`)
      .all(now, ...params)
      .map((row) => num(row.id));
    return [...marked, ...readDuplicatesOf(db, marked, now)].sort((a, b) => a - b);
  });
}

/** Puts the named articles back to unread, without their read times. Returns how many changed. */
export function markArticlesUnread(db: Database, ids: number[]): number {
  const statement = db.prepare("UPDATE articles SET is_read = 0, read_at = NULL WHERE id = ? AND is_read = 1");
  let changed = 0;
  for (const id of ids) changed += num(statement.run(id).changes);
  return changed;
}

/**
 * Unread and starred totals, and per category the unread count and the number of articles. Feed articles
 * count towards their category; the generated ones are also counted on their own, and so is every feed.
 */
export function getCounts(db: Database, now: string): Counts {
  // One pass over the narrow index `articles_counts`; the totals are added up here.
  const groups = db
    .prepare(
      `SELECT category_id, feed_id, origin,
              count(*) AS total,
              sum(starred) AS starred,
              sum(is_read = 0 AND (kind <> 'event' OR event_ends_at >= ?)) AS unread,
              sum(${hiddenDuplicate("articles")}) AS duplicates,
              sum(${hiddenDuplicate("articles")} AND is_read = 0 AND (kind <> 'event' OR event_ends_at >= ?)) AS unread_duplicates
         FROM articles WHERE NOT ${hiddenByFilters("articles")}
        GROUP BY category_id, feed_id, origin`,
    )
    .all(now, now);
  const categories = new Map(
    db
      .prepare("SELECT id FROM categories ORDER BY id")
      .all()
      .map((row): [number, Counts["categories"][number]] => [num(row.id), { categoryId: num(row.id), unread: 0, total: 0, generatedUnread: 0, generatedTotal: 0 }]),
  );
  const feeds = new Map(
    db
      .prepare("SELECT id FROM feeds ORDER BY id")
      .all()
      .map((row): [number, Counts["feeds"][number]] => [num(row.id), { feedId: num(row.id), unread: 0 }]),
  );
  const counts: Counts = { unread: 0, starred: 0, generatedUnread: 0, uncategorizedUnread: 0, categories: [], feeds: [] };
  for (const row of groups) {
    // A hidden duplicate counts for its own feed and among the starred only. Generated articles have none.
    const unread = num(row.unread) - num(row.unread_duplicates);
    const generated = str(row.origin) === "generated";
    counts.unread += unread;
    counts.starred += num(row.starred);
    if (generated) counts.generatedUnread += unread;
    const category = row.category_id === null ? undefined : categories.get(num(row.category_id));
    if (category) {
      category.unread += unread;
      category.total += num(row.total) - num(row.duplicates);
      if (generated) {
        category.generatedUnread += unread;
        category.generatedTotal += num(row.total);
      }
    } else if (!generated) {
      counts.uncategorizedUnread += unread;
    }
    const feed = row.feed_id === null ? undefined : feeds.get(num(row.feed_id));
    if (feed) feed.unread += num(row.unread);
  }
  counts.categories = [...categories.values()];
  counts.feeds = [...feeds.values()];
  return counts;
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
        WHERE a.${GENERATED} AND ${scope} AND (a.kind <> 'event' OR a.event_ends_at >= ?)
        ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`,
    )
    .all(...params, filter.now, filter.limit)
    .map((row) => toArticle(db, row));
}

/** Removes generated articles without a star that were last updated before the given time. */
export function deleteUnstarredArticlesBefore(db: Database, before: string): number {
  return num(db.prepare(`DELETE FROM articles WHERE ${GENERATED} AND starred = 0 AND updated_at < ?`).run(before).changes);
}

/** Removes feed articles without a star whose sort time lies before the given time. */
export function deleteUnstarredFeedArticlesBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM articles WHERE origin = 'feed' AND starred = 0 AND updated_at < ?").run(before).changes);
}
