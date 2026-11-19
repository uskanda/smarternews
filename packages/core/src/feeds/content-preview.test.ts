import { describe, expect, it } from "vitest";
import { CONTENT_PREVIEW_CHARS } from "../api.ts";
import { getArticle } from "../db/articles.ts";
import { insertFeed } from "../db/feeds.ts";
import { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { createTestDb, fakeClock, seedFeedArticle } from "../testing/db.ts";
import { fakeFetch, html } from "../testing/http.ts";
import { previewContent } from "./content-preview.ts";

const START = "2026-03-01T12:00:00.000Z";
const MINUTE = 60_000;

const prose = (word: string, chars: number) => `${word} `.repeat(Math.ceil(chars / (word.length + 1))).trim();
const STORY = prose("story", 600);
const COMMENTS = prose("comment", 1200);
const storyPage = () =>
  html(
    `<html><head><title>Page</title></head><body><article><h1>Page</h1><div class="story"><p>${STORY}</p></div>` +
      `<section><p>${COMMENTS}</p><p>${COMMENTS}</p></section></article></body></html>`,
  );

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const db = createTestDb();
  const clock = fakeClock(START);
  const fake = fakeFetch(routes, clock);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 1_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
  const pages = new PageFetcher(fetcher, { pagesPerRun: Number.POSITIVE_INFINITY, remember: false });
  const feed = insertFeed(db, { url: "https://feeds.example.org/feed.xml", title: "Feed" }, clock);
  const article = (options: { url?: string | null; body?: string; title?: string } = {}) => {
    clock.advance(MINUTE);
    return seedFeedArticle(db, feed.id, { at: clock().toISOString(), url: options.url === undefined ? "https://site.example.org/1" : options.url, body: options.body ?? "Short excerpt", title: options.title });
  };
  const deps = { db, pages };
  const pageRequests = () => fake.urls().filter((url) => !url.endsWith("/robots.txt"));
  return { db, clock, feed, article, deps, pageRequests };
}

describe("previewContent", () => {
  it("takes the element the selector matches out of the page of the feed's newest article with a URL", async () => {
    const s = setup({ "https://site.example.org/2": storyPage });
    s.article({ url: "https://site.example.org/1" });
    const newest = s.article({ url: "https://site.example.org/2", title: "The newest" });
    s.article({ url: null });

    const preview = await previewContent(s.deps, s.feed.id, ".story");

    expect(s.pageRequests()).toEqual(["https://site.example.org/2"]);
    expect(preview).toMatchObject({ status: "ok", article: { id: newest, title: "The newest", url: "https://site.example.org/2" }, matched: true, shorter: false });
    if (preview.status !== "ok") throw new Error("not ok");
    expect(preview.markdown).toContain("story story");
    expect(preview.markdown).not.toContain("comment");
    expect(preview.chars).toBe(STORY.length);
  });

  it("says the selector matched nothing and shows what Readability finds", async () => {
    const s = setup({ "https://site.example.org/1": storyPage });
    s.article();
    const preview = await previewContent(s.deps, s.feed.id, ".missing");
    expect(preview).toMatchObject({ status: "ok", matched: false });
    if (preview.status !== "ok") throw new Error("not ok");
    expect(preview.markdown).toContain("story story");
  });

  it("shows what Readability finds for no selector, cut at the limit with the whole counted", async () => {
    const long = prose("long", 3000);
    const s = setup({ "https://site.example.org/1": () => html(`<html><body><article><p>${long}</p><p>${long}</p></article></body></html>`) });
    s.article();
    const preview = await previewContent(s.deps, s.feed.id, null);
    expect(preview).toMatchObject({ status: "ok", matched: false });
    if (preview.status !== "ok") throw new Error("not ok");
    expect(preview.markdown.length).toBeLessThanOrEqual(CONTENT_PREVIEW_CHARS);
    expect(preview.chars).toBeGreaterThan(CONTENT_PREVIEW_CHARS);
  });

  it("says when the body is shorter than what the feed delivered", async () => {
    const s = setup({ "https://site.example.org/1": storyPage });
    s.article({ body: prose("delivered", 1000) });
    expect(await previewContent(s.deps, s.feed.id, ".story")).toMatchObject({ status: "ok", matched: true, shorter: true });
  });

  it("says when the feed has no article with a URL, without a request", async () => {
    const s = setup({});
    s.article({ url: null });
    expect(await previewContent(s.deps, s.feed.id, ".story")).toEqual({ status: "no-article" });
    expect(s.pageRequests()).toEqual([]);
  });

  it("says why a page could not be read, as full content records it", async () => {
    const s = setup({ "https://site.example.org/1": () => new Response("gone", { status: 404 }) });
    const id = s.article();
    expect(await previewContent(s.deps, s.feed.id, ".story")).toEqual({
      status: "failed",
      article: { id, title: expect.any(String), url: "https://site.example.org/1" },
      error: { reason: "http", detail: "404" },
    });
  });

  it("stores nothing", async () => {
    const s = setup({ "https://site.example.org/1": storyPage });
    const id = s.article();
    const before = getArticle(s.db, id);
    await previewContent(s.deps, s.feed.id, ".story");
    expect(getArticle(s.db, id)).toEqual(before);
  });

  it("refuses a selector the engine cannot use, and a feed that does not exist", async () => {
    const s = setup({});
    await expect(previewContent(s.deps, s.feed.id, "div:frobnicate")).rejects.toMatchObject({ code: "invalid", fields: [expect.objectContaining({ path: "contentSelector" })] });
    await expect(previewContent(s.deps, 999, ".story")).rejects.toMatchObject({ code: "not_found" });
  });
});
