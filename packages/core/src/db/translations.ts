import type { ArticleTranslation, TranslationMethod } from "../api.ts";
import { renderMarkdown } from "../markdown.ts";
import { localParts } from "../time.ts";
import type { Database } from "./database.ts";
import { bool, json, num, str } from "./rows.ts";

// What is kept about translations: how many characters went to the translation API in each month, the
// translated title of a feed article, and its content segment by segment.

/** The month an instant belongs to in the given time zone, as YYYY-MM. */
export function translationMonth(now: Date, timeZone: string): string {
  return localParts(now, timeZone).date.slice(0, 7);
}

/** Characters sent to the translation API in the given month. */
export function translationCharsOf(db: Database, month: string): number {
  const row = db.prepare("SELECT chars FROM translation_usage WHERE month = ?").get(month);
  return row ? num(row.chars) : 0;
}

/**
 * Counts a request before it is sent. Returns false, and counts nothing, when the month would pass its
 * limit. What was counted stays counted even when the request fails: the API may bill it all the same.
 */
export function reserveTranslationChars(db: Database, month: string, chars: number, limit: number): boolean {
  if (translationCharsOf(db, month) + chars > limit) return false;
  db.prepare("INSERT INTO translation_usage (month, chars) VALUES (?, ?) ON CONFLICT (month) DO UPDATE SET chars = chars + excluded.chars").run(month, chars);
  return true;
}

/** Stores a translated title, unless the title changed since it was sent. */
export function saveTranslatedTitle(db: Database, id: number, translation: { original: string; title: string; sourceLanguage: string | null }): void {
  db.prepare("UPDATE articles SET translated_title = ?, source_language = coalesce(?, source_language) WHERE id = ? AND title = ?").run(
    translation.title,
    translation.sourceLanguage,
    id,
    translation.original,
  );
}

export interface StoredSegment {
  original: string;
  /** Null for a segment that is shown as it is. */
  translated: string | null;
}

export function saveArticleTranslation(
  db: Database,
  id: number,
  translation: { segments: StoredSegment[]; method: TranslationMethod; truncated: boolean; now: string },
): void {
  db.prepare(
    `INSERT INTO article_translations (article_id, segments, method, truncated, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (article_id) DO UPDATE SET segments = excluded.segments, method = excluded.method, truncated = excluded.truncated,
       created_at = excluded.created_at`,
  ).run(id, JSON.stringify(translation.segments), translation.method, translation.truncated ? 1 : 0, translation.now);
}

/** Forgets the translation of an article's content. Called when the feed rewrote the item. */
export function deleteArticleTranslation(db: Database, id: number): void {
  db.prepare("DELETE FROM article_translations WHERE article_id = ?").run(id);
}

/**
 * The stored translation of a feed article's content, or null. The HTML is made here from the Markdown, by
 * the renderer that shows a tag as text; the title and the language are the article's own columns.
 */
export function findArticleTranslation(db: Database, id: number, article: { translatedTitle: string | null; sourceLanguage: string | null }): ArticleTranslation | null {
  const row = db.prepare("SELECT segments, method, truncated, created_at FROM article_translations WHERE article_id = ?").get(id);
  if (!row) return null;
  const html = (markdown: string) => renderMarkdown(markdown, { images: "relayed" });
  return {
    translatedTitle: article.translatedTitle,
    sourceLanguage: article.sourceLanguage,
    segments: json<StoredSegment[]>(row.segments).map((segment) => ({
      original: segment.original,
      translated: segment.translated,
      originalHtml: html(segment.original),
      translatedHtml: segment.translated === null ? null : html(segment.translated),
    })),
    method: str(row.method) as TranslationMethod,
    truncated: bool(row.truncated),
    createdAt: str(row.created_at),
  };
}
