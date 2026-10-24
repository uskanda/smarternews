import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import {
  articleForFullContent,
  getArticle,
  insertArticle,
  nextArticleForFullContent,
  recordFullContentFailure,
  saveFullContent,
  setArticleFlags,
} from "./articles.ts";
import { createCategory } from "./categories.ts";
import { updateFeed } from "./feeds.ts";
import { createFilter } from "./filters.ts";
import { saveArticleTranslation, saveTranslatedTitle } from "./translations.ts";
import { updateSettings } from "./settings.ts";

const SINCE = "2026-03-01T12:00:00.000Z";
const LATER = "2026-03-01T13:00:00.000Z";
const LATEST = "2026-03-01T14:00:00.000Z";

/** A feed that began to fetch full content at SINCE. */
function setup() {
  const db = createTestDb();
  const clock = fakeClock(SINCE);
  const feedId = seedFeed(db);
  updateFeed(db, feedId, { fetchFullContent: true }, clock);
  return { db, clock, feedId };
}

describe("nextArticleForFullContent", () => {
  it("returns an unread article stored after its feed began to fetch full content, with its page", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { body: "Delivered text", at: LATER, url: "https://site.example.org/fresh" });
    expect(nextArticleForFullContent(db)).toEqual({ id, url: "https://site.example.org/fresh", contentText: "Delivered text" });
    expect(getArticle(db, id)).toMatchObject({ fullContent: null, fullContentStatus: "waiting", fullContentError: null });
  });

  it("takes the newest stored first", () => {
    const { db, feedId } = setup();
    seedFeedArticle(db, feedId, { at: LATEST, storedAt: LATER });
    const newer = seedFeedArticle(db, feedId, { at: LATER, storedAt: LATEST });
    expect(nextArticleForFullContent(db)?.id).toBe(newer);
  });

  it("leaves out an article stored before the feed began to fetch full content", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { at: LATER, storedAt: "2026-03-01T11:00:00.000Z" });
    expect(nextArticleForFullContent(db)).toBeNull();
    expect(getArticle(db, id).fullContentStatus).toBe("none");
  });

  it("leaves out an article that was read", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { at: LATER });
    setArticleFlags(db, id, { isRead: true }, LATER);
    expect(nextArticleForFullContent(db)).toBeNull();
    expect(getArticle(db, id).fullContentStatus).toBe("none");
  });

  it("leaves out an article with full content, and one whose fetch failed", () => {
    const { db, feedId } = setup();
    const fetched = seedFeedArticle(db, feedId, { at: LATER });
    const failed = seedFeedArticle(db, feedId, { at: LATER });
    saveFullContent(db, fetched, { markdown: "Full", text: "Full", now: LATEST });
    recordFullContentFailure(db, failed, { reason: "timeout", detail: null });
    expect(nextArticleForFullContent(db)).toBeNull();
  });

  it("leaves out an article that filters hide, unless it has a star", () => {
    const { db, clock, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { title: "sponsored post", at: LATER });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "sponsored" }] }, clock);
    expect(nextArticleForFullContent(db)).toBeNull();
    setArticleFlags(db, id, { starred: true }, LATER);
    expect(nextArticleForFullContent(db)?.id).toBe(id);
  });

  it("leaves out a hidden duplicate, which nobody reads apart from the article kept for it", () => {
    const { db, feedId } = setup();
    const kept = seedFeedArticle(db, seedFeed(db), { at: LATER });
    seedFeedArticle(db, feedId, { at: LATER, duplicateOf: kept });
    expect(nextArticleForFullContent(db)).toBeNull();
    updateSettings(db, { removeDuplicates: false });
    expect(nextArticleForFullContent(db)).not.toBeNull();
  });

  it("leaves out the articles of a feed that does not fetch full content, and of one that stopped", () => {
    const { db, clock, feedId } = setup();
    seedFeedArticle(db, seedFeed(db), { at: LATER });
    expect(nextArticleForFullContent(db)).toBeNull();

    seedFeedArticle(db, feedId, { at: LATER });
    clock.set(LATEST);
    updateFeed(db, feedId, { fetchFullContent: false }, clock);
    expect(nextArticleForFullContent(db)).toBeNull();
  });
});

describe("saveFullContent", () => {
  it("stores the full content and its time, and gives it with the article", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { body: "Excerpt", at: LATER });
    recordFullContentFailure(db, id, { reason: "http", detail: "503" });
    saveFullContent(db, id, { markdown: "Full **text**\n\n![x](https://img.example.org/a.png)", text: "Full text", now: LATEST });
    const article = getArticle(db, id);
    expect(article.body).toBe("Excerpt");
    expect(article.fullContentStatus).toBe("fetched");
    expect(article.fullContentError).toBeNull();
    expect(article.fullContent).toEqual({
      body: "Full **text**\n\n![x](https://img.example.org/a.png)",
      bodyHtml: expect.stringContaining('<img src="https://img.example.org/a.png"'),
      fetchedAt: LATEST,
    });
    expect(articleForFullContent(db, id)).toMatchObject({ status: "fetched", fullContentText: "Full text" });
  });

  it("forgets the translation of the content and keeps that of the title", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { title: "Title", at: LATER });
    saveTranslatedTitle(db, id, { original: "Title", title: "タイトル", sourceLanguage: "en" });
    saveArticleTranslation(db, id, { segments: [{ original: "Content", translated: "内容" }], method: "google", truncated: false, now: LATER });
    expect(getArticle(db, id).translation).not.toBeNull();

    saveFullContent(db, id, { markdown: "Full", text: "Full", now: LATEST });

    const article = getArticle(db, id);
    expect(article.translation).toBeNull();
    expect(article.translatedTitle).toBe("タイトル");
  });
});

describe("recordFullContentFailure", () => {
  it("records the reason and its detail, and leaves the content as delivered", () => {
    const { db, feedId } = setup();
    const id = seedFeedArticle(db, feedId, { body: "Excerpt", at: LATER });
    recordFullContentFailure(db, id, { reason: "http", detail: "404" });
    expect(getArticle(db, id)).toMatchObject({
      body: "Excerpt",
      fullContent: null,
      fullContentStatus: "failed",
      fullContentError: { reason: "http", detail: "404" },
    });
  });
});

describe("articleForFullContent", () => {
  it("refuses a generated article, and one that does not exist", () => {
    const { db, clock } = setup();
    const category = createCategory(db, { name: "News", kind: "news" }, clock);
    const id = insertArticle(db, {
      categoryId: category.id,
      kind: "news",
      title: "Generated",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: LATER,
      previousArticleId: null,
      refs: [],
      topicIds: [],
    });
    expect(() => articleForFullContent(db, id)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => articleForFullContent(db, 9999)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(getArticle(db, id)).toMatchObject({ fullContent: null, fullContentStatus: "none", fullContentError: null });
  });
});
