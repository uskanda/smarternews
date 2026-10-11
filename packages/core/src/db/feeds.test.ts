import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeedArticle } from "../testing/db.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import { deleteFeed, dueFeeds, getFeed, insertFeed, listFeeds, nextFetchAt, recordFetchFailure, recordFetchSuccess, updateFeed } from "./feeds.ts";
import { updateSettings } from "./settings.ts";

const START = "2026-03-01T12:00:00.000Z";
const MINUTE = 60_000;

function setup() {
  const db = createTestDb();
  const clock = fakeClock(START);
  const news = createCategory(db, { name: "Tools", kind: "news" }, clock);
  return { db, clock, news };
}

describe("insertFeed", () => {
  it("stores a feed without a category, enabled, on the base interval", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example" }, clock);
    expect(feed).toMatchObject({
      url: "https://example.org/feed.xml",
      title: "Example",
      categoryId: null,
      intervalMinutes: null,
      enabled: true,
      lastFetchedAt: null,
      lastError: null,
      failureCount: 0,
      articleCount: 0,
      starredCount: 0,
    });
    expect(listFeeds(db)).toEqual([feed]);
  });

  it("refuses a URL that differs from a subscribed one only in tracking parameters", () => {
    const { db, clock } = setup();
    insertFeed(db, { url: "https://example.org/feed.xml", title: "Example" }, clock);
    expect(() => insertFeed(db, { url: "https://example.org/feed.xml?utm_source=x#top", title: "Again" }, clock)).toThrow(/already subscribed/);
    expect(listFeeds(db)).toHaveLength(1);
  });

  it("refuses a category of the kind event, and one that does not exist", () => {
    const { db, clock } = setup();
    const events = createCategory(db, { name: "Events", kind: "event" }, clock);
    expect(() => insertFeed(db, { url: "https://example.org/a.xml", title: "A", categoryId: events.id }, clock)).toThrow(/event/);
    expect(() => insertFeed(db, { url: "https://example.org/b.xml", title: "B", categoryId: 999 }, clock)).toThrow(/does not exist/);
    expect(listFeeds(db)).toEqual([]);
  });

});

describe("updateFeed", () => {
  it("moves the feed's articles to the new category, and to none", () => {
    const { db, clock, news } = setup();
    const other = createCategory(db, { name: "Cars", kind: "news" }, clock);
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example", categoryId: news.id }, clock);
    const article = seedFeedArticle(db, feed.id);
    const categoryOf = () => db.prepare("SELECT category_id FROM articles WHERE id = ?").get(article)!.category_id;
    expect(categoryOf()).toBe(news.id);

    updateFeed(db, feed.id, { categoryId: other.id });
    expect(categoryOf()).toBe(other.id);

    updateFeed(db, feed.id, { categoryId: null });
    expect(categoryOf()).toBeNull();
    expect(getFeed(db, feed.id).categoryId).toBeNull();
  });

  it("refuses to move a feed into an event category", () => {
    const { db, clock } = setup();
    const events = createCategory(db, { name: "Events", kind: "event" }, clock);
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example" }, clock);
    expect(() => updateFeed(db, feed.id, { categoryId: events.id })).toThrow(/event/);
  });

  it("stores the name, the interval and whether it is enabled, and can go back to the base interval", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example", intervalMinutes: 120 }, clock);
    expect(updateFeed(db, feed.id, { title: "Mine", enabled: false })).toMatchObject({ title: "Mine", enabled: false, intervalMinutes: 120 });
    expect(updateFeed(db, feed.id, { intervalMinutes: null }).intervalMinutes).toBeNull();
  });
});

describe("deleteFeed", () => {
  it("removes the feed with all of its articles, starred ones included", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example" }, clock);
    seedFeedArticle(db, feed.id, { starred: true });
    seedFeedArticle(db, feed.id);
    expect(getFeed(db, feed.id)).toMatchObject({ articleCount: 2, starredCount: 1 });

    deleteFeed(db, feed.id);

    expect(db.prepare("SELECT count(*) AS n FROM articles").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM article_refs").get()).toEqual({ n: 0 });
    expect(() => getFeed(db, feed.id)).toThrow(/does not exist/);
  });
});

describe("deleting a category", () => {
  it("keeps its feeds and their articles, with read and star as they were, under no category", () => {
    const { db, clock, news } = setup();
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example", categoryId: news.id }, clock);
    const read = seedFeedArticle(db, feed.id, { isRead: true });
    const starred = seedFeedArticle(db, feed.id, { starred: true });

    deleteCategory(db, news.id);

    expect(getFeed(db, feed.id).categoryId).toBeNull();
    expect(db.prepare("SELECT id, category_id, is_read, starred FROM articles ORDER BY id").all()).toEqual([
      { id: read, category_id: null, is_read: 1, starred: 0 },
      { id: starred, category_id: null, is_read: 0, starred: 1 },
    ]);
  });
});

describe("when a feed is due", () => {
  it("is due at once when it was never fetched", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example" }, clock);
    expect(dueFeeds(db, clock()).map((entry) => entry.id)).toEqual([feed.id]);
  });

  it("is due again after the base interval, or after its own", () => {
    const { db, clock } = setup();
    const base = insertFeed(db, { url: "https://example.org/a.xml", title: "A" }, clock);
    const slow = insertFeed(db, { url: "https://example.org/b.xml", title: "B", intervalMinutes: 120 }, clock);
    recordFetchSuccess(db, base.id, { now: START });
    recordFetchSuccess(db, slow.id, { now: START });

    clock.advance(29 * MINUTE);
    expect(dueFeeds(db, clock())).toEqual([]);
    clock.advance(MINUTE);
    expect(dueFeeds(db, clock()).map((entry) => entry.id)).toEqual([base.id]);
    clock.advance(90 * MINUTE);
    expect(dueFeeds(db, clock()).map((entry) => entry.id)).toEqual([base.id, slow.id]);
  });

  it("follows the base interval when the settings change", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/a.xml", title: "A" }, clock);
    recordFetchSuccess(db, feed.id, { now: START });
    updateSettings(db, { feedIntervalMinutes: 60 });
    clock.advance(45 * MINUTE);
    expect(dueFeeds(db, clock())).toEqual([]);
    clock.advance(15 * MINUTE);
    expect(dueFeeds(db, clock())).toHaveLength(1);
  });

  it("is never due while it is disabled", () => {
    const { db, clock } = setup();
    insertFeed(db, { url: "https://example.org/a.xml", title: "A", enabled: false }, clock);
    clock.advance(24 * 60 * MINUTE);
    expect(dueFeeds(db, clock())).toEqual([]);
  });

  it("waits twice as long after every failure in a row, up to one day", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/a.xml", title: "A" }, clock);
    const waitAfterFailures = (count: number) => {
      for (let index = 0; index < count; index += 1) recordFetchFailure(db, feed.id, { now: START, error: "HTTP status 500" });
      return (nextFetchAt(db, getFeed(db, feed.id)).getTime() - new Date(START).getTime()) / MINUTE;
    };
    expect(waitAfterFailures(1)).toBe(60);
    expect(waitAfterFailures(1)).toBe(120);
    expect(waitAfterFailures(1)).toBe(240);
    expect(waitAfterFailures(10)).toBe(24 * 60);
    expect(getFeed(db, feed.id)).toMatchObject({ lastError: "HTTP status 500", lastFetchedAt: START, lastSucceededAt: null });
  });

  it("goes back to its interval, and forgets the error, after a success", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/a.xml", title: "A" }, clock);
    recordFetchFailure(db, feed.id, { now: START, error: "timed out" });
    recordFetchFailure(db, feed.id, { now: START, error: "timed out" });
    const later = new Date(new Date(START).getTime() + 5 * MINUTE).toISOString();

    recordFetchSuccess(db, feed.id, { now: later });

    const after = getFeed(db, feed.id);
    expect(after).toMatchObject({ lastError: null, failureCount: 0, lastSucceededAt: later, lastFetchedAt: later });
    expect(nextFetchAt(db, after).getTime() - new Date(later).getTime()).toBe(30 * MINUTE);
  });
});

describe("summaries of a feed", () => {
  const since = (db: ReturnType<typeof createTestDb>, id: number) => db.prepare("SELECT auto_summarize_since AS since FROM feeds WHERE id = ?").get(id)!.since;

  it("are off for a feed that is registered without saying so", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/feed.xml", title: "Example" }, clock);
    expect(feed.autoSummarize).toBe(false);
    expect(since(db, feed.id)).toBeNull();
  });

  it("record the time they were switched on, at registration and at a change", () => {
    const { db, clock } = setup();
    const registered = insertFeed(db, { url: "https://example.org/a.xml", title: "A", autoSummarize: true }, clock);
    expect(registered.autoSummarize).toBe(true);
    expect(since(db, registered.id)).toBe(START);

    const changed = insertFeed(db, { url: "https://example.org/b.xml", title: "B" }, clock);
    clock.advance(5 * MINUTE);
    expect(updateFeed(db, changed.id, { autoSummarize: true }, clock).autoSummarize).toBe(true);
    expect(since(db, changed.id)).toBe("2026-03-01T12:05:00.000Z");
    expect(listFeeds(db).map((feed) => feed.autoSummarize)).toEqual([true, true]);
  });

  it("keep the earlier time when they are switched on again while on", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/a.xml", title: "A", autoSummarize: true }, clock);
    clock.advance(5 * MINUTE);
    updateFeed(db, feed.id, { autoSummarize: true, title: "Renamed" }, clock);
    expect(since(db, feed.id)).toBe(START);
  });

  it("forget the time when they are switched off", () => {
    const { db, clock } = setup();
    const feed = insertFeed(db, { url: "https://example.org/a.xml", title: "A", autoSummarize: true }, clock);
    expect(updateFeed(db, feed.id, { autoSummarize: false }, clock).autoSummarize).toBe(false);
    expect(since(db, feed.id)).toBeNull();
  });
});
