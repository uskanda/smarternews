import { describe, expect, it } from "vitest";
import type { ArticleSearchQuery } from "../api.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import {
  deleteUnstarredArticlesBefore,
  deleteUnstarredFeedArticlesBefore,
  insertArticle,
  reviseArticle,
  saveAutoSummary,
  searchArticles,
  setArticleFlags,
  type ArticleContent,
} from "./articles.ts";
import { addHighlight, deleteHighlight, saveArticleNote, updateHighlightNote } from "./annotations.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { deleteFeed } from "./feeds.ts";
import { createFilter } from "./filters.ts";
import { updateSettings } from "./settings.ts";
import { saveTranslatedTitle } from "./translations.ts";

const NOW = "2026-03-01T12:00:00.000Z";
const clock = fakeClock(NOW);
const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}T00:00:00.000Z`;

function category(db: Database, slug = "tools"): number {
  return createCategory(db, { slug, name: slug, kind: "news" }, clock).id;
}

function generated(db: Database, categoryId: number, overrides: Partial<ArticleContent> & { kind?: "news" | "event"; at?: string } = {}): number {
  const { at, kind, ...content } = overrides;
  return insertArticle(db, {
    categoryId,
    kind: kind ?? (content.event ? "event" : "news"),
    title: "Generated",
    summary: "s",
    body: "b",
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

function search(db: Database, q: string, query: Omit<ArticleSearchQuery, "q"> = {}): number[] {
  return searchArticles(db, { q, ...query }).items.map((item) => item.id);
}

/** What the search index holds for an article, or null when it has no row. */
function indexed(db: Database, id: number): string | null {
  const row = db.prepare("SELECT text FROM article_search WHERE rowid = ?").get(id);
  return row ? String(row.text) : null;
}

describe("which articles are searched", () => {
  it("finds generated and feed articles alike", () => {
    const db = createTestDb();
    const a = generated(db, category(db), { title: "半導体の新工場" });
    const b = seedFeedArticle(db, seedFeed(db), { title: "半導体の輸出", at: day(2) });
    expect(search(db, "半導体").sort()).toEqual([a, b].sort());
  });

  it("finds event articles, also those whose event has ended", () => {
    const db = createTestDb();
    const cat = category(db);
    const event = (title: string, ends: string) =>
      generated(db, cat, { title, event: { key: title, startsAt: ends, endsAt: ends, venue: null, fee: null, registration: "unknown" } });
    const coming = event("勉強会のお知らせ", "2026-04-01T00:00:00.000Z");
    const ended = event("展示会のお知らせ", "2026-02-01T00:00:00.000Z");
    expect(search(db, "勉強会")).toEqual([coming]);
    expect(search(db, "展示会")).toEqual([ended]);
  });
});

describe("which fields are matched", () => {
  it("matches the content of a feed article", () => {
    const db = createTestDb();
    const id = seedFeedArticle(db, seedFeed(db), { title: "News", body: "新しい量子の計算機" });
    expect(search(db, "量子")).toEqual([id]);
  });

  it("matches the translated title", () => {
    const db = createTestDb();
    const id = seedFeedArticle(db, seedFeed(db), { title: "Quarterly results", body: "Revenue rose." });
    saveTranslatedTitle(db, id, { original: "Quarterly results", title: "四半期の決算", sourceLanguage: "en" });
    expect(search(db, "決算")).toEqual([id]);
  });

  it("matches the impact on the reader and the venue of an event", () => {
    const db = createTestDb();
    const cat = category(db);
    const impact = generated(db, cat, { impact: "住宅の金利が上がる" });
    const venue = generated(db, cat, { event: { key: "e", startsAt: day(20), endsAt: day(20), venue: "市民公会堂", fee: null, registration: "unknown" } });
    expect(search(db, "金利")).toEqual([impact]);
    expect(search(db, "公会堂")).toEqual([venue]);
  });

  it("does not match where a link in the body leads", () => {
    const db = createTestDb();
    const cat = category(db);
    generated(db, cat, { body: "詳しくは[発表](https://example.org/notes)を見る。" });
    seedFeedArticle(db, seedFeed(db), { title: "News", body: "発表", url: "https://release.example.org/1" });
    expect(search(db, "example")).toEqual([]);
    expect(search(db, "release")).toEqual([]);
    expect(search(db, "発表")).toHaveLength(2);
  });
});

describe("terms", () => {
  it("returns only the articles that have every term, in any of their fields", () => {
    const db = createTestDb();
    const cat = category(db);
    const both = generated(db, cat, { title: "電池の話", body: "新しい工場" });
    generated(db, cat, { title: "電池だけ" });
    generated(db, cat, { title: "電池のみ" });
    expect(search(db, "電池 工場")).toEqual([both]);
    expect(search(db, "電池　工場")).toEqual([both]);
  });

  it("treats signs and operator words as characters", () => {
    const db = createTestDb();
    const cat = category(db);
    const plus = generated(db, cat, { title: "C++ の新しい版" });
    generated(db, cat, { title: "C の新しい版" });
    expect(search(db, "c++")).toEqual([plus]);
    const all = generated(db, cat, { title: "電池 or 工場" });
    generated(db, cat, { title: "電池と工場" });
    expect(search(db, "電池 OR 工場")).toEqual([all]);
    expect(search(db, '"quoted')).toEqual([]);
    expect(search(db, "100%")).toEqual([]);
  });

  it("does not tell full-width upper case from half-width lower case, nor half-width katakana from full-width", () => {
    const db = createTestDb();
    const cat = category(db);
    const ai = generated(db, cat, { title: "ＡＩの規制" });
    const server = seedFeedArticle(db, seedFeed(db), { title: "News", body: "新しいｻｰﾊﾞｰの話" });
    expect(search(db, "ai")).toEqual([ai]);
    expect(search(db, "サーバー")).toEqual([server]);
  });

  it("tells hiragana from katakana", () => {
    const db = createTestDb();
    generated(db, category(db), { title: "ニュースの話" });
    expect(search(db, "にゅーす")).toEqual([]);
  });

  it("matches terms of one and two characters as parts of the text", () => {
    const db = createTestDb();
    const cat = category(db);
    const stock = generated(db, cat, { title: "株価の動き" });
    const both = seedFeedArticle(db, seedFeed(db), { title: "News", body: "検索とデータベースの話" });
    expect(search(db, "株")).toEqual([stock]);
    expect(search(db, "検索 データベース")).toEqual([both]);
    expect(search(db, "検索")).toEqual([both]);
  });

  it("returns the normalized terms", () => {
    const db = createTestDb();
    expect(searchArticles(db, { q: "ＡＩ　半導体" }).terms).toEqual(["ai", "半導体"]);
  });

  it("refuses an empty query and one that is too long", () => {
    const db = createTestDb();
    expect(() => searchArticles(db, { q: "  " })).toThrow(/empty/);
    expect(() => searchArticles(db, { q: "a".repeat(201) })).toThrow(/too long/);
  });
});

describe("the results", () => {
  it("come newest first, however well they match", () => {
    const db = createTestDb();
    const old = seedFeedArticle(db, seedFeed(db), { title: "電池の話", at: day(1) });
    const recent = seedFeedArticle(db, seedFeed(db), { title: "News", body: "本文に電池", at: day(3) });
    expect(search(db, "電池")).toEqual([recent, old]);
  });

  it("include read articles", () => {
    const db = createTestDb();
    const read = seedFeedArticle(db, seedFeed(db), { title: "電池の話", isRead: true });
    expect(search(db, "電池")).toEqual([read]);
  });

  it("leave out what filters hide, unless it has a star", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    seedFeedArticle(db, feed, { title: "特売の案内", body: "電池が安い" });
    const starred = seedFeedArticle(db, feed, { title: "特売の電池", starred: true });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "特売" }] }, clock);
    expect(search(db, "電池")).toEqual([starred]);
  });

  it("leave out hidden duplicates, unless a feed is named", () => {
    const db = createTestDb();
    const kept = seedFeedArticle(db, seedFeed(db), { title: "電池の話", at: day(1) });
    const other = seedFeed(db);
    const duplicate = seedFeedArticle(db, other, { title: "電池の話", at: day(2), duplicateOf: kept });
    expect(search(db, "電池")).toEqual([kept]);
    expect(search(db, "電池", { feed: other })).toEqual([duplicate]);
    updateSettings(db, { removeDuplicates: false });
    expect(search(db, "電池")).toEqual([duplicate, kept]);
  });

  it("narrow to a category: its generated articles and the articles of its feeds", () => {
    const db = createTestDb();
    const a = category(db, "a");
    const b = category(db, "b");
    const inA = [generated(db, a, { title: "電池の話" }), seedFeedArticle(db, seedFeed(db, { categoryId: a }), { title: "電池の記事", at: day(2) })];
    generated(db, b, { title: "電池の話" });
    seedFeedArticle(db, seedFeed(db, { categoryId: b }), { title: "電池の記事" });
    expect(search(db, "電池", { category: a }).sort()).toEqual(inA.sort());
  });

  it("narrow to a feed", () => {
    const db = createTestDb();
    const f = seedFeed(db);
    const inF = seedFeedArticle(db, f, { title: "電池の記事" });
    seedFeedArticle(db, seedFeed(db), { title: "電池の記事" });
    expect(search(db, "電池", { feed: f })).toEqual([inF]);
  });

  it("narrow to unread articles", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const unread = seedFeedArticle(db, feed, { title: "電池 1" });
    seedFeedArticle(db, feed, { title: "電池 2", isRead: true });
    seedFeedArticle(db, feed, { title: "電池 3", isRead: true });
    expect(search(db, "電池", { unread: "true" })).toEqual([unread]);
  });

  it("come in pages, none twice", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    for (let i = 0; i < 120; i += 1) seedFeedArticle(db, feed, { title: `電池 ${i}`, at: `2026-03-01T00:${String(i % 60).padStart(2, "0")}:00.000Z` });
    const seen: number[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = searchArticles(db, { q: "電池", limit: 50, cursor });
      sizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
  });
});

describe("the excerpt of a result", () => {
  it("is the text around a match in the middle of the content", () => {
    const db = createTestDb();
    seedFeedArticle(db, seedFeed(db), { title: "News", body: `${"あ".repeat(2000)}電池${"い".repeat(100)}` });
    const [hit] = searchArticles(db, { q: "電池" }).items;
    expect(hit!.excerpt).toContain("電池");
    expect(hit!.excerpt!.startsWith("…")).toBe(true);
  });

  it("is null when only the title matches", () => {
    const db = createTestDb();
    generated(db, category(db), { title: "電池の話", summary: "別の話", body: "別の本文" });
    expect(searchArticles(db, { q: "電池" }).items[0]!.excerpt).toBeNull();
  });

  it("has no Markdown and no link targets", () => {
    const db = createTestDb();
    generated(db, category(db), { body: "**新しい**[電池](https://example.org/battery)の話" });
    expect(searchArticles(db, { q: "電池" }).items[0]!.excerpt).toBe("新しい電池の話");
  });
});

describe("the index follows the articles", () => {
  it("holds a generated article when it is stored and when a follow-up revises it", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "電池の工場" });
    expect(search(db, "電池")).toEqual([id]);
    reviseArticle(db, id, {
      title: "蓄電池の新工場",
      summary: "s",
      body: "b",
      impact: "電気代",
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: day(2),
      refs: [],
      topicIds: [],
    });
    expect(indexed(db, id)).toBe("蓄電池の新工場\ns\nb\n電気代");
    expect(search(db, "電気代")).toEqual([id]);
  });

  it("holds a feed article's automatic summary once it is saved", () => {
    const db = createTestDb();
    const id = seedFeedArticle(db, seedFeed(db), { title: "News", body: "Content" });
    expect(search(db, "電池")).toEqual([]);
    saveAutoSummary(db, id, { text: "新しい電池の話", source: "feed", now: NOW });
    expect(search(db, "電池")).toEqual([id]);
  });

  it("does not change when only flags change", () => {
    const db = createTestDb();
    const id = seedFeedArticle(db, seedFeed(db), { title: "電池" });
    const before = indexed(db, id);
    setArticleFlags(db, id, { isRead: true, starred: true }, NOW);
    expect(indexed(db, id)).toBe(before);
  });

  it("loses the row of a feed article when its feed is deleted, or its retention period passes", () => {
    const db = createTestDb();
    const gone = seedFeed(db);
    const a = seedFeedArticle(db, gone, { title: "電池" });
    const b = seedFeedArticle(db, seedFeed(db), { title: "電池", at: "2025-01-01T00:00:00.000Z" });
    deleteFeed(db, gone);
    expect(indexed(db, a)).toBeNull();
    deleteUnstarredFeedArticlesBefore(db, NOW);
    expect(indexed(db, b)).toBeNull();
    expect(search(db, "電池")).toEqual([]);
  });

  it("loses the row of a generated article after 180 days", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "電池", at: "2025-01-01T00:00:00.000Z" });
    deleteUnstarredArticlesBefore(db, NOW);
    expect(indexed(db, id)).toBeNull();
  });
});

const anchor = (quote: string, note: string | null = null) => ({ quote, prefix: "", suffix: "", position: 0, note });

describe("annotations in search", () => {
  it("matches a note on a highlight and a note on the whole article", () => {
    const db = createTestDb();
    const generatedId = generated(db, category(db), { title: "決算", body: "本文" });
    addHighlight(db, generatedId, anchor("本文", "前年と比較する"), NOW);
    const feedArticle = seedFeedArticle(db, seedFeed(db), { title: "News", body: "Content" });
    saveArticleNote(db, feedArticle, "来月もう一度読む", NOW);
    expect(search(db, "比較")).toEqual([generatedId]);
    expect(search(db, "来月")).toEqual([feedArticle]);
  });

  it("matches a highlighted text that left the body when the feed rewrote it", () => {
    const db = createTestDb();
    const id = seedFeedArticle(db, seedFeed(db), { title: "News", body: "新しい電池の工場を建てる。ほかの話。" });
    addHighlight(db, id, anchor("新しい電池の工場を建てる。"), NOW);
    db.prepare("UPDATE articles SET summary = 'ほかの話。', body = 'ほかの話。', content_text = 'ほかの話。' WHERE id = ?").run(id);
    expect(search(db, "電池")).toEqual([id]);
    const hit = searchArticles(db, { q: "電池" }).items[0]!;
    expect([hit.excerpt, hit.excerptFromNote]).toEqual([null, false]);
  });

  it("matches a term of the body with a term of a note", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "t", body: "電池の話" });
    generated(db, category(db, "other"), { title: "t", body: "電池だけの話" });
    addHighlight(db, id, anchor("電池", "工場を見に行く"), NOW);
    expect(search(db, "電池 工場")).toEqual([id]);
    expect(search(db, "電池 場")).toEqual([id]);
  });

  it("uses the annotations as they are now: written, rewritten, removed", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "t", body: "本文" });
    saveArticleNote(db, id, "比較", NOW);
    expect(search(db, "比較")).toEqual([id]);
    saveArticleNote(db, id, "確認", NOW);
    expect(search(db, "比較")).toEqual([]);
    const highlight = addHighlight(db, id, anchor("本文", "比較"), NOW);
    expect(search(db, "比較")).toEqual([id]);
    updateHighlightNote(db, highlight.id, "確認する", NOW);
    expect(search(db, "比較")).toEqual([]);
    updateHighlightNote(db, highlight.id, "試作", NOW);
    expect(search(db, "試作")).toEqual([id]);
    deleteHighlight(db, highlight.id);
    expect(search(db, "試作")).toEqual([]);
    expect(indexed(db, id)).toBe("t\ns\n本文\n確認");
  });

  it("keeps the annotations in the index through a follow-up, a rewrite and a summary", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "電池の工場" });
    addHighlight(db, id, anchor("電池の工場", "規模を確かめる"), NOW);
    reviseArticle(db, id, {
      title: "蓄電池の新工場",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: day(2),
      refs: [],
      topicIds: [],
    });
    expect(indexed(db, id)).toBe("蓄電池の新工場\ns\nb\n電池の工場\n規模を確かめる");
    const feedArticle = seedFeedArticle(db, seedFeed(db), { title: "News", body: "Content" });
    saveArticleNote(db, feedArticle, "来月", NOW);
    db.prepare("UPDATE articles SET summary = 'Rewritten', body = 'Rewritten', content_text = 'Rewritten' WHERE id = ?").run(feedArticle);
    saveAutoSummary(db, feedArticle, { text: "要約", source: "feed", now: NOW });
    expect(indexed(db, feedArticle)).toBe("news\nrewritten\n要約\nrewritten\n来月");
  });

  it("leaves an article with a highlight out when a hide filter matches it, unless it has one", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const plain = seedFeedArticle(db, feedId, { title: "特売 電池" });
    const highlighted = seedFeedArticle(db, feedId, { title: "特売 電池" });
    addHighlight(db, highlighted, anchor("電池"), NOW);
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "特売" }] }, clock);
    expect(search(db, "電池")).toEqual([highlighted]);
    expect(search(db, "電池")).not.toContain(plain);
  });
});

describe("annotations and the removal of articles", () => {
  it("loses the row of an annotated article when the article goes, the annotations' trigger not failing", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "電池" });
    addHighlight(db, id, anchor("電池", "メモ"), NOW);
    saveArticleNote(db, id, "メモ", NOW);
    db.prepare("DELETE FROM articles WHERE id = ?").run(id);
    expect(indexed(db, id)).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM annotations").get()).toEqual({ n: 0 });
  });

  it("loses the rows when the feed or the category goes with its articles", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const feedArticle = seedFeedArticle(db, feedId, { title: "電池" });
    saveArticleNote(db, feedArticle, "メモ", NOW);
    const categoryId = category(db);
    const generatedId = generated(db, categoryId, { title: "電池" });
    addHighlight(db, generatedId, anchor("電池", "メモ"), NOW);
    deleteFeed(db, feedId);
    deleteCategory(db, categoryId);
    expect([indexed(db, feedArticle), indexed(db, generatedId)]).toEqual([null, null]);
    expect(db.prepare("SELECT count(*) AS n FROM article_search").get()).toEqual({ n: 0 });
  });
});

describe("the excerpt from a note", () => {
  it("is taken from a note on a highlight when only the note matches, and says so", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "t", summary: "要約", body: "本文" });
    addHighlight(db, id, anchor("本文", "前年の数字と比較してから判断する"), NOW);
    const hit = searchArticles(db, { q: "比較" }).items[0]!;
    expect(hit.excerpt).toContain("比較");
    expect(hit.excerptFromNote).toBe(true);
  });

  it("is taken from the body when the body and a note both match", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "t", body: "新しい電池の話" });
    saveArticleNote(db, id, "電池を比べる", NOW);
    const hit = searchArticles(db, { q: "電池" }).items[0]!;
    expect([hit.excerpt, hit.excerptFromNote]).toEqual(["新しい電池の話", false]);
  });

  it("takes the note on the whole article before the notes on highlights", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "t", body: "本文" });
    addHighlight(db, id, anchor("本文", "ハイライトで比較"), NOW);
    saveArticleNote(db, id, "全体で比較", day(2));
    expect(searchArticles(db, { q: "比較" }).items[0]!.excerpt).toBe("全体で比較");
  });

  it("reads the notes of the whole page in one query, not one per article", () => {
    const db = createTestDb();
    const categoryId = category(db);
    for (let index = 0; index < 5; index += 1) {
      const id = generated(db, categoryId, { title: "t", body: "本文", at: day(index + 1) });
      saveArticleNote(db, id, `比較 ${index}`, NOW);
    }
    const prepared: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      prepared.push(sql);
      return prepare(sql);
    }) as typeof db.prepare;
    expect(searchArticles(db, { q: "比較" }).items.every((item) => item.excerptFromNote)).toBe(true);
    // The only query of the annotations by article id; the others are the filter condition inside the search.
    expect(prepared.filter((sql) => /FROM annotations\s+WHERE article_id IN/.test(sql))).toHaveLength(1);
  });
});

describe("the time a follow-up takes with many highlights", () => {
  it("revises an article with 100 highlights quickly", () => {
    const db = createTestDb();
    const id = generated(db, category(db), { title: "t", body: "本文".repeat(1000) });
    for (let index = 0; index < 100; index += 1) addHighlight(db, id, anchor(`本文${index}`, `メモ ${index} を書いた`), NOW);
    const started = performance.now();
    reviseArticle(db, id, {
      title: "続報",
      summary: "s",
      body: "本文".repeat(1200),
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: day(2),
      refs: [],
      topicIds: [],
    });
    const took = performance.now() - started;
    expect(indexed(db, id)).toContain("メモ 99 を書いた");
    expect(took).toBeLessThan(500);
    console.info(`reviseArticle with 100 highlights took ${took.toFixed(1)} ms`);
  });
});
