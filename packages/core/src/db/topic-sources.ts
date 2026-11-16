// Subscribed feeds as sources of the topics of their category: what a run takes from them, and what it records
// when it writes one of their articles into a generated article.
import { normalizeUrl } from "../fetch/url.ts";
import { hiddenByFilters, hiddenDuplicate } from "./articles.ts";
import type { Database } from "./database.ts";
import { num, str, type Row } from "./rows.ts";

/** A feed article as a run takes it for a candidate. */
export interface TopicSourceArticle {
  articleId: number;
  /** The article's page, normalized as every candidate URL is. */
  url: string;
  title: string;
  snippet: string;
  /** The name of the feed that delivered it. */
  siteName: string;
  /** The time the article sorts by: when it was published, or when it was fetched if the feed gave no date. */
  publishedAt: string;
}

/**
 * The feed articles a run of the category takes as candidates, newest stored first: those of its enabled feeds that
 * are topic sources, stored at or after `since`, with a page, and hidden neither as duplicates nor by the filters.
 * The URLs `isSettled` names are left out before at most `limit` are taken, so that settled ones never fill the
 * places of the others.
 */
export function listTopicSourceArticles(
  db: Database,
  categoryId: number,
  since: string,
  isSettled: (url: string) => boolean,
  limit: number,
): TopicSourceArticle[] {
  if (limit <= 0) return [];
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.summary, a.first_published_at, f.title AS feed_title,
              (SELECT r.url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position, r.id LIMIT 1) AS url
         FROM articles a JOIN feeds f ON f.id = a.feed_id
        WHERE a.origin = 'feed' AND f.category_id = ? AND f.topic_source = 1 AND f.enabled = 1 AND a.created_at >= ?
          AND NOT ${hiddenDuplicate("a")} AND NOT ${hiddenByFilters("a")}
        ORDER BY a.created_at DESC, a.id DESC`,
    )
    .iterate(categoryId, since) as Iterable<Row>;
  const taken: TopicSourceArticle[] = [];
  const urls = new Set<string>();
  for (const row of rows) {
    if (row.url === null || row.url === undefined) continue;
    const url = normalizeUrl(str(row.url));
    // Two feeds of the category that deliver the same page make one candidate.
    if (urls.has(url) || isSettled(url)) continue;
    urls.add(url);
    taken.push({
      articleId: num(row.id),
      url,
      title: str(row.title),
      snippet: str(row.summary),
      siteName: str(row.feed_title),
      publishedAt: str(row.first_published_at),
    });
    if (taken.length >= limit) break;
  }
  return taken;
}

/** The content a feed delivered for the article, without markup; empty when the article is gone. */
export function deliveredText(db: Database, feedArticleId: number): string {
  const row = db.prepare("SELECT content_text FROM articles WHERE id = ? AND origin = 'feed'").get(feedArticleId);
  return row ? str(row.content_text) : "";
}

/** Records the generated article that the given feed articles were written into. */
export function recordSummarizedIn(db: Database, feedArticleIds: number[], articleId: number): void {
  const statement = db.prepare("UPDATE articles SET summarized_in = ? WHERE id = ? AND origin = 'feed'");
  for (const id of feedArticleIds) statement.run(articleId, id);
}
