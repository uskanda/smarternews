import type {
  AnnotationKind,
  AnnotationList,
  AnnotationListQuery,
  ArticleAnnotations,
  ArticleNote,
  Highlight,
  Origin,
} from "../api.ts";
import { DomainError, notFound } from "../errors.ts";
import type { Database } from "./database.ts";
import { num, str, strOrNull, type Row } from "./rows.ts";

// A reader's annotations on articles: highlights on the body, each with a note or none, and one note on the
// whole article. They are kept as they were written whatever becomes of the body; a screen finds the
// highlights in the body it draws. Triggers keep them in the search index. No model is involved.

function toHighlight(row: Row): Highlight {
  return {
    id: num(row.id),
    articleId: num(row.article_id),
    quote: str(row.quote),
    prefix: str(row.prefix),
    suffix: str(row.suffix),
    position: num(row.position),
    note: strOrNull(row.note),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function toNote(row: Row): ArticleNote {
  return { id: num(row.id), articleId: num(row.article_id), text: str(row.note), createdAt: str(row.created_at), updatedAt: str(row.updated_at) };
}

function requireArticle(db: Database, articleId: number): void {
  if (!db.prepare("SELECT 1 FROM articles WHERE id = ?").get(articleId)) throw notFound("article", articleId);
}

function findHighlight(db: Database, id: number): Highlight {
  const row = db.prepare("SELECT * FROM annotations WHERE id = ? AND kind = 'highlight'").get(id);
  if (!row) throw notFound("highlight", id);
  return toHighlight(row);
}

/** The annotations of an article: its note or none, and its highlights in the order they were made. */
export function annotationsOf(db: Database, articleId: number): ArticleAnnotations {
  const rows = db.prepare("SELECT * FROM annotations WHERE article_id = ? ORDER BY created_at, id").all(articleId);
  const note = rows.find((row) => str(row.kind) === "note");
  return { note: note ? toNote(note) : null, highlights: rows.filter((row) => str(row.kind) === "highlight").map(toHighlight) };
}

/** Adds a highlight to an article. The quote is not checked against the body, which only a screen draws. */
export function addHighlight(
  db: Database,
  articleId: number,
  input: { quote: string; prefix: string; suffix: string; position: number; note: string | null },
  now: string,
): Highlight {
  requireArticle(db, articleId);
  const id = num(
    db
      .prepare(
        `INSERT INTO annotations (article_id, kind, quote, prefix, suffix, position, note, created_at, updated_at)
         VALUES (?, 'highlight', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, input.quote, input.prefix, input.suffix, input.position, input.note, now, now).lastInsertRowid,
  );
  return findHighlight(db, id);
}

/** Puts a note on a highlight in place of the one it has, or removes it with null. When it was made stays. */
export function updateHighlightNote(db: Database, id: number, note: string | null, now: string): Highlight {
  findHighlight(db, id);
  db.prepare("UPDATE annotations SET note = ?, updated_at = ? WHERE id = ?").run(note, now, id);
  return findHighlight(db, id);
}

/** Removes a highlight with its note. */
export function deleteHighlight(db: Database, id: number): void {
  findHighlight(db, id);
  db.prepare("DELETE FROM annotations WHERE id = ?").run(id);
}

/**
 * Writes the note on a whole article: a new one, or the text of the one it has replaced, which keeps the time
 * it was first written.
 */
export function saveArticleNote(db: Database, articleId: number, text: string, now: string): ArticleNote {
  requireArticle(db, articleId);
  const row = db
    .prepare(
      `INSERT INTO annotations (article_id, kind, note, created_at, updated_at) VALUES (?, 'note', ?, ?, ?)
       ON CONFLICT (article_id) WHERE kind = 'note' DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
       RETURNING *`,
    )
    .get(articleId, text, now, now);
  return toNote(row!);
}

/** Removes the note on a whole article. An article without one is left as it is. */
export function deleteArticleNote(db: Database, articleId: number): void {
  requireArticle(db, articleId);
  db.prepare("DELETE FROM annotations WHERE article_id = ? AND kind = 'note'").run(articleId);
}

type Cursor = [string, number];

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor: string): Cursor {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    value = null;
  }
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number") return [value[0], value[1]];
  throw new DomainError("invalid", "the cursor is not one this server issued", [{ path: "cursor", message: "invalid cursor" }]);
}

/**
 * A page of the annotations of every article, the last made first. Every article is in it: an annotated feed
 * article is never hidden by filters, and the annotations of a hidden duplicate are the reader's own.
 */
export function listAnnotations(db: Database, query: AnnotationListQuery): AnnotationList {
  const limit = query.limit ?? 50;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.cursor !== undefined) {
    const [createdAt, id] = decodeCursor(query.cursor);
    where.push("(n.created_at < ? OR (n.created_at = ? AND n.id < ?))");
    params.push(createdAt, createdAt, id);
  }
  const rows = db
    .prepare(
      `SELECT n.id, n.kind, n.article_id, n.quote, n.note, n.created_at, a.origin, a.title, a.translated_title
         FROM annotations n JOIN articles a ON a.id = n.article_id
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      kind: str(row.kind) as AnnotationKind,
      id: num(row.id),
      articleId: num(row.article_id),
      origin: str(row.origin) as Origin,
      title: str(row.title),
      translatedTitle: strOrNull(row.translated_title),
      quote: strOrNull(row.quote),
      note: strOrNull(row.note),
      createdAt: str(row.created_at),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor([str(last.created_at), num(last.id)]) : null,
  };
}
