import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeedArticle } from "../testing/db.ts";
import { createCategory } from "./categories.ts";
import { insertFeed, updateFeed } from "./feeds.ts";
import { updateSettings } from "./settings.ts";
import { listTopicSourceArticles } from "./topic-sources.ts";

const NOW = "2026-03-01T12:00:00.000Z";
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(new Date(NOW).getTime() - hours * HOUR).toISOString();
const SINCE = hoursAgo(24);

function setup() {
  const db = createTestDb();
  const clock = fakeClock(NOW);
  const news = createCategory(db, { name: "Tools", kind: "news" }, clock);
  const other = createCategory(db, { name: "Cars", kind: "news" }, clock);
  const feed = insertFeed(db, { url: "https://a.example.org/feed.xml", title: "Feed A", categoryId: news.id, topicSource: true }, clock);
  const article = (title: string, hours: number, options: Parameters<typeof seedFeedArticle>[2] = {}) =>
    seedFeedArticle(db, feed.id, { title, at: hoursAgo(hours), url: `https://a.example.org/${encodeURIComponent(title)}?utm_source=rss`, ...options });
  return { db, clock, news, other, feed, article };
}

const titles = (rows: Array<{ title: string }>) => rows.map((row) => row.title);
const never = () => false;

describe("the feed articles a run takes as candidates", () => {
  it("are those of the category's topic sources stored within the window, newest first, with a normalized URL", () => {
    const s = setup();
    const id = s.article("new", 1, { body: "What the feed delivered." });
    s.article("older", 3);
    s.article("out of the window", 30);

    const rows = listTopicSourceArticles(s.db, s.news.id, SINCE, never, 60);
    expect(titles(rows)).toEqual(["new", "older"]);
    expect(rows[0]).toEqual({
      articleId: id,
      url: "https://a.example.org/new",
      title: "new",
      snippet: "What the feed delivered.",
      siteName: "Feed A",
      publishedAt: hoursAgo(1),
    });
  });

  it("count from when an article was stored, not from when it was published", () => {
    const s = setup();
    s.article("published long ago, stored now", 72, { storedAt: hoursAgo(1) });
    expect(titles(listTopicSourceArticles(s.db, s.news.id, SINCE, never, 60))).toEqual(["published long ago, stored now"]);
  });

  it("leave out feeds that are no topic source, paused feeds and feeds of other categories", () => {
    const s = setup();
    const off = insertFeed(s.db, { url: "https://b.example.org/feed.xml", title: "B", categoryId: s.news.id }, s.clock);
    seedFeedArticle(s.db, off.id, { title: "not a source", at: hoursAgo(1) });
    const elsewhere = insertFeed(s.db, { url: "https://c.example.org/feed.xml", title: "C", categoryId: s.other.id, topicSource: true }, s.clock);
    seedFeedArticle(s.db, elsewhere.id, { title: "other category", at: hoursAgo(1) });
    const paused = insertFeed(s.db, { url: "https://d.example.org/feed.xml", title: "D", categoryId: s.news.id, topicSource: true, enabled: false }, s.clock);
    seedFeedArticle(s.db, paused.id, { title: "paused", at: hoursAgo(1) });
    s.article("kept", 2);

    expect(titles(listTopicSourceArticles(s.db, s.news.id, SINCE, never, 60))).toEqual(["kept"]);
    // A feed that left the category takes its articles along.
    updateFeed(s.db, s.feed.id, { categoryId: s.other.id });
    expect(listTopicSourceArticles(s.db, s.news.id, SINCE, never, 60)).toEqual([]);
  });

  it("leave out hidden duplicates, articles the filters hide, and articles without a page", () => {
    const s = setup();
    const kept = s.article("kept", 1);
    s.article("duplicate", 1, { duplicateOf: kept });
    const hidden = s.article("filtered", 1);
    s.db.prepare("UPDATE articles SET filtered = 1 WHERE id = ?").run(hidden);
    s.article("no page", 1, { url: null });

    expect(titles(listTopicSourceArticles(s.db, s.news.id, SINCE, never, 60))).toEqual(["kept"]);
    // With duplicate removal off, a recorded duplicate is shown, and taken.
    updateSettings(s.db, { removeDuplicates: false });
    expect(titles(listTopicSourceArticles(s.db, s.news.id, SINCE, never, 60)).sort()).toEqual(["duplicate", "kept"]);
  });

  it("leave out the settled URLs before taking at most the limit", () => {
    const s = setup();
    s.article("a", 1);
    s.article("b", 2);
    s.article("c", 3);
    s.article("d", 4);
    expect(titles(listTopicSourceArticles(s.db, s.news.id, SINCE, never, 2))).toEqual(["a", "b"]);
    const settled = new Set(["https://a.example.org/a", "https://a.example.org/b"]);
    expect(titles(listTopicSourceArticles(s.db, s.news.id, SINCE, (url) => settled.has(url), 2))).toEqual(["c", "d"]);
    expect(listTopicSourceArticles(s.db, s.news.id, SINCE, never, 0)).toEqual([]);
  });
});
