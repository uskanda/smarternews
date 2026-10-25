import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import type { ArticleListQuery } from "../api.ts";
import { DomainError } from "../errors.ts";
import {
  deleteUnstarredArticlesBefore,
  findEventByKey,
  getArticle,
  getCounts,
  insertArticle,
  listArticles,
  listFeedArticles,
  markArticlesRead,
  markArticlesUnread,
  markSeenArticlesRead,
  nextArticleToSummarize,
  recordArticleOpened,
  openEventArticles,
  recentNewsArticles,
  reviseArticle,
  requestAutoSummary,
  saveAutoSummary,
  setArticleFlags,
  type ArticleContent,
} from "./articles.ts";
import { createCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { updateFeed } from "./feeds.ts";
import { updateSettings } from "./settings.ts";

const NOW = "2026-03-01T12:00:00.000Z";

function generated(db: Database, categoryId: number, overrides: Partial<ArticleContent> = {}, now = NOW): number {
  return insertArticle(db, {
    categoryId,
    kind: overrides.event ? "event" : "news",
    title: "Generated",
    summary: "s",
    body: "b",
    impact: null,
    importance: 3,
    unconfirmed: false,
    snippetOnly: false,
    event: null,
    ...overrides,
    now,
    previousArticleId: null,
    refs: [],
    topicIds: [],
  });
}

describe("what only generated articles take part in", () => {
  it("leaves feed articles out of the follow-up lookup", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW));
    const article = generated(db, category.id);
    seedFeedArticle(db, seedFeed(db, { categoryId: category.id }), { at: NOW });

    expect(recentNewsArticles(db, category.id, "2026-02-01T00:00:00.000Z").map((entry) => entry.id)).toEqual([article]);
    expect(openEventArticles(db, category.id, NOW)).toEqual([]);
    expect(findEventByKey(db, category.id, "anything")).toBeNull();
  });

  it("leaves feed articles out of the RSS output, per category and overall", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW));
    const article = generated(db, category.id);
    seedFeedArticle(db, seedFeed(db, { categoryId: category.id }), { at: NOW });
    seedFeedArticle(db, seedFeed(db), { at: NOW });

    expect(listFeedArticles(db, { categoryId: category.id, now: NOW, limit: 50 }).map((entry) => entry.id)).toEqual([article]);
    expect(listFeedArticles(db, { categoryId: null, now: NOW, limit: 50 }).map((entry) => entry.id)).toEqual([article]);
  });

  it("purges only generated articles by the 180-day rule", () => {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW));
    generated(db, category.id, {}, "2025-01-01T00:00:00.000Z");
    const feedArticle = seedFeedArticle(db, seedFeed(db, { categoryId: category.id }), { at: "2025-01-01T00:00:00.000Z" });

    expect(deleteUnstarredArticlesBefore(db, "2026-01-01T00:00:00.000Z")).toBe(1);
    expect(db.prepare("SELECT id FROM articles").all()).toEqual([{ id: feedArticle }]);
  });
});

describe("duplicates across feeds", () => {
  /**
   * Feed A (category X) keeps an article; feed B (category Y) and feed C (no category) delivered the same one,
   * recorded as its duplicates. B also has two articles of its own.
   */
  function withDuplicates() {
    const db = createTestDb();
    const clock = fakeClock(NOW);
    const x = createCategory(db, { name: "X", kind: "news" }, clock).id;
    const y = createCategory(db, { name: "Y", kind: "news" }, clock).id;
    const a = seedFeed(db, { categoryId: x, title: "Feed A" });
    const b = seedFeed(db, { categoryId: y, title: "Feed B" });
    const c = seedFeed(db, { title: "Feed C" });
    const kept = seedFeedArticle(db, a, { title: "Kept", at: "2026-03-01T01:00:00.000Z" });
    const copyB = seedFeedArticle(db, b, { title: "Copy in B", at: "2026-03-01T02:00:00.000Z", duplicateOf: kept });
    const copyC = seedFeedArticle(db, c, { title: "Copy in C", at: "2026-03-01T03:00:00.000Z", duplicateOf: kept });
    const ownB = [seedFeedArticle(db, b, { title: "B one" }), seedFeedArticle(db, b, { title: "B two" })];
    const titles = (query: ArticleListQuery = {}) => listArticles(db, query, NOW).items.map((article) => article.title);
    const isRead = (id: number) => getArticle(db, id).isRead;
    return { db, clock, x, y, a, b, c, kept, copyB, copyC, ownB, titles, isRead };
  }

  describe("in lists", () => {
    it("leaves duplicates out of the lists over everything, a category and no category", () => {
      const s = withDuplicates();
      expect(s.titles({ unread: "true" })).not.toContain("Copy in B");
      expect(s.titles()).toEqual(expect.arrayContaining(["Kept"]));
      expect(s.titles()).not.toEqual(expect.arrayContaining(["Copy in B"]));
      expect(s.titles({ category: s.y })).toEqual(["B one", "B two"].reverse());
      expect(s.titles({ uncategorized: "true" })).toEqual([]);
      expect(s.titles({ origin: "feed" })).not.toContain("Copy in C");
    });

    it("lists duplicates in the list of their own feed, and among the starred ones", () => {
      const s = withDuplicates();
      expect(s.titles({ feed: s.b, unread: "true" })).toHaveLength(3);
      expect(s.titles({ feed: s.b })).toContain("Copy in B");
      setArticleFlags(s.db, s.copyC, { starred: true }, NOW);
      expect(s.titles({ starred: "true" })).toEqual(["Copy in C"]);
    });

    it("lists recorded duplicates while removal is off, and hides them again once it is on", () => {
      const s = withDuplicates();
      updateSettings(s.db, { removeDuplicates: false });
      expect(s.titles({ unread: "true" })).toEqual(expect.arrayContaining(["Kept", "Copy in B", "Copy in C"]));
      updateSettings(s.db, { removeDuplicates: true });
      expect(s.titles({ unread: "true" })).not.toEqual(expect.arrayContaining(["Copy in B"]));
      expect(s.titles({ unread: "true" })).not.toEqual(expect.arrayContaining(["Copy in C"]));
    });
  });

  describe("in counts", () => {
    it("leaves duplicates out of the totals, the categories and no category, and counts them for their feed", () => {
      const s = withDuplicates();
      const counts = getCounts(s.db, NOW);
      expect(counts.unread).toBe(3);
      expect(counts.categories.find((category) => category.categoryId === s.y)).toMatchObject({ unread: 2, total: 2 });
      expect(counts.categories.find((category) => category.categoryId === s.x)).toMatchObject({ unread: 1, total: 1 });
      expect(counts.uncategorizedUnread).toBe(0);
      expect(counts.feeds.find((feed) => feed.feedId === s.b)).toEqual({ feedId: s.b, unread: 3 });
      expect(counts.feeds.find((feed) => feed.feedId === s.c)).toEqual({ feedId: s.c, unread: 1 });
    });

    it("counts duplicates everywhere while removal is off", () => {
      const s = withDuplicates();
      updateSettings(s.db, { removeDuplicates: false });
      const counts = getCounts(s.db, NOW);
      expect(counts.unread).toBe(5);
      expect(counts.categories.find((category) => category.categoryId === s.y)).toMatchObject({ unread: 3, total: 3 });
      expect(counts.uncategorizedUnread).toBe(1);
    });

    it("counts a starred duplicate among the starred", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.copyB, { starred: true }, NOW);
      expect(getCounts(s.db, NOW).starred).toBe(1);
    });
  });

  describe("when the kept article is read", () => {
    it("marks its unread duplicates read, and the feed of a duplicate has one fewer unread", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.kept, { isRead: true }, NOW);
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([true, true]);
      expect(getCounts(s.db, NOW).feeds.find((feed) => feed.feedId === s.b)!.unread).toBe(2);
    });

    it("marks them read with a list of another category, and returns their ids", () => {
      const s = withDuplicates();
      const ids = markArticlesRead(s.db, { categoryId: s.x, before: "2026-03-02T00:00:00.000Z" }, NOW);
      expect(ids).toEqual([s.kept, s.copyB, s.copyC].sort((left, right) => left - right));
      expect(markArticlesUnread(s.db, ids)).toBe(3);
      expect([s.isRead(s.kept), s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([false, false, false]);
    });

    it("leaves a duplicate that a filter hides unread", () => {
      const s = withDuplicates();
      s.db.prepare("UPDATE articles SET filtered = 1 WHERE id = ?").run(s.copyB);
      setArticleFlags(s.db, s.kept, { isRead: true }, NOW);
      expect(markArticlesRead(s.db, { before: "2026-03-02T00:00:00.000Z" }, NOW)).not.toContain(s.copyB);
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([false, true]);
    });

    it("leaves the duplicates read when the kept article is put back to unread", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.kept, { isRead: true }, NOW);
      setArticleFlags(s.db, s.kept, { isRead: false }, NOW);
      expect([s.isRead(s.kept), s.isRead(s.copyB)]).toEqual([false, true]);
    });

    it("leaves the duplicates alone while removal is off", () => {
      const s = withDuplicates();
      updateSettings(s.db, { removeDuplicates: false });
      setArticleFlags(s.db, s.kept, { isRead: true }, NOW);
      expect(markArticlesRead(s.db, { categoryId: s.x, before: "2026-03-02T00:00:00.000Z" }, NOW)).toEqual([]);
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([false, false]);
    });

    it("leaves the kept article alone when a duplicate is read", () => {
      const s = withDuplicates();
      setArticleFlags(s.db, s.copyB, { isRead: true }, NOW);
      markArticlesRead(s.db, { feedId: s.c, before: "2026-03-02T00:00:00.000Z" }, NOW);
      expect(s.isRead(s.kept)).toBe(false);
    });
  });

  describe("when the kept article is read with the version a screen showed", () => {
    it("marks its unread duplicates read and returns them too", () => {
      const s = withDuplicates();
      const ids = markSeenArticlesRead(s.db, [{ id: s.kept, updatedAt: getArticle(s.db, s.kept).updatedAt }], NOW);
      expect(ids).toEqual([s.kept, s.copyB, s.copyC].sort((left, right) => left - right));
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([true, true]);
    });

    it("leaves the duplicates alone while removal is off", () => {
      const s = withDuplicates();
      updateSettings(s.db, { removeDuplicates: false });
      expect(markSeenArticlesRead(s.db, [{ id: s.kept, updatedAt: getArticle(s.db, s.kept).updatedAt }], NOW)).toEqual([s.kept]);
      expect([s.isRead(s.copyB), s.isRead(s.copyC)]).toEqual([false, false]);
    });
  });

  describe("summaries", () => {
    function summarizing() {
      const s = withDuplicates();
      for (const feed of [s.a, s.b]) updateFeed(s.db, feed, { autoSummarize: true }, s.clock);
      s.clock.advance(60_000);
      const stored = s.clock().toISOString();
      s.db.prepare("UPDATE articles SET created_at = ?").run(stored);
      // The kept article has its summary already.
      saveAutoSummary(s.db, s.kept, { text: "summary", source: "feed", now: stored });
      for (const id of s.ownB) saveAutoSummary(s.db, id, { text: "summary", source: "feed", now: stored });
      return s;
    }

    it("does not wait for the summary of a duplicate of a feed that summarises", () => {
      const s = summarizing();
      expect(nextArticleToSummarize(s.db)).toBeNull();
      expect(getArticle(s.db, s.copyB).autoSummaryPending).toBe(false);
    });

    it("summarises a duplicate that a reader opened and asked for", () => {
      const s = summarizing();
      expect(requestAutoSummary(s.db, s.copyB, s.clock().toISOString())).toBe(true);
      expect(nextArticleToSummarize(s.db)?.id).toBe(s.copyB);
    });

    it("waits for the summary of a duplicate again while removal is off", () => {
      const s = summarizing();
      updateSettings(s.db, { removeDuplicates: false });
      expect(nextArticleToSummarize(s.db)?.id).toBe(s.copyB);
    });
  });

  describe("the feeds that also delivered an article", () => {
    it("lists the duplicates of a kept article with their feed, in the order they were stored", () => {
      const s = withDuplicates();
      s.db.prepare("UPDATE articles SET created_at = ? WHERE id = ?").run("2026-03-01T05:00:00.000Z", s.copyB);
      s.db.prepare("UPDATE articles SET created_at = ? WHERE id = ?").run("2026-03-01T04:00:00.000Z", s.copyC);
      expect(getArticle(s.db, s.kept).otherFeeds).toEqual([
        { articleId: s.copyC, feedId: s.c, feedTitle: "Feed C" },
        { articleId: s.copyB, feedId: s.b, feedTitle: "Feed B" },
      ]);
    });

    it("is empty for an article without duplicates, and for a duplicate", () => {
      const s = withDuplicates();
      expect(getArticle(s.db, s.ownB[0]!).otherFeeds).toEqual([]);
      expect(getArticle(s.db, s.copyB).otherFeeds).toEqual([]);
    });
  });
});

describe("read times", () => {
  const TEN = "2026-03-01T10:00:00.000Z";
  const ELEVEN = "2026-03-01T11:00:00.000Z";
  const NOON = "2026-03-01T12:00:00.000Z";

  function reading() {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW)).id;
    const readAt = (id: number) => db.prepare("SELECT read_at FROM articles WHERE id = ?").get(id)!.read_at;
    return { db, category, readAt, article: () => generated(db, category, {}, "2026-03-01T00:00:00.000Z") };
  }

  it("records when an unread article is read", () => {
    const s = reading();
    const id = s.article();
    expect(s.readAt(id)).toBeNull();
    setArticleFlags(s.db, id, { isRead: true }, TEN);
    expect(s.readAt(id)).toBe(TEN);
  });

  it("keeps the time when an article that is read already is read again", () => {
    const s = reading();
    const id = s.article();
    setArticleFlags(s.db, id, { isRead: true }, TEN);
    setArticleFlags(s.db, id, { isRead: true }, ELEVEN);
    setArticleFlags(s.db, id, { starred: true }, ELEVEN);
    expect(s.readAt(id)).toBe(TEN);
  });

  it("clears the time when the article is put back to unread, and takes the new one when it is read again", () => {
    const s = reading();
    const id = s.article();
    setArticleFlags(s.db, id, { isRead: true }, TEN);
    setArticleFlags(s.db, id, { isRead: false }, ELEVEN);
    expect(s.readAt(id)).toBeNull();
    setArticleFlags(s.db, id, { isRead: true }, NOON);
    expect(s.readAt(id)).toBe(NOON);
  });

  it("gives every article that mark all as read changes the same time, and leaves those read before alone", () => {
    const s = reading();
    const before = s.article();
    setArticleFlags(s.db, before, { isRead: true }, TEN);
    const ids = [s.article(), s.article(), s.article()];
    markArticlesRead(s.db, { before: "2026-03-02T00:00:00.000Z" }, ELEVEN);
    expect(ids.map(s.readAt)).toEqual([ELEVEN, ELEVEN, ELEVEN]);
    expect(s.readAt(before)).toBe(TEN);
  });

  it("clears the times of the articles that undoing mark all as read puts back", () => {
    const s = reading();
    s.article();
    s.article();
    const ids = markArticlesRead(s.db, { before: "2026-03-02T00:00:00.000Z" }, ELEVEN);
    markArticlesUnread(s.db, ids);
    expect(ids.map(s.readAt)).toEqual([null, null]);
  });

  it("clears the time when a follow-up puts the article back to unread", () => {
    const s = reading();
    const id = s.article();
    setArticleFlags(s.db, id, { isRead: true }, TEN);
    reviseArticle(s.db, id, {
      title: "Revised",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: ELEVEN,
      refs: [],
      topicIds: [],
    });
    expect(s.readAt(id)).toBeNull();
  });

  it("marks read what a screen showed, at one time, unless a follow-up came after the version shown", () => {
    const s = reading();
    const [first, second, revised] = [s.article(), s.article(), s.article()];
    const shown = (id: number) => ({ id, updatedAt: getArticle(s.db, id).updatedAt });
    const seen = [shown(first), shown(second), shown(revised)];
    reviseArticle(s.db, revised, {
      title: "Revised",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: TEN,
      refs: [],
      topicIds: [],
    });
    expect(markSeenArticlesRead(s.db, seen, ELEVEN)).toEqual([first, second]);
    expect([s.readAt(first), s.readAt(second), s.readAt(revised)]).toEqual([ELEVEN, ELEVEN, null]);
    expect(getArticle(s.db, revised).isRead).toBe(false);
  });

  it("takes the version shown in any offset, as the same instant", () => {
    const s = reading();
    const id = s.article();
    expect(markSeenArticlesRead(s.db, [{ id, updatedAt: "2026-03-01T09:00:00+09:00" }], ELEVEN)).toEqual([id]);
  });

  it("leaves an article read already, with its time, out of what it returns, and skips one that is gone", () => {
    const s = reading();
    const [before, unread] = [s.article(), s.article()];
    setArticleFlags(s.db, before, { isRead: true }, TEN);
    const seen = [before, unread, 9999].map((id) => ({ id, updatedAt: "2026-03-01T00:00:00.000Z" }));
    expect(markSeenArticlesRead(s.db, seen, ELEVEN)).toEqual([unread]);
    expect([s.readAt(before), s.readAt(unread)]).toEqual([TEN, ELEVEN]);
  });

  it("gives the duplicates read with a kept article the same time", () => {
    const s = reading();
    const a = seedFeed(s.db, { title: "Feed A" });
    const b = seedFeed(s.db, { title: "Feed B" });
    const kept = seedFeedArticle(s.db, a, { title: "Kept" });
    const copy = seedFeedArticle(s.db, b, { title: "Copy", duplicateOf: kept });
    setArticleFlags(s.db, kept, { isRead: true }, TEN);
    expect(s.readAt(copy)).toBe(TEN);
    setArticleFlags(s.db, kept, { isRead: false }, ELEVEN);
    const other = seedFeedArticle(s.db, a, { title: "Other kept" });
    const otherCopy = seedFeedArticle(s.db, b, { title: "Other copy", duplicateOf: other });
    markArticlesRead(s.db, { feedId: a, before: "2026-03-02T00:00:00.000Z" }, NOON);
    expect([s.readAt(kept), s.readAt(copy), s.readAt(other), s.readAt(otherCopy)]).toEqual([NOON, TEN, NOON, NOON]);
  });
});

describe("the list of recently read articles", () => {
  const HOUR = 3_600_000;
  const ago = (ms: number) => new Date(new Date(NOW).getTime() - ms).toISOString();

  function reading() {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW)).id;
    const article = (title: string, overrides: Partial<ArticleContent> = {}) =>
      generated(db, category, { title, ...overrides }, "2026-02-01T00:00:00.000Z");
    const read = (id: number, at: string) => setArticleFlags(db, id, { isRead: true }, at);
    const titles = (query: ArticleListQuery = { recentlyRead: "true" }) => listArticles(db, query, NOW).items.map((item) => item.title);
    return { db, category, article, read, titles };
  }

  it("lists the articles read in the last seven days, last read first", () => {
    const s = reading();
    s.read(s.article("A"), ago(HOUR));
    s.read(s.article("B"), ago(48 * HOUR));
    s.read(s.article("C"), ago(HOUR / 2));
    s.read(s.article("Old"), ago(8 * 24 * HOUR));
    s.article("Unread");
    expect(s.titles()).toEqual(["C", "A", "B"]);
  });

  it("leaves out what was read before read times were kept, and what was put back to unread", () => {
    const s = reading();
    s.db.prepare("UPDATE articles SET is_read = 1 WHERE id = ?").run(s.article("Read long ago"));
    const back = s.article("Back to unread");
    s.read(back, ago(HOUR));
    setArticleFlags(s.db, back, { isRead: false }, NOW);
    s.read(s.article("Read"), ago(HOUR));
    expect(s.titles()).toEqual(["Read"]);
  });

  it("includes feed articles and events that have ended, and leaves out what filters hide and hidden duplicates", () => {
    const s = reading();
    const feed = seedFeed(s.db, { categoryId: s.category });
    const other = seedFeed(s.db);
    const kept = seedFeedArticle(s.db, feed, { title: "Feed article" });
    seedFeedArticle(s.db, other, { title: "Duplicate", duplicateOf: kept });
    const hidden = seedFeedArticle(s.db, feed, { title: "Hidden" });
    s.read(hidden, ago(3 * HOUR));
    s.db.prepare("UPDATE articles SET filtered = 1 WHERE id = ?").run(hidden);
    s.read(kept, ago(2 * HOUR));
    s.read(
      s.article("Ended event", { event: { key: "e", startsAt: "2026-02-01T00:00:00.000Z", endsAt: "2026-02-02T00:00:00.000Z", venue: null, fee: null, registration: "unknown" } }),
      ago(HOUR),
    );
    expect(s.titles()).toEqual(["Ended event", "Feed article"]);
  });

  it("pages by read time without repeating or skipping articles read at the same time", () => {
    const s = reading();
    for (let index = 0; index < 120; index += 1) s.read(s.article(`#${index}`), ago(index < 60 ? HOUR : (index + 1) * 60_000));
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const page = listArticles(s.db, { recentlyRead: "true", limit: 50, ...(cursor ? { cursor } : {}) }, NOW);
      sizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    const times = listArticles(s.db, { recentlyRead: "true", limit: 200 }, NOW).items.map((item) => item.readAt!);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("gives each article its read time, and none to unread articles", () => {
    const s = reading();
    const read = s.article("Read");
    s.read(read, ago(HOUR));
    const unread = s.article("Unread");
    const items = listArticles(s.db, {}, NOW).items;
    expect(items.find((item) => item.id === read)!.readAt).toBe(ago(HOUR));
    expect(items.find((item) => item.id === unread)!.readAt).toBeNull();
    expect(getArticle(s.db, read).readAt).toBe(ago(HOUR));
  });

  it("refuses to be combined with another narrowing of the list", () => {
    const s = reading();
    for (const query of [
      { category: s.category },
      { uncategorized: "true" },
      { origin: "feed" },
      { feed: 1 },
      { unread: "false" },
      { starred: "true" },
      { kind: "news" },
      { minImportance: 4 },
    ] as ArticleListQuery[]) {
      expect(() => listArticles(s.db, { recentlyRead: "true", ...query }, NOW)).toThrow(DomainError);
    }
    expect(() => listArticles(s.db, { recentlyRead: "true", includeEnded: "false", limit: 10 }, NOW)).not.toThrow();
  });
});

describe("the list oldest first", () => {
  const HOUR = 3_600_000;
  const ago = (ms: number) => new Date(new Date(NOW).getTime() - ms).toISOString();

  function listing() {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW)).id;
    const article = (title: string, at: string) => generated(db, category, { title }, at);
    const titles = (query: ArticleListQuery) => listArticles(db, query, NOW).items.map((item) => item.title);
    return { db, category, article, titles };
  }

  it("orders by the time lists sort by, oldest first, and leaves the newest first list as it was", () => {
    const s = listing();
    s.article("A", ago(HOUR));
    s.article("B", ago(48 * HOUR));
    s.article("C", ago(HOUR / 2));
    expect(s.titles({ order: "oldest" })).toEqual(["B", "A", "C"]);
    expect(s.titles({})).toEqual(["C", "A", "B"]);
    expect(s.titles({ order: "newest" })).toEqual(["C", "A", "B"]);
  });

  it("orders a feed article by its sort time among the generated ones, narrowed as the newest first list is", () => {
    const s = listing();
    s.article("Generated", ago(3 * HOUR));
    const feed = seedFeed(s.db, { categoryId: s.category });
    seedFeedArticle(s.db, feed, { title: "Feed", at: ago(5 * HOUR) });
    seedFeedArticle(s.db, feed, { title: "Read feed", at: ago(4 * HOUR), isRead: true });
    expect(s.titles({ category: s.category, order: "oldest" })).toEqual(["Feed", "Read feed", "Generated"]);
    expect(s.titles({ category: s.category, unread: "true", order: "oldest" })).toEqual(["Feed", "Generated"]);
  });

  it("moves a generated article that a follow-up updates to the end", () => {
    const s = listing();
    const old = s.article("Two days old", ago(48 * HOUR));
    s.article("An hour old", ago(HOUR));
    reviseArticle(s.db, old, {
      title: "Two days old, followed up",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: NOW,
      refs: [],
      topicIds: [],
    });
    expect(s.titles({ order: "oldest" })).toEqual(["An hour old", "Two days old, followed up"]);
  });

  it("pages oldest first without repeating or skipping articles of the same time", () => {
    const s = listing();
    for (let index = 0; index < 120; index += 1) s.article(`#${index}`, ago(index < 60 ? 200 * 60_000 : (120 - index) * 60_000));
    const seen: string[] = [];
    const sizes: number[] = [];
    const times: string[] = [];
    let cursor: string | undefined;
    let last: ReturnType<typeof listArticles> | undefined;
    do {
      last = listArticles(s.db, { order: "oldest", limit: 50, ...(cursor ? { cursor } : {}) }, NOW);
      sizes.push(last.items.length);
      seen.push(...last.items.map((item) => item.title));
      times.push(...last.items.map((item) => item.updatedAt));
      cursor = last.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(times).toEqual([...times].sort());
    expect(last.nextCursor).toBeNull();
  });

  it("reads a cursor without a direction as newest first, and refuses a cursor of the other direction", () => {
    const s = listing();
    for (let index = 0; index < 5; index += 1) s.article(`#${index}`, ago((index + 1) * HOUR));
    const newest = listArticles(s.db, { limit: 2 }, NOW);
    const oldest = listArticles(s.db, { order: "oldest", limit: 2 }, NOW);
    // A cursor this server issued before lists had an order: the time and the id, nothing else.
    const legacy = Buffer.from(JSON.stringify([newest.items[1]!.updatedAt, newest.items[1]!.id])).toString("base64url");

    expect(listArticles(s.db, { limit: 2, cursor: legacy }, NOW).items.map((item) => item.title)).toEqual(["#2", "#3"]);
    expect(listArticles(s.db, { limit: 2, cursor: newest.nextCursor! }, NOW).items.map((item) => item.title)).toEqual(["#2", "#3"]);
    expect(listArticles(s.db, { order: "oldest", limit: 2, cursor: oldest.nextCursor! }, NOW).items.map((item) => item.title)).toEqual(["#2", "#1"]);

    for (const query of [
      { order: "oldest", cursor: newest.nextCursor! },
      { order: "oldest", cursor: legacy },
      { cursor: oldest.nextCursor! },
      { order: "newest", cursor: oldest.nextCursor! },
    ] as ArticleListQuery[]) {
      expect(() => listArticles(s.db, query, NOW)).toThrow(expect.objectContaining({ code: "invalid" }));
    }
  });

  it("refuses an order for the list of events and the recently read articles, even newest first", () => {
    const s = listing();
    for (const query of [
      { kind: "event", order: "oldest" },
      { kind: "event", order: "newest" },
      { recentlyRead: "true", order: "oldest" },
      { recentlyRead: "true", order: "newest" },
    ] as ArticleListQuery[]) {
      expect(() => listArticles(s.db, query, NOW)).toThrow(expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "order" })] }));
    }
  });

  it("says when the list was read, whatever the order and the page", () => {
    const s = listing();
    for (let index = 0; index < 3; index += 1) s.article(`#${index}`, ago((index + 1) * HOUR));
    expect(listArticles(s.db, { order: "oldest", limit: 1 }, NOW).asOf).toBe(NOW);
    expect(listArticles(s.db, {}, NOW).asOf).toBe(NOW);
    expect(listArticles(s.db, { kind: "event" }, NOW).asOf).toBe(NOW);
    expect(listArticles(s.db, { recentlyRead: "true" }, NOW).asOf).toBe(NOW);
  });
});

describe("open times", () => {
  const TEN = "2026-03-01T10:00:00.000Z";
  const ELEVEN = "2026-03-01T11:00:00.000Z";
  const NOON = "2026-03-01T12:00:00.000Z";

  function opening() {
    const db = createTestDb();
    const category = createCategory(db, { name: "Tools", kind: "news" }, fakeClock(NOW)).id;
    const feed = seedFeed(db, { categoryId: category });
    const openedAt = (id: number) => getArticle(db, id).openedAt;
    return { db, category, feed, openedAt, generated: () => generated(db, category, {}, "2026-03-01T00:00:00.000Z") };
  }

  it("records when a feed article and a generated one are first opened, and keeps that time", () => {
    const s = opening();
    const feedArticle = seedFeedArticle(s.db, s.feed);
    const generatedArticle = s.generated();
    expect(s.openedAt(feedArticle)).toBeNull();

    expect(recordArticleOpened(s.db, feedArticle, TEN)).toBe(TEN);
    expect(recordArticleOpened(s.db, generatedArticle, TEN)).toBe(TEN);
    expect(recordArticleOpened(s.db, feedArticle, ELEVEN)).toBe(TEN);
    expect(s.openedAt(feedArticle)).toBe(TEN);
    expect(s.openedAt(generatedArticle)).toBe(TEN);
  });

  it("leaves read and unread as they are, and records an article that is read already", () => {
    const s = opening();
    const unread = seedFeedArticle(s.db, s.feed);
    const read = seedFeedArticle(s.db, s.feed, { isRead: true });
    recordArticleOpened(s.db, unread, TEN);
    recordArticleOpened(s.db, read, TEN);
    expect(getArticle(s.db, unread)).toMatchObject({ isRead: false, readAt: null, openedAt: TEN });
    expect(getArticle(s.db, read)).toMatchObject({ isRead: true, openedAt: TEN });
    expect(getCounts(s.db, NOON).unread).toBe(1);
  });

  it("refuses an article that does not exist", () => {
    const s = opening();
    expect(() => recordArticleOpened(s.db, 999, TEN)).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("is set by none of the ways of marking read: one article, mark all as read, what a screen showed, duplicates", () => {
    const s = opening();
    const one = seedFeedArticle(s.db, s.feed);
    setArticleFlags(s.db, one, { isRead: true }, TEN);
    const all = [seedFeedArticle(s.db, s.feed), seedFeedArticle(s.db, s.feed), seedFeedArticle(s.db, s.feed)];
    markArticlesRead(s.db, { before: "2026-03-02T00:00:00.000Z" }, ELEVEN);
    const shown = seedFeedArticle(s.db, s.feed);
    markSeenArticlesRead(s.db, [{ id: shown, updatedAt: getArticle(s.db, shown).updatedAt }], NOON);
    const other = seedFeed(s.db);
    const kept = seedFeedArticle(s.db, s.feed);
    const copy = seedFeedArticle(s.db, other, { duplicateOf: kept });
    recordArticleOpened(s.db, kept, NOON);
    setArticleFlags(s.db, kept, { isRead: true }, NOON);

    expect(getArticle(s.db, copy)).toMatchObject({ isRead: true, openedAt: null });
    expect([one, ...all, shown].map(s.openedAt)).toEqual([null, null, null, null, null]);
  });

  it("is kept when the article is put back to unread, alone or by undoing mark all as read, and by a follow-up", () => {
    const s = opening();
    const one = seedFeedArticle(s.db, s.feed);
    recordArticleOpened(s.db, one, TEN);
    setArticleFlags(s.db, one, { isRead: true }, TEN);
    setArticleFlags(s.db, one, { isRead: false }, NOON);
    expect(getArticle(s.db, one)).toMatchObject({ isRead: false, readAt: null, openedAt: TEN });

    const undone = seedFeedArticle(s.db, s.feed);
    recordArticleOpened(s.db, undone, TEN);
    markArticlesUnread(s.db, markArticlesRead(s.db, { before: "2026-03-02T00:00:00.000Z" }, ELEVEN));
    expect(s.openedAt(undone)).toBe(TEN);

    const revised = s.generated();
    recordArticleOpened(s.db, revised, TEN);
    setArticleFlags(s.db, revised, { isRead: true }, TEN);
    reviseArticle(s.db, revised, {
      title: "Revised",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: ELEVEN,
      refs: [],
      topicIds: [],
    });
    expect(getArticle(s.db, revised)).toMatchObject({ isRead: false, openedAt: TEN });
  });

  it("is given in the list: the opened article has it, one marked read in bulk has none", () => {
    const s = opening();
    const opened = seedFeedArticle(s.db, s.feed, { title: "Opened" });
    const bulk = seedFeedArticle(s.db, s.feed, { title: "Bulk" });
    recordArticleOpened(s.db, opened, TEN);
    markArticlesRead(s.db, { before: "2026-03-02T00:00:00.000Z" }, ELEVEN);
    const items = listArticles(s.db, { unread: "false" }, NOON).items;
    expect(items.find((item) => item.id === opened)!.openedAt).toBe(TEN);
    expect(items.find((item) => item.id === bulk)!.openedAt).toBeNull();
  });
});
