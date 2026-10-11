import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { getArticle, nextArticleToSummarize, recordSummaryFailure, saveAutoSummary, setArticleFlags, skipAutoSummary } from "./articles.ts";
import { updateFeed } from "./feeds.ts";
import { createStopWord } from "./stop-words.ts";

const SINCE = "2026-03-01T12:00:00.000Z";
const LATER = "2026-03-01T13:00:00.000Z";

/** A feed that began to summarise at SINCE. */
function setup() {
  const db = createTestDb();
  const clock = fakeClock(SINCE);
  const feedId = seedFeed(db);
  updateFeed(db, feedId, { autoSummarize: true }, clock);
  return { db, clock, feedId };
}

describe("nextArticleToSummarize", () => {
  it("returns an article stored after its feed began to summarise, with its page and what the feed delivered", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { title: "Fresh", body: "Delivered text", at: LATER, url: "https://site.example.org/fresh" });
    expect(nextArticleToSummarize(db)).toEqual({ id, title: "Fresh", url: "https://site.example.org/fresh", contentText: "Delivered text" });
    expect(getArticle(db, id)).toMatchObject({ autoSummary: null, autoSummaryPending: true });
  });

  it("leaves out an article stored before the feed began to summarise, however new the feed says it is", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { at: LATER, storedAt: "2026-03-01T11:00:00.000Z" });
    expect(nextArticleToSummarize(db)).toBeNull();
    expect(getArticle(db, id).autoSummaryPending).toBe(false);
  });

  it("takes an article the feed dates in the past when it was stored after the feed began to summarise", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { at: "2026-02-20T00:00:00.000Z", storedAt: LATER });
    expect(nextArticleToSummarize(db)?.id).toBe(id);
  });

  it("leaves out an article that was read", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { at: LATER });
    setArticleFlags(db, id, { isRead: true });
    expect(nextArticleToSummarize(db)).toBeNull();
    expect(getArticle(db, id).autoSummaryPending).toBe(false);
  });

  it("tries an article again after one failure, and leaves it out after two", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { at: LATER });
    recordSummaryFailure(db, id);
    expect(nextArticleToSummarize(db)?.id).toBe(id);
    recordSummaryFailure(db, id);
    expect(nextArticleToSummarize(db)).toBeNull();
  });

  it("leaves out an article that a stop word hides, unless it has a star", () => {
    const { db, clock, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { title: "Sponsored post", at: LATER });
    createStopWord(db, { text: "sponsored" }, clock);
    expect(nextArticleToSummarize(db)).toBeNull();
    setArticleFlags(db, id, { starred: true });
    expect(nextArticleToSummarize(db)?.id).toBe(id);
  });

  it("leaves out the articles of a feed that does not summarise, and of one that stopped", () => {
    const { db, clock, feedId } = setup();
    seedFeedArticle(db, seedFeed(db), { at: LATER });
    expect(nextArticleToSummarize(db)).toBeNull();

    seedFeedArticle(db, feedId, { at: LATER });
    updateFeed(db, feedId, { autoSummarize: false }, clock);
    expect(nextArticleToSummarize(db)).toBeNull();
  });

  it("leaves out an article that has a summary, and one with too little text", () => {
    const { db, feedId } = setup();
    const done = seedFeedArticle(db, feedId, { at: LATER });
    const short = seedFeedArticle(db, feedId, { at: LATER });
    saveAutoSummary(db, done, { text: "A summary.", source: "page", now: LATER });
    skipAutoSummary(db, short);
    expect(nextArticleToSummarize(db)).toBeNull();
    expect(getArticle(db, done)).toMatchObject({ autoSummary: { text: "A summary.", source: "page", createdAt: LATER }, autoSummaryPending: false });
    expect(getArticle(db, short)).toMatchObject({ autoSummary: null, autoSummaryPending: false });
  });

  it("returns the newest first", () => {
    const { db, feedId } = setup();
    const old = seedFeedArticle(db, feedId, { at: "2026-03-01T12:10:00.000Z" });
    const newest = seedFeedArticle(db, feedId, { at: "2026-03-01T12:30:00.000Z" });
    const middle = seedFeedArticle(db, feedId, { at: "2026-03-01T12:20:00.000Z" });
    const order: number[] = [];
    for (let next = nextArticleToSummarize(db); next; next = nextArticleToSummarize(db)) {
      order.push(next.id);
      skipAutoSummary(db, next.id);
    }
    expect(order).toEqual([newest, middle, old]);
  });
});
