import { describe, expect, it } from "vitest";
import type { Mention } from "../mentions.ts";
import { purgeExpired } from "../runs/retention.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { addHighlight } from "./annotations.ts";
import { getArticle, insertArticle, listArticles, setArticleFlags, type ArticleContent } from "./articles.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { deleteFeed } from "./feeds.ts";
import { createFilter } from "./filters.ts";
import { listMentionArticles, mentionsOf, replaceMentions } from "./mentions.ts";
import { updateSettings } from "./settings.ts";

const NOW = "2026-03-01T12:00:00.000Z";
const clock = fakeClock(NOW);
const at = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
const DAY = 24 * 60;

const BOJ: Mention = { name: "日本銀行", kind: "organization" };
const UEDA: Mention = { name: "植田和男", kind: "person" };

function category(db: Database, kind: "news" | "event" = "news"): number {
  return createCategory(db, { slug: `c${Math.random().toString(36).slice(2, 8)}`, name: "c", kind }, clock).id;
}

function generated(db: Database, overrides: Partial<ArticleContent> & { at?: string; categoryId?: number } = {}): number {
  const { at: when, categoryId, ...content } = overrides;
  return insertArticle(db, {
    categoryId: categoryId ?? category(db),
    kind: content.event ? "event" : "news",
    title: "Generated",
    summary: "s",
    body: "b",
    impact: null,
    importance: 3,
    unconfirmed: false,
    snippetOnly: false,
    event: null,
    ...content,
    now: when ?? NOW,
    previousArticleId: null,
    refs: [],
    topicIds: [],
  });
}

const ids = (db: Database, name: string) => listMentionArticles(db, { name }, NOW).items.map((item) => item.id);

describe("saving mentions", () => {
  it("keeps the names of an article in the order given, and replaces them", () => {
    const db = createTestDb();
    const id = generated(db);
    expect(mentionsOf(db, id)).toEqual([]);

    replaceMentions(db, id, [BOJ, UEDA, { name: "東京", kind: "place" }]);
    expect(mentionsOf(db, id)).toEqual([BOJ, UEDA, { name: "東京", kind: "place" }]);

    replaceMentions(db, id, [UEDA, { name: "財務省", kind: "organization" }]);
    expect(mentionsOf(db, id)).toEqual([UEDA, { name: "財務省", kind: "organization" }]);
    expect(ids(db, "日本銀行")).toEqual([]);

    replaceMentions(db, id, []);
    expect(mentionsOf(db, id)).toEqual([]);
  });

  it("lets the names go with their article, its feed and its category", () => {
    const db = createTestDb();
    const categoryId = category(db);
    const feedId = seedFeed(db, { categoryId });
    const feedArticle = seedFeedArticle(db, feedId);
    const otherFeed = seedFeed(db);
    const otherArticle = seedFeedArticle(db, otherFeed);
    const article = generated(db, { categoryId });
    for (const id of [feedArticle, otherArticle, article]) replaceMentions(db, id, [BOJ]);
    const count = () => Number(db.prepare("SELECT count(*) AS n FROM article_mentions").get()!.n);
    expect(count()).toBe(3);

    deleteFeed(db, otherFeed);
    expect(count()).toBe(2);
    deleteCategory(db, categoryId);
    // The feed's articles stay without a category; the generated article goes with its category.
    expect(mentionsOf(db, feedArticle)).toEqual([BOJ]);
    expect(count()).toBe(1);
    db.prepare("DELETE FROM articles WHERE id = ?").run(feedArticle);
    expect(count()).toBe(0);
  });
});

describe("mentions and the retention", () => {
  const exists = (db: Database, id: number) => db.prepare("SELECT 1 FROM articles WHERE id = ?").get(id) !== undefined;

  it("lets a feed article past its retention go with its names", () => {
    const db = createTestDb();
    const id = seedFeedArticle(db, seedFeed(db), { at: at(-100 * DAY) });
    replaceMentions(db, id, [BOJ]);
    expect(ids(db, "日本銀行")).toEqual([id]);

    purgeExpired(db, clock);

    expect(exists(db, id)).toBe(false);
    expect(ids(db, "日本銀行")).toEqual([]);
  });

  it("deletes a generated article with names 181 days after its last update, without a star or an annotation", () => {
    const db = createTestDb();
    const id = generated(db, { at: at(-181 * DAY) });
    replaceMentions(db, id, [BOJ]);

    purgeExpired(db, clock);

    expect(exists(db, id)).toBe(false);
  });
});

describe("the articles of a name", () => {
  it("takes names as the same when only case, width and spaces differ, whatever their kind", () => {
    const db = createTestDb();
    const a = generated(db, { at: at(-2) });
    const b = generated(db, { at: at(-1) });
    replaceMentions(db, a, [{ name: "ＯｐｅｎＡＩ", kind: "organization" }]);
    replaceMentions(db, b, [{ name: "OpenAI", kind: "product" }]);

    expect(ids(db, "OpenAI")).toEqual([b, a]);
    expect(ids(db, " open  ai ")).toEqual([]);
    expect(ids(db, "  openai ")).toEqual([b, a]);
  });

  it("takes neither an abbreviation nor a part of a name as the name", () => {
    const db = createTestDb();
    const a = generated(db);
    const b = generated(db);
    replaceMentions(db, a, [BOJ]);
    replaceMentions(db, b, [{ name: "日銀", kind: "organization" }]);

    expect(ids(db, "日本銀行")).toEqual([a]);
    expect(ids(db, "日本")).toEqual([]);
  });

  it("lists generated and feed articles, read or not, and events that have ended, newest first", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const threeDaysAgo = generated(db, { at: at(-3 * DAY) });
    const yesterday = seedFeedArticle(db, feedId, { at: at(-DAY), isRead: true });
    const today = generated(db, { at: at(-1) });
    const ended = generated(db, {
      at: at(-2 * DAY),
      categoryId: category(db, "event"),
      event: { key: "k", startsAt: "2026-02-01", endsAt: "2026-02-02", venue: null, fee: null, registration: "unknown" },
    });
    const elsewhere = generated(db);
    for (const id of [threeDaysAgo, yesterday, today, ended]) replaceMentions(db, id, [BOJ]);
    replaceMentions(db, elsewhere, [UEDA]);

    const list = listMentionArticles(db, { name: "日本銀行" }, NOW);
    expect(list.items.map((item) => item.id)).toEqual([today, yesterday, ended, threeDaysAgo]);
    expect(list.items.map((item) => item.origin)).toEqual(["generated", "feed", "generated", "generated"]);
    expect(list.asOf).toBe(NOW);
    expect(list.nextCursor).toBeNull();
  });

  it("pages the list with a cursor, newest first, each article once", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const all = Array.from({ length: 120 }, (_, index) => seedFeedArticle(db, feedId, { at: at(-index) }));
    for (const id of all) replaceMentions(db, id, [BOJ]);

    const first = listMentionArticles(db, { name: "日本銀行", limit: 50 }, NOW);
    const second = listMentionArticles(db, { name: "日本銀行", limit: 50, cursor: first.nextCursor! }, NOW);
    const third = listMentionArticles(db, { name: "日本銀行", limit: 50, cursor: second.nextCursor! }, NOW);

    expect([first.items.length, second.items.length, third.items.length]).toEqual([50, 50, 20]);
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual(all);
    expect(third.nextCursor).toBeNull();
  });

  it("leaves out a feed article a filter hides, unless it has a star or an annotation", () => {
    const db = createTestDb();
    const feedId = seedFeed(db);
    const hidden = seedFeedArticle(db, feedId, { title: "特売 1", at: at(-3) });
    const starred = seedFeedArticle(db, feedId, { title: "特売 2", at: at(-2), starred: true });
    const highlighted = seedFeedArticle(db, feedId, { title: "特売 3", body: "日本銀行の特売", at: at(-1) });
    for (const id of [hidden, starred, highlighted]) replaceMentions(db, id, [BOJ]);
    addHighlight(db, highlighted, { quote: "日本銀行", prefix: "", suffix: "の特売", position: 0, note: null }, NOW);
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "特売" }] }, clock);

    expect(ids(db, "日本銀行")).toEqual([highlighted, starred]);
  });

  it("leaves out a recorded duplicate while duplicate removal is on", () => {
    const db = createTestDb();
    const kept = seedFeedArticle(db, seedFeed(db), { at: at(-2) });
    const duplicate = seedFeedArticle(db, seedFeed(db), { at: at(-1), duplicateOf: kept });
    for (const id of [kept, duplicate]) replaceMentions(db, id, [BOJ]);

    expect(ids(db, "日本銀行")).toEqual([kept]);
    updateSettings(db, { removeDuplicates: false });
    expect(ids(db, "日本銀行")).toEqual([duplicate, kept]);
  });

  it("gives an empty list for a name no article has", () => {
    const db = createTestDb();
    expect(listMentionArticles(db, { name: "日本銀行" }, NOW)).toEqual({ items: [], nextCursor: null, asOf: NOW });
  });
});

describe("mentions in the article detail", () => {
  it("gives the names in the order they were stored, and none for an article without them", () => {
    const db = createTestDb();
    const id = generated(db);
    const other = seedFeedArticle(db, seedFeed(db));
    replaceMentions(db, id, [BOJ, UEDA]);

    expect(getArticle(db, id).mentions).toEqual([BOJ, UEDA]);
    expect(getArticle(db, other).mentions).toEqual([]);
  });

  it("leaves the rows of the article list as they were", () => {
    const db = createTestDb();
    const id = generated(db);
    const before = listArticles(db, {}, NOW);
    replaceMentions(db, id, [BOJ]);
    setArticleFlags(db, id, {}, NOW);

    const after = listArticles(db, {}, NOW);
    expect(after).toEqual(before);
    expect(after.items[0]).not.toHaveProperty("mentions");
  });
});
