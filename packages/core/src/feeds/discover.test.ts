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

  it("finds nothing on a page that points to no feed and has none at the common places", async () => {
    const { fetcher: f, requests } = fetcher({
      "https://example.org/blog/post": () => html("<html><head><title>Hi</title></head></html>"),
      "https://example.org/feed.json": () => new Response(JSON.stringify({ title: "not a feed" }), { headers: { "content-type": "application/json" } }),
    });
    expect(await discoverFeeds(f, "https://example.org/blog/post")).toEqual([]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://example.org/blog/post",
      "https://example.org/feed",
      "https://example.org/rss.xml",
      "https://example.org/feed.xml",
      "https://example.org/atom.xml",
      "https://example.org/index.xml",
      "https://example.org/feed.json",
    ]);
  });

  it("gives the first feed at the common places when the page points to none, and asks no further", async () => {
    const { fetcher: f, requests } = fetcher({
      "https://example.org/home": () => html("<html><head><title>Hi</title></head></html>"),
      "https://example.org/rss.xml": () => html("<html><body>Not here</body></html>"),
      "https://example.org/feed.xml": () => xml(RSS),
    });
    expect(await discoverFeeds(f, "https://example.org/home")).toEqual([{ url: "https://example.org/feed.xml", title: "Example Feed" }]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://example.org/home",
      "https://example.org/feed",
      "https://example.org/rss.xml",
      "https://example.org/feed.xml",
    ]);
  });

  it("does not try the common places when the page points to a feed", async () => {
    const page = `<link rel="alternate" type="application/rss+xml" href="/posts.rss">`;
    const { fetcher: f, requests } = fetcher({ "https://example.org/": () => html(page) });
    expect(await discoverFeeds(f, "https://example.org/")).toEqual([{ url: "https://example.org/posts.rss", title: "" }]);
    expect(requests).toHaveLength(1);
  });

  it("lists a JSON Feed the page points to", async () => {
    const page = `<link rel="alternate" type="application/feed+json" title="Posts (JSON)" href="/feed.json">`;
    const { fetcher: f } = fetcher({ "https://example.org/": () => html(page) });
    expect(await discoverFeeds(f, "https://example.org/")).toEqual([{ url: "https://example.org/feed.json", title: "Posts (JSON)" }]);
  });

  it("gives the URL itself, with the feed's title, when it is a JSON Feed", async () => {
    const body = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Example JSON", items: [] });
    const { fetcher: f } = fetcher({ "https://example.org/feed.json": () => new Response(body, { headers: { "content-type": "application/feed+json" } }) });
    expect(await discoverFeeds(f, "https://example.org/feed.json")).toEqual([{ url: "https://example.org/feed.json", title: "Example JSON" }]);
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
