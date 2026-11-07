import { DomainError, notFound } from "../errors.ts";
import type { Database } from "./database.ts";
import { num, numOrNull, str } from "./rows.ts";

// Misses: the reader's mark on a generated article that should not have been made for its topics. A miss keeps the
// title and the topics of its article as they were when it was marked, so that it outlives the article. The next
// interpretation of a topic reads the titles of its recent misses. No model is involved in keeping them.

const DAY = 86_400_000;
/** How far back the misses that an interpretation reads go. */
export const MISS_WINDOW_DAYS = 90;
/** How many misses an interpretation reads at most, newest first. */
export const MISS_LIMIT = 20;

export function isMissed(db: Database, articleId: number): boolean {
  return db.prepare("SELECT 1 FROM misses WHERE article_id = ?").get(articleId) !== undefined;
}

/**
 * Marks a generated article as a miss, with its title and topics as they are now. An article marked already keeps
 * the mark it has. A feed article is refused: misses are about what the pipeline made.
 */
export function markMissed(db: Database, articleId: number, now: string): void {
  const article = db.prepare("SELECT origin, category_id, title FROM articles WHERE id = ?").get(articleId);
  if (!article) throw notFound("article", articleId);
  if (str(article.origin) !== "generated") {
    throw new DomainError("invalid", `article ${articleId} is not a generated article`, [
      { path: "missed", message: "only a generated article can be marked as a miss", code: "not_allowed" },
    ]);
  }
  if (isMissed(db, articleId)) return;
  const missId = num(
    db
      .prepare("INSERT INTO misses (article_id, category_id, title, marked_at) VALUES (?, ?, ?, ?)")
      .run(articleId, num(article.category_id), str(article.title), now).lastInsertRowid,
  );
  db.prepare("INSERT INTO miss_topics (miss_id, topic_id) SELECT ?, topic_id FROM article_topics WHERE article_id = ?").run(
    missId,
    articleId,
  );
}

/** Takes the mark away from an article. An article without one is left as it is. */
export function unmarkMissed(db: Database, articleId: number): void {
  db.prepare("DELETE FROM misses WHERE article_id = ?").run(articleId);
}

/**
 * The titles of the topic's misses that an interpretation reads: those marked within the last 90 days, newest
 * first, 20 at most.
 */
export function recentMissTitles(db: Database, topicId: number, now: string): string[] {
  const since = new Date(Date.parse(now) - MISS_WINDOW_DAYS * DAY).toISOString();
  return db
    .prepare(
      `SELECT m.title FROM misses m JOIN miss_topics mt ON mt.miss_id = m.id
        WHERE mt.topic_id = ? AND m.marked_at >= ?
        ORDER BY m.marked_at DESC, m.id DESC LIMIT ?`,
    )
    .all(topicId, since, MISS_LIMIT)
    .map((row) => str(row.title));
}

/** The misses kept, newest first, with the topics they were marked for. */
export function listMisses(
  db: Database,
): { id: number; articleId: number | null; categoryId: number; title: string; markedAt: string; topicIds: number[] }[] {
  return db
    .prepare("SELECT * FROM misses ORDER BY marked_at DESC, id DESC")
    .all()
    .map((row) => ({
      id: num(row.id),
      articleId: numOrNull(row.article_id),
      categoryId: num(row.category_id),
      title: str(row.title),
      markedAt: str(row.marked_at),
      topicIds: db
        .prepare("SELECT topic_id FROM miss_topics WHERE miss_id = ? ORDER BY topic_id")
        .all(num(row.id))
        .map((topic) => num(topic.topic_id)),
    }));
}
