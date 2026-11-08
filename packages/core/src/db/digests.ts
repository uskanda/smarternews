// Storing digests, and gathering the articles a digest is made from. Digests have a table of their own: no
// question about the articles table has to tell them apart from generated articles.
import type { Digest, DigestSection, DigestSummary, DigestTrigger } from "../api.ts";
import { notFound } from "../errors.ts";
import { hiddenByFilters, hiddenDuplicate } from "./articles.ts";
import type { Database } from "./database.ts";
import { json, num, numOrNull, str, strOrNull, type Row } from "./rows.ts";

const HOUR = 3_600_000;
/** A digest covers at most this much time, counted back from when it is made. */
export const DIGEST_MAX_PERIOD_MS = 24 * HOUR;
/** The most articles one digest is made from. */
export const DIGEST_MAX_ARTICLES = 200;
/** Of a feed article without a summary, this much of its delivered content is given to the model. */
export const DIGEST_EXCERPT_CHARS = 300;
/** Digests are deleted this long after they were made. */
export const DIGEST_RETENTION_DAYS = 180;

function toSummary(row: Row): DigestSummary {
  return {
    id: num(row.id),
    createdAt: str(row.created_at),
    periodStart: str(row.period_start),
    periodEnd: str(row.period_end),
    trigger: str(row.trigger) as DigestTrigger,
    articleCount: num(row.article_count),
    executiveSummary: str(row.executive_summary),
  };
}

export function listDigests(db: Database, options: { limit?: number } = {}): DigestSummary[] {
  return db
    .prepare("SELECT * FROM digests ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(options.limit ?? 30)
    .map(toSummary);
}

/** One digest, with the title and origin of each source article that is still stored. */
export function getDigest(db: Database, id: number): Digest {
  const row = db.prepare("SELECT * FROM digests WHERE id = ?").get(id);
  if (!row) throw notFound("digest", String(id));
  const sections = json<DigestSection[]>(row.sections);
  const ids = [...new Set(sections.flatMap((section) => section.lines.flatMap((line) => line.articleIds)))];
  const articles = db
    .prepare("SELECT id, title, translated_title, origin FROM articles WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id")
    .all(JSON.stringify(ids))
    .map((article) => ({
      id: num(article.id),
      title: strOrNull(article.translated_title) ?? str(article.title),
      origin: str(article.origin) as "generated" | "feed",
    }));
  return { ...toSummary(row), sections, articles };
}

export function hasDigestForSlot(db: Database, slot: string): boolean {
  return db.prepare("SELECT 1 FROM digests WHERE slot = ?").get(slot) !== undefined;
}

export function saveDigest(
  db: Database,
  digest: {
    periodStart: string;
    periodEnd: string;
    createdAt: string;
    trigger: DigestTrigger;
    slot: string | null;
    executiveSummary: string;
    sections: DigestSection[];
    articleCount: number;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO digests (period_start, period_end, created_at, trigger, slot, executive_summary, sections, article_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      digest.periodStart,
      digest.periodEnd,
      digest.createdAt,
      digest.trigger,
      digest.slot,
      digest.executiveSummary,
      JSON.stringify(digest.sections),
      digest.articleCount,
    );
  return num(result.lastInsertRowid);
}

/**
 * Where the period of a digest made at `end` starts: where the last stored digest ended, but no more than a day
 * back. A digest that failed was never stored, so the next one covers its period too.
 */
export function digestPeriodStart(db: Database, end: Date): Date {
  const last = db.prepare("SELECT max(period_end) AS at FROM digests").get()!.at;
  const floor = new Date(end.getTime() - DIGEST_MAX_PERIOD_MS);
  if (typeof last !== "string") return floor;
  const after = new Date(last);
  return after > floor ? after : floor;
}

export interface DigestArticle {
  id: number;
  categoryId: number | null;
  origin: "generated" | "feed";
  title: string;
  importance: number | null;
  text: string;
}

/**
 * The articles of a period a digest is made from, at most `DIGEST_MAX_ARTICLES`: generated articles created or
 * revised in it, by importance and then newest first, and after them feed articles stored in it, newest first.
 * Feed articles that filters hide and hidden duplicates are left out, as the lists leave them out; so is every
 * article of a disabled category. Of a feed article only its title and its summary, or the start of what the
 * feed delivered, are read: never its full content.
 */
export function digestArticles(db: Database, period: { start: string; end: string }): DigestArticle[] {
  const enabled = "(a.category_id IS NULL OR EXISTS (SELECT 1 FROM categories c WHERE c.id = a.category_id AND c.enabled = 1))";
  const generated = db
    .prepare(
      `SELECT a.id, a.category_id, a.title, a.importance, a.summary FROM articles a
        WHERE a.origin = 'generated' AND a.updated_at > ? AND a.updated_at <= ? AND ${enabled}
        ORDER BY a.importance DESC, a.updated_at DESC, a.id DESC LIMIT ?`,
    )
    .all(period.start, period.end, DIGEST_MAX_ARTICLES)
    .map(
      (row): DigestArticle => ({
        id: num(row.id),
        categoryId: numOrNull(row.category_id),
        origin: "generated",
        title: str(row.title),
        importance: numOrNull(row.importance),
        text: str(row.summary),
      }),
    );
  const room = DIGEST_MAX_ARTICLES - generated.length;
  if (room <= 0) return generated;
  const feed = db
    .prepare(
      `SELECT a.id, a.category_id, a.title, a.translated_title, a.auto_summary, substr(a.content_text, 1, ?) AS excerpt FROM articles a
        WHERE a.origin = 'feed' AND a.created_at > ? AND a.created_at <= ? AND ${enabled}
          AND NOT ${hiddenByFilters("a")} AND NOT ${hiddenDuplicate("a")}
        ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`,
    )
    .all(DIGEST_EXCERPT_CHARS, period.start, period.end, room)
    .map(
      (row): DigestArticle => ({
        id: num(row.id),
        categoryId: numOrNull(row.category_id),
        origin: "feed",
        title: strOrNull(row.translated_title) ?? str(row.title),
        importance: null,
        text: strOrNull(row.auto_summary) ?? str(row.excerpt),
      }),
    );
  return [...generated, ...feed];
}

export function deleteDigestsBefore(db: Database, before: string): number {
  return num(db.prepare("DELETE FROM digests WHERE created_at < ?").run(before).changes);
}
