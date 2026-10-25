import type { ArticleList, MentionArticlesQuery } from "../api.ts";
import { mentionKey, type Mention, type MentionKind } from "../mentions.ts";
import { hiddenByFilters, hiddenDuplicate, pageArticles } from "./articles.ts";
import type { Database } from "./database.ts";
import { str } from "./rows.ts";

// The names found in articles by the write task and the summarize task. They are stored with the article, in
// the same transaction, and go with it. No model is involved here.

/**
 * Replaces the names of an article with the given ones, kept in their order. The caller has checked them with
 * `parseMentions`: at most ten, each name once. Runs inside the caller's transaction, if any.
 */
export function replaceMentions(db: Database, articleId: number, mentions: Mention[]): void {
  db.prepare("DELETE FROM article_mentions WHERE article_id = ?").run(articleId);
  const insert = db.prepare("INSERT INTO article_mentions (article_id, position, name, name_key, kind) VALUES (?, ?, ?, ?, ?)");
  for (const [position, mention] of mentions.entries()) insert.run(articleId, position, mention.name, mentionKey(mention.name), mention.kind);
}

/** The names of an article, in the order they were stored. */
export function mentionsOf(db: Database, articleId: number): Mention[] {
  return db
    .prepare("SELECT name, kind FROM article_mentions WHERE article_id = ? ORDER BY position")
    .all(articleId)
    .map((row) => ({ name: str(row.name), kind: str(row.kind) as MentionKind }));
}

/**
 * A page of the articles that have the name, as `mentionKey` compares names: generated and delivered, read
 * ones and ended events included, newest first by last update. What filters hide and hidden duplicates are
 * left out, as in a search over everything. `asOf` is `now`, as in the article list.
 */
export function listMentionArticles(db: Database, query: MentionArticlesQuery, now: string): ArticleList {
  const where = [
    "a.id IN (SELECT article_id FROM article_mentions WHERE name_key = ?)",
    `NOT ${hiddenByFilters("a")}`,
    `NOT ${hiddenDuplicate("a")}`,
  ].join(" AND ");
  const page = pageArticles(db, where, [mentionKey(query.name)], query);
  return { ...page, asOf: now };
}
