import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import type { Database } from "./database.ts";
import { applyStopWords, createStopWord, deleteStopWord, findStopWordFor, listStopWords, updateStopWord } from "./stop-words.ts";

const clock = fakeClock("2026-03-01T12:00:00.000Z");

function hiddenIds(db: Database): number[] {
  return db
    .prepare("SELECT id FROM articles WHERE stop_word_id IS NOT NULL AND starred = 0 ORDER BY id")
    .all()
    .map((row) => Number(row.id));
}

describe("matching", () => {
  const match = (word: string, scope: "title" | "title_and_content", title: string, content = "") => {
    const db = createTestDb();
    createStopWord(db, { text: word, scope }, clock);
    return findStopWordFor(db, title, content) !== null;
  };

  it("finds the word anywhere in the title", () => {
    expect(match("特売", "title", "春の特売の情報")).toBe(true);
    expect(match("特売", "title", "春の新製品")).toBe(false);
  });

  it("looks at the content only when the word covers it", () => {
    expect(match("提供", "title_and_content", "新製品", "この記事は提供でお送りします")).toBe(true);
    expect(match("提供", "title", "新製品", "この記事は提供でお送りします")).toBe(false);
  });

  it("does not tell upper case from lower case, or full-width from half-width", () => {
    expect(match("pr", "title", "ＰＲ　新しい店")).toBe(true);
    expect(match("ＰＲ", "title", "[pr] new shop")).toBe(true);
    expect(match("ｶﾒﾗ", "title", "新しいカメラ")).toBe(true);
  });

  it("compares signs as the characters they are, not as a pattern", () => {
    expect(match(".*", "title", "新製品の発表")).toBe(false);
    expect(match(".*", "title", "glob .* explained")).toBe(true);
  });
});

describe("createStopWord", () => {
  it("covers the title only unless told otherwise", () => {
    const db = createTestDb();
    expect(createStopWord(db, { text: "広告" }, clock)).toMatchObject({ text: "広告", scope: "title", hiddenCount: 0 });
  });

  it("refuses a word that is already there, however it is written", () => {
    const db = createTestDb();
    createStopWord(db, { text: "PR" }, clock);
    expect(() => createStopWord(db, { text: "ｐｒ" }, clock)).toThrow(/already/);
    expect(listStopWords(db)).toHaveLength(1);
  });

  it("hides stored feed articles that contain the word, and counts them", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const sale = seedFeedArticle(db, feed, { title: "春の特売" });
    seedFeedArticle(db, feed, { title: "新製品" });

    const word = createStopWord(db, { text: "特売" }, clock);

    expect(hiddenIds(db)).toEqual([sale]);
    expect(word.hiddenCount).toBe(1);
  });

  it("leaves a starred article visible, and out of the count", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "春の特売", starred: true });

    const word = createStopWord(db, { text: "特売" }, clock);

    expect(hiddenIds(db)).toEqual([]);
    expect(word.hiddenCount).toBe(0);
  });

  it("never touches a generated article", () => {
    const db = createTestDb();
    db.prepare(
      "INSERT INTO categories (id, slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, created_at) VALUES (1, 'c', 'C', 'news', '[]', 3, 5, 24, '2026-01-01T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO articles (category_id, kind, title, summary, body, importance, first_published_at, updated_at) VALUES (1, 'news', '特売の分析', 's', 'b', 3, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    ).run();

    createStopWord(db, { text: "特売" }, clock);

    expect(hiddenIds(db)).toEqual([]);
  });
});

describe("deleteStopWord", () => {
  it("brings back what only that word hid, as unread or read as it was", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const unread = seedFeedArticle(db, feed, { title: "特売 1" });
    const read = seedFeedArticle(db, feed, { title: "特売 2", isRead: true });
    const word = createStopWord(db, { text: "特売" }, clock);

    expect(deleteStopWord(db, word.id)).toEqual({ restored: 2 });

    expect(hiddenIds(db)).toEqual([]);
    expect(db.prepare("SELECT id, is_read FROM articles ORDER BY id").all()).toEqual([
      { id: unread, is_read: 0 },
      { id: read, is_read: 1 },
    ]);
  });

  it("keeps hidden what another word also matches", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const both = seedFeedArticle(db, feed, { title: "特売の広告" });
    const first = createStopWord(db, { text: "特売" }, clock);
    const second = createStopWord(db, { text: "広告" }, clock);

    expect(deleteStopWord(db, first.id)).toEqual({ restored: 0 });

    expect(hiddenIds(db)).toEqual([both]);
    expect(listStopWords(db)).toEqual([expect.objectContaining({ id: second.id, hiddenCount: 1 })]);
  });
});

describe("updateStopWord", () => {
  it("hides articles that match in the content once the word covers the content", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const article = seedFeedArticle(db, feed, { title: "新製品", body: "提供の記事" });
    const word = createStopWord(db, { text: "提供" }, clock);
    expect(hiddenIds(db)).toEqual([]);

    expect(updateStopWord(db, word.id, { scope: "title_and_content" }).hiddenCount).toBe(1);
    expect(hiddenIds(db)).toEqual([article]);

    updateStopWord(db, word.id, { scope: "title" });
    expect(hiddenIds(db)).toEqual([]);
  });
});

describe("applyStopWords", () => {
  it("judges one article again, for when its content changed", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const article = seedFeedArticle(db, feed, { title: "新製品" });
    createStopWord(db, { text: "特売" }, clock);
    db.prepare("UPDATE articles SET title = '特売の新製品' WHERE id = ?").run(article);

    applyStopWords(db, article);

    expect(hiddenIds(db)).toEqual([article]);
  });
});
