import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { purgeExpired } from "../runs/retention.ts";
import {
  addHighlight,
  annotationsOf,
  deleteArticleNote,
  deleteHighlight,
  listAnnotations,
  saveArticleNote,
  updateHighlightNote,
} from "./annotations.ts";
import {
  getArticle,
  getCounts,
  hiddenByFilters,
  insertArticle,
  listArticles,
  markArticlesRead,
  nextArticleForFullContent,
  nextArticleToSummarize,
  setArticleFlags,
  type ArticleContent,
} from "./articles.ts";
import { createCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { deleteFeed, feedStats, listFeeds, updateFeed } from "./feeds.ts";
import { createFilter, deleteFilter, listFilterArticles, listFilters, previewFilter, updateFilter } from "./filters.ts";
import { updateSettings } from "./settings.ts";

const NOW = "2026-03-01T12:00:00.000Z";
const clock = fakeClock(NOW);
const anchor = { quote: "電池の工場を新設する", prefix: "同社は", suffix: "と発表した。", position: 3, note: null };
const SALE = [{ fields: ["title" as const], match: "contains" as const, value: "特売" }];

function generated(db: Database, overrides: Partial<ArticleContent> & { at?: string } = {}): number {
  const categoryId = createCategory(db, { slug: `c${Math.random().toString(36).slice(2, 8)}`, name: "c", kind: "news" }, clock).id;
  const { at, ...content } = overrides;
  return insertArticle(db, {
    categoryId,
    kind: "news",
    title: "Generated",
    summary: "s",
    body: "同社は電池の工場を新設すると発表した。",
    impact: null,
    importance: 3,
    unconfirmed: false,
    snippetOnly: false,
    event: null,
    ...content,
    now: at ?? NOW,
    previousArticleId: null,
    refs: [],
    topicIds: [],
  });
}

const at = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

describe("saving annotations", () => {
  it("keeps a highlight on a generated article and a note on a feed article, in their details", () => {
    const db = createTestDb();
    const articleId = generated(db);
    const highlight = addHighlight(db, articleId, anchor, NOW);
    expect(highlight).toEqual({ id: highlight.id, articleId, ...anchor, createdAt: NOW, updatedAt: NOW });
    expect(getArticle(db, articleId).annotations).toEqual({ note: null, highlights: [highlight] });

    const feedArticle = seedFeedArticle(db, seedFeed(db));
    const note = saveArticleNote(db, feedArticle, "あとで比べる", NOW);
    expect(getArticle(db, feedArticle).annotations).toEqual({
      note: { id: note.id, articleId: feedArticle, text: "あとで比べる", createdAt: NOW, updatedAt: NOW },
      highlights: [],
    });
  });

  it("keeps a highlight without a note, writes one later, and removes only the note", () => {
    const db = createTestDb();
    const articleId = generated(db);
    const highlight = addHighlight(db, articleId, anchor, at(-3 * 24 * 60));
    expect(highlight.note).toBeNull();
    const written = updateHighlightNote(db, highlight.id, "数字を確かめる", NOW);
    expect(written).toMatchObject({ note: "数字を確かめる", createdAt: at(-3 * 24 * 60), updatedAt: NOW });
    const cleared = updateHighlightNote(db, highlight.id, null, at(1));
    expect(cleared).toMatchObject({ note: null, quote: anchor.quote, createdAt: at(-3 * 24 * 60) });
    expect(annotationsOf(db, articleId).highlights).toHaveLength(1);
  });

  it("keeps one note on a whole article, replaced in place with the time it was first written", () => {
    const db = createTestDb();
    const articleId = generated(db);
    const first = saveArticleNote(db, articleId, "A", at(-60));
    const second = saveArticleNote(db, articleId, "B", NOW);
    expect(second).toEqual({ id: first.id, articleId, text: "B", createdAt: at(-60), updatedAt: NOW });
    expect(db.prepare("SELECT count(*) AS n FROM annotations WHERE article_id = ?").get(articleId)).toEqual({ n: 1 });
    deleteArticleNote(db, articleId);
    deleteArticleNote(db, articleId);
    expect(annotationsOf(db, articleId).note).toBeNull();
  });

  it("gives the highlights oldest first, and leaves the article list as it was", () => {
    const db = createTestDb();
    const articleId = generated(db);
    const later = addHighlight(db, articleId, { ...anchor, quote: "発表" }, at(5));
    const earlier = addHighlight(db, articleId, anchor, at(1));
    expect(getArticle(db, articleId).annotations.highlights.map((highlight) => highlight.id)).toEqual([earlier.id, later.id]);
    expect(Object.keys(listArticles(db, {}, NOW).items[0]!)).not.toContain("annotations");
  });

  it("keeps the annotations when the body changes", () => {
    const db = createTestDb();
    const articleId = seedFeedArticle(db, seedFeed(db), { body: "同社は電池の工場を新設すると発表した。" });
    const highlight = addHighlight(db, articleId, { ...anchor, note: "規模を確かめる" }, NOW);
    db.prepare("UPDATE articles SET body = '書き換えた本文', content_text = '書き換えた本文' WHERE id = ?").run(articleId);
    expect(getArticle(db, articleId).annotations.highlights).toEqual([highlight]);
  });

  it("removes the annotations with the article, as when its feed is deleted", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const articleId = seedFeedArticle(db, feedId);
    addHighlight(db, articleId, anchor, NOW);
    saveArticleNote(db, articleId, "メモ", NOW);
    deleteFeed(db, feedId);
    expect(listAnnotations(db, {}).items).toEqual([]);
  });

  it("refuses an article or a highlight that does not exist", () => {
    const db = createTestDb();
    const articleId = generated(db);
    const highlight = addHighlight(db, articleId, anchor, NOW);
    deleteHighlight(db, highlight.id);
    expect(() => updateHighlightNote(db, highlight.id, "x", NOW)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => deleteHighlight(db, highlight.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => addHighlight(db, 999, anchor, NOW)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => saveArticleNote(db, 999, "x", NOW)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => deleteArticleNote(db, 999)).toThrow(expect.objectContaining({ code: "not_found" }));
    const note = saveArticleNote(db, articleId, "メモ", NOW);
    expect(() => deleteHighlight(db, note.id)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

describe("the list of annotations", () => {
  it("mixes the kinds, the last made first, with the article's titles", () => {
    const db = createTestDb();
    const a = generated(db, { title: "記事A" });
    const b = seedFeedArticle(db, seedFeed(db), { title: "Article B" });
    db.prepare("UPDATE articles SET translated_title = '記事B' WHERE id = ?").run(b);
    addHighlight(db, a, anchor, at(-60));
    saveArticleNote(db, b, "あとで比べる", at(-30));
    addHighlight(db, a, { ...anchor, quote: "発表", note: "メモ" }, at(-10));
    expect(listAnnotations(db, {}).items.map((item) => [item.kind, item.articleId, item.title, item.translatedTitle, item.quote, item.note])).toEqual([
      ["highlight", a, "記事A", null, "発表", "メモ"],
      ["note", b, "Article B", "記事B", null, "あとで比べる"],
      ["highlight", a, "記事A", null, anchor.quote, null],
    ]);
  });

  it("is read a page at a time without repeats, ties broken by id", () => {
    const db = createTestDb();
    const articleId = generated(db);
    for (let index = 0; index < 120; index += 1) addHighlight(db, articleId, anchor, at(Math.floor(index / 3)));
    const first = listAnnotations(db, { limit: 50 });
    const second = listAnnotations(db, { limit: 50, cursor: first.nextCursor! });
    const third = listAnnotations(db, { limit: 50, cursor: second.nextCursor! });
    expect([first.items.length, second.items.length, third.items.length]).toEqual([50, 50, 20]);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(120);
    const order = all.map((item) => [item.createdAt, item.id] as const);
    expect(order).toEqual([...order].sort((x, y) => y[0].localeCompare(x[0]) || y[1] - x[1]));
    expect(() => listAnnotations(db, { cursor: "nonsense" })).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("holds the annotations of a recorded duplicate and of an article a later hide filter matches", () => {
    const db = createTestDb();
    const kept = seedFeedArticle(db, seedFeed(db), { title: "電池の話" });
    const duplicate = seedFeedArticle(db, seedFeed(db), { title: "電池の話", duplicateOf: kept });
    const sale = seedFeedArticle(db, seedFeed(db), { title: "特売の話" });
    addHighlight(db, duplicate, anchor, at(1));
    addHighlight(db, sale, anchor, at(2));
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: SALE }, clock);
    expect(listAnnotations(db, {}).items.map((item) => item.articleId)).toEqual([sale, duplicate]);
  });
});

describe("the retention of annotated articles", () => {
  function old(db: Database) {
    const feedId = seedFeed(db);
    return {
      generated: generated(db, { at: "2025-03-01T00:00:00.000Z" }),
      feed: seedFeedArticle(db, feedId, { at: "2025-03-01T00:00:00.000Z" }),
    };
  }
  const exists = (db: Database, id: number) => db.prepare("SELECT 1 FROM articles WHERE id = ?").get(id) !== undefined;

  it("keeps an annotated article a year old, generated or delivered, and removes the others", () => {
    const db = createTestDb();
    const highlighted = old(db);
    const noted = old(db);
    const plain = old(db);
    addHighlight(db, highlighted.generated, anchor, NOW);
    addHighlight(db, highlighted.feed, anchor, NOW);
    saveArticleNote(db, noted.generated, "メモ", NOW);
    saveArticleNote(db, noted.feed, "メモ", NOW);
    purgeExpired(db, clock);
    for (const id of [highlighted.generated, highlighted.feed, noted.generated, noted.feed]) expect(exists(db, id)).toBe(true);
    expect(exists(db, plain.generated)).toBe(false);
    expect(exists(db, plain.feed)).toBe(false);
  });

  it("removes an old article at the next purge once its last annotation is gone, unless it has a star", () => {
    const db = createTestDb();
    const unstarred = generated(db, { at: "2025-08-01T00:00:00.000Z" });
    const starred = generated(db, { at: "2025-08-01T00:00:00.000Z" });
    setArticleFlags(db, starred, { starred: true }, NOW);
    const one = addHighlight(db, unstarred, anchor, NOW);
    const two = addHighlight(db, starred, anchor, NOW);
    purgeExpired(db, clock);
    expect([exists(db, unstarred), exists(db, starred)]).toEqual([true, true]);
    deleteHighlight(db, one.id);
    deleteHighlight(db, two.id);
    purgeExpired(db, clock);
    expect([exists(db, unstarred), exists(db, starred)]).toEqual([false, true]);
  });

  it("keeps the origin condition: a feed article does not go after 180 days with the generated ones", () => {
    const db = createTestDb();
    const feedArticle = seedFeedArticle(db, seedFeed(db), { at: "2026-01-15T00:00:00.000Z" });
    purgeExpired(db, clock);
    expect(exists(db, feedArticle)).toBe(true);
  });
});

describe("filters and annotated feed articles", () => {
  function hidden() {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const ids = [0, 1, 2].map((index) => seedFeedArticle(db, feedId, { title: `特売 ${index}`, at: at(index) }));
    const filter = createFilter(db, { action: "hide", scope: { type: "all" }, conditions: SALE }, clock);
    return { db, feedId, ids, filter };
  }
  const listed = (db: Database) => listArticles(db, {}, NOW).items.map((item) => item.id);

  it("lists an article highlighted before the filter came, and leaves it out of the filter's count", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const ids = [0, 1, 2].map((index) => seedFeedArticle(db, feedId, { title: `特売 ${index}`, at: at(index) }));
    addHighlight(db, ids[0]!, anchor, NOW);
    const filter = createFilter(db, { action: "hide", scope: { type: "all" }, conditions: SALE }, clock);
    expect(listed(db)).toEqual([ids[0]]);
    expect(listFilters(db).find((one) => one.id === filter.id)?.hiddenCount).toBe(2);
    expect(listFilterArticles(db, filter.id, {}).items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(previewFilter(db, { action: "hide", scope: { type: "all" }, conditions: SALE }).hiddenCount).toBe(2);
  });

  it("brings back a hidden article that gets a note, and hides it again when its last annotation goes", () => {
    const { db, ids, filter } = hidden();
    expect(listed(db)).toEqual([]);
    saveArticleNote(db, ids[1]!, "メモ", NOW);
    expect(listed(db)).toEqual([ids[1]]);
    expect(listFilters(db)[0]!.hiddenCount).toBe(2);
    const highlight = addHighlight(db, ids[1]!, anchor, NOW);
    deleteArticleNote(db, ids[1]!);
    expect(listed(db)).toEqual([ids[1]]);
    deleteHighlight(db, highlight.id);
    expect(listed(db)).toEqual([]);
    expect(listFilters(db).find((one) => one.id === filter.id)?.hiddenCount).toBe(3);
  });

  it("counts, marks read and waits on an annotated article as on any visible one", () => {
    const { db, feedId, ids } = hidden();
    updateFeed(db, feedId, { autoSummarize: true, fetchFullContent: true }, fakeClock("2026-02-01T00:00:00.000Z"));
    expect(getCounts(db, NOW).unread).toBe(0);
    expect(nextArticleToSummarize(db)).toBeNull();
    expect(nextArticleForFullContent(db)).toBeNull();
    const highlight = addHighlight(db, ids[0]!, anchor, NOW);
    expect(getCounts(db, NOW)).toMatchObject({ unread: 1, feeds: [{ feedId, unread: 1 }] });
    expect(nextArticleToSummarize(db)?.id).toBe(ids[0]);
    expect(nextArticleForFullContent(db)?.id).toBe(ids[0]);
    expect(markArticlesRead(db, { before: at(10) }, at(11))).toEqual([ids[0]]);
    deleteHighlight(db, highlight.id);
    setArticleFlags(db, ids[0]!, { isRead: false }, NOW);
    expect(getCounts(db, NOW).unread).toBe(0);
  });

  it("names an annotated duplicate among the other feeds, and not once its annotation is gone", () => {
    const db = createTestDb();
    const kept = seedFeedArticle(db, seedFeed(db), { title: "電池の話" });
    const copy = seedFeedArticle(db, seedFeed(db), { title: "特売 電池の話", duplicateOf: kept });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: SALE }, clock);
    expect(getArticle(db, kept).otherFeeds).toEqual([]);
    const highlight = addHighlight(db, copy, anchor, NOW);
    expect(getArticle(db, kept).otherFeeds.map((other) => other.articleId)).toEqual([copy]);
    deleteHighlight(db, highlight.id);
    expect(getArticle(db, kept).otherFeeds).toEqual([]);
  });

  it("does not count an annotated article among those that come back when a filter goes", () => {
    const { db, ids, filter } = hidden();
    addHighlight(db, ids[0]!, anchor, NOW);
    expect(updateFilter(db, filter.id, { enabled: false }).restored).toBe(2);
    updateFilter(db, filter.id, { enabled: true });
    expect(deleteFilter(db, filter.id).restored).toBe(2);
  });

  it("leaves annotated articles out of the hidden count of the feed stats", () => {
    const { db, feedId, ids } = hidden();
    addHighlight(db, ids[0]!, anchor, NOW);
    expect(feedStats(db, feedId, new Date(NOW)).hiddenByFilters).toBe(2);
  });

  it("keeps the generated articles visible, with no filter to hide them", () => {
    const db = createTestDb();
    updateSettings(db, { removeDuplicates: true });
    const id = generated(db, { title: "特売" });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: SALE }, clock);
    addHighlight(db, id, anchor, NOW);
    expect(listed(db)).toEqual([id]);
  });
});

describe("the annotated articles of a feed", () => {
  it("counts each annotated article once, however many annotations it has", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const other = seedFeed(db);
    const first = seedFeedArticle(db, feedId);
    const second = seedFeedArticle(db, feedId);
    seedFeedArticle(db, feedId);
    addHighlight(db, first, anchor, NOW);
    addHighlight(db, first, anchor, NOW);
    saveArticleNote(db, first, "メモ", NOW);
    addHighlight(db, second, anchor, NOW);
    const feeds = listFeeds(db, new Date(NOW));
    expect(feeds.find((feed) => feed.id === feedId)).toMatchObject({ articleCount: 3, annotatedCount: 2 });
    expect(feeds.find((feed) => feed.id === other)).toMatchObject({ annotatedCount: 0 });
  });
});

describe("the time counts take with annotations in the filter condition", () => {
  it("counts 10,000 feed articles, 1,000 of them hidden, about as fast as before", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const insert = db.prepare(
      `INSERT INTO articles (origin, feed_id, item_key, kind, title, summary, body, content_text, first_published_at, updated_at, created_at, filtered)
       VALUES ('feed', ?, ?, 'news', 't', 's', 'b', 'b', ?, ?, ?, ?)`,
    );
    db.exec("BEGIN");
    for (let index = 0; index < 10_000; index += 1) insert.run(feedId, `k${index}`, NOW, NOW, NOW, index % 10 === 0 ? 1 : 0);
    db.exec("COMMIT");
    for (let index = 0; index < 50; index += 1) addHighlight(db, index * 10 + 1, anchor, NOW);
    const time = (run: () => unknown) => {
      run();
      const started = performance.now();
      for (let round = 0; round < 10; round += 1) run();
      return (performance.now() - started) / 10;
    };
    // The grouping of `getCounts`, with the condition before annotations and with the one now.
    const grouped = (hidden: string) =>
      db
        .prepare(
          `SELECT category_id, feed_id, origin, count(*) AS total, sum(starred) AS starred, sum(is_read = 0) AS unread
             FROM articles WHERE NOT ${hidden} GROUP BY category_id, feed_id, origin`,
        )
        .all();
    const before = time(() => grouped("(articles.filtered = 1 AND articles.starred = 0)"));
    const after = time(() => grouped(hiddenByFilters("articles")));
    // 1,000 hidden, 50 of them highlighted.
    expect(getCounts(db, NOW).unread).toBe(9_050);
    expect(after).toBeLessThan(Math.max(50, before * 10));
    console.info(`counts: ${before.toFixed(2)} ms with the star alone, ${after.toFixed(2)} ms with annotations`);
  });
});
