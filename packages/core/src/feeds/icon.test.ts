import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { fakeFetch, html, type Route } from "../testing/http.ts";
import { icoBytes, imageResponse, pngBytes } from "../testing/images.ts";
import { findFeedIcon } from "./icon.ts";

const FEED = "https://example.org/feed.xml";
const SITE = "https://example.org/blog/";

function search(routes: Record<string, Route>) {
  const fake = fakeFetch(routes);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 1_000_000, fetchImpl: fake.fetchImpl });
  return { deps: { fetcher, pages: new PageFetcher(fetcher, { pagesPerRun: Number.POSITIVE_INFINITY, remember: false }) }, urls: fake.urls };
}

const png = () => imageResponse(pngBytes());
const page = (head: string) => () => html(`<html><head>${head}</head><body></body></html>`);

describe("findFeedIcon", () => {
  it("takes the icon the feed names first, and asks nothing more", async () => {
    const { deps, urls } = search({ "https://example.org/icon.png": png, [SITE]: page(`<link rel="icon" href="/other.png">`) });
    expect(await findFeedIcon(deps, { feedUrl: FEED, siteUrl: SITE, named: "https://example.org/icon.png" })).toBe("https://example.org/icon.png");
    expect(urls()).toEqual(["https://example.org/robots.txt", "https://example.org/icon.png"]);
  });

  it("then takes the page's icon links in their order, leaving out SVG and the other kinds of icon", async () => {
    const { deps, urls } = search({
      [SITE]: page(`
        <link rel="apple-touch-icon" href="/touch.png">
        <link rel="icon" type="image/svg+xml" href="/icon.svg">
        <link rel="shortcut icon" href="small.png">
        <link rel="icon" href="/large.png">`),
      "https://example.org/blog/small.png": png,
      "https://example.org/favicon.ico": () => imageResponse(icoBytes(), "image/x-icon"),
    });
    expect(await findFeedIcon(deps, { feedUrl: FEED, siteUrl: SITE, named: null })).toBe("https://example.org/blog/small.png");
    expect(urls()).not.toContain("https://example.org/touch.png");
    expect(urls()).not.toContain("https://example.org/icon.svg");
  });

  it("skips an answer that is no image, and falls back to /favicon.ico at the site's origin", async () => {
    const { deps } = search({
      "https://example.org/icon.png": () => html("<html>not an image</html>"),
      [SITE]: page(`<link rel="icon" href="/broken.png">`),
      "https://example.org/broken.png": () => new Response("gone", { status: 500 }),
      "https://example.org/favicon.ico": () => imageResponse(icoBytes(), "image/x-icon"),
    });
    expect(await findFeedIcon(deps, { feedUrl: FEED, siteUrl: SITE, named: "https://example.org/icon.png" })).toBe("https://example.org/favicon.ico");
  });

  it("looks at the feed's origin when the feed names no site", async () => {
    const { deps } = search({ "https://feeds.example.net/favicon.ico": () => imageResponse(icoBytes(), "image/x-icon") });
    expect(await findFeedIcon(deps, { feedUrl: "https://feeds.example.net/a/rss", siteUrl: null, named: null })).toBe("https://feeds.example.net/favicon.ico");
  });

  it("does not fetch what robots.txt forbids", async () => {
    const { deps, urls } = search({
      "https://example.org/robots.txt": () => new Response("User-agent: *\nDisallow: /", { status: 200 }),
      "https://example.org/favicon.ico": () => imageResponse(icoBytes(), "image/x-icon"),
    });
    expect(await findFeedIcon(deps, { feedUrl: FEED, siteUrl: SITE, named: null })).toBeNull();
    expect(urls()).toEqual(["https://example.org/robots.txt"]);
  });

  it("finds nothing when no place answers with an image", async () => {
    const { deps } = search({ [SITE]: page("<title>no icon</title>") });
    expect(await findFeedIcon(deps, { feedUrl: FEED, siteUrl: SITE, named: null })).toBeNull();
  });
});
