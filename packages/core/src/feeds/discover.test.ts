import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeFetch, html, xml } from "../testing/http.ts";
import { discoverFeeds } from "./discover.ts";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Feed</title></channel></rss>`;

function fetcher(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  return { fetcher: new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 1_000_000, fetchImpl: fake.fetchImpl }), requests: fake.requests };
}

describe("discoverFeeds", () => {
  it("lists the feeds a page points to, with their titles and absolute addresses", async () => {
    const page = `<html><head>
      <link rel="stylesheet" href="/style.css">
      <link rel="alternate" type="application/rss+xml" title="Posts (RSS)" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" title="Posts (Atom)" href="https://example.org/atom.xml">
      <link rel="alternate" type="text/html" hreflang="en" href="/en/">
      </head><body></body></html>`;
    const { fetcher: f } = fetcher({ "https://example.org/": () => html(page) });
    expect(await discoverFeeds(f, "https://example.org/")).toEqual([
      { url: "https://example.org/feed.xml", title: "Posts (RSS)" },
      { url: "https://example.org/atom.xml", title: "Posts (Atom)" },
    ]);
  });

  it("gives the URL itself, with the feed's title, when it is a feed", async () => {
    const { fetcher: f } = fetcher({ "https://example.org/feed.xml": () => xml(RSS) });
    expect(await discoverFeeds(f, "https://example.org/feed.xml")).toEqual([{ url: "https://example.org/feed.xml", title: "Example Feed" }]);
  });

  it("finds nothing on a page that points to no feed", async () => {
    const { fetcher: f } = fetcher({ "https://example.org/": () => html("<html><head><title>Hi</title></head></html>") });
    expect(await discoverFeeds(f, "https://example.org/")).toEqual([]);
  });

  it("lists a feed once when the page names it twice, and leaves out addresses that are not web addresses", async () => {
    const page = `<link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="ALTERNATE" type="application/rss+xml" href="/feed.xml#x"><link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">`;
    const { fetcher: f } = fetcher({ "https://example.org/": () => html(page) });
    expect(await discoverFeeds(f, "https://example.org/")).toEqual([{ url: "https://example.org/feed.xml", title: "" }]);
  });

  it("refuses a URL that cannot be fetched", async () => {
    const { fetcher: f } = fetcher({});
    await expect(discoverFeeds(f, "https://example.org/missing")).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/404/) });
  });
});
