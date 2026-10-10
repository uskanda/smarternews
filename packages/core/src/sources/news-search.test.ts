import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeFetch, html, xml } from "../testing/http.ts";
import { collectNews } from "./news-search.ts";

const GOOGLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>"rust release" - Google News</title>
<item>
  <title>Rust 2.0 released - Example Times</title>
  <link>https://news.google.com/rss/articles/AAA111?oc=5</link>
  <pubDate>Sun, 01 Mar 2026 09:00:00 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/AAA111?oc=5"&gt;Rust 2.0 released&lt;/a&gt;&amp;nbsp;&lt;font&gt;Example Times&lt;/font&gt;</description>
  <source url="https://times.example.org">Example Times</source>
</item>
<item>
  <title>Older coverage - Example Daily</title>
  <link>https://news.google.com/rss/articles/BBB222?oc=5</link>
  <pubDate>Sun, 01 Mar 2026 03:00:00 GMT</pubDate>
  <source url="https://daily.example.org">Example Daily</source>
</item>
<item>
  <title>Last week - Example Weekly</title>
  <link>https://news.google.com/rss/articles/CCC333?oc=5</link>
  <pubDate>Sun, 22 Feb 2026 03:00:00 GMT</pubDate>
  <source url="https://weekly.example.org">Example Weekly</source>
</item>
</channel></rss>`;

const articlePage = (signature: string) => html(`<html><body><c-wiz><div jscontroller="x" data-n-a-sg="${signature}" data-n-a-ts="1700000000"></div></c-wiz></body></html>`);
const batchAnswer = (url: string) =>
  new Response(`)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"${url}\\",1]",null,null,null,"generic"]]`, { status: 200 });

const BING = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=rust&amp;format=rss"><channel><title>rust - Bing News</title>
<item>
  <title>Rust 2.0 released</title>
  <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=abc&amp;url=https%3a%2f%2ftimes.example.org%2frust-2%3fid%3d1&amp;c=1&amp;mkt=en-us</link>
  <description>The Rust team shipped version 2.0 today.</description>
  <pubDate>Sun, 01 Mar 2026 09:00:00 GMT</pubDate>
  <News:Source>Example Times</News:Source>
</item>
</channel></rss>`;

const since = new Date("2026-02-28T12:00:00Z");
const window = { since, hours: 24 };
const locale = { language: "en", region: "US" };

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 100000, fetchImpl: fake.fetchImpl });
  return { fetcher, ...fake };
}

const googleRoutes = {
  "https://news.google.com/rss/search": () => xml(GOOGLE),
  "https://news.google.com/rss/articles/AAA111": () => articlePage("SIG-A"),
  "https://news.google.com/rss/articles/BBB222": () => html("<html><body>consent wall</body></html>"),
  "https://news.google.com/_/DotsSplashUi/data/batchexecute": () => batchAnswer("https://times.example.org/rust-2?utm_source=gn"),
};

describe("collectNews with Google News", () => {
  it("searches with the query, the window and the language and region", async () => {
    const { fetcher, requests } = setup(googleRoutes);
    await collectNews({ fetcher, engine: "google-news", maxResultsPerQuery: 20, isSeen: () => false }, "rust release", locale, window);
    const url = new URL(requests[0]!.url);
    expect(url.origin + url.pathname).toBe("https://news.google.com/rss/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "rust release when:1d", hl: "en", gl: "US", ceid: "US:en" });
  });

  it("uses the language and region it is given, so a topic can search another market", async () => {
    const { fetcher, requests } = setup(googleRoutes);
    await collectNews({ fetcher, engine: "google-news", maxResultsPerQuery: 20, isSeen: () => false }, "脆弱性", { language: "ja", region: "JP" }, window);
    expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toMatchObject({ hl: "ja", gl: "JP", ceid: "JP:ja" });
  });

  it("resolves a redirect link to the URL of the original page", async () => {
    const { fetcher } = setup(googleRoutes);
    const candidates = await collectNews({ fetcher, engine: "google-news", maxResultsPerQuery: 20, isSeen: () => false }, "rust release", locale, window);
    expect(candidates[0]).toEqual({
      url: "https://times.example.org/rust-2",
      aliases: ["https://news.google.com/rss/articles/AAA111"],
      fetchable: true,
      title: "Rust 2.0 released",
      snippet: "",
      siteName: "Example Times",
      publishedAt: new Date("2026-03-01T09:00:00Z"),
      sourceKind: "news-search",
    });
  });

  it("keeps the redirect link, marked as not fetchable, when it cannot be resolved", async () => {
    const { fetcher } = setup(googleRoutes);
    const candidates = await collectNews({ fetcher, engine: "google-news", maxResultsPerQuery: 20, isSeen: () => false }, "rust release", locale, window);
    expect(candidates[1]).toMatchObject({
      url: "https://news.google.com/rss/articles/BBB222",
      fetchable: false,
      title: "Older coverage",
      siteName: "Example Daily",
    });
  });

  it("leaves out results published before the window", async () => {
    const { fetcher } = setup(googleRoutes);
    const candidates = await collectNews({ fetcher, engine: "google-news", maxResultsPerQuery: 20, isSeen: () => false }, "rust release", locale, window);
    expect(candidates.map((candidate) => candidate.title)).toEqual(["Rust 2.0 released", "Older coverage"]);
  });

  it("takes only the newest results up to the limit per query", async () => {
    const { fetcher } = setup(googleRoutes);
    const candidates = await collectNews({ fetcher, engine: "google-news", maxResultsPerQuery: 1, isSeen: () => false }, "rust release", locale, window);
    expect(candidates.map((candidate) => candidate.title)).toEqual(["Rust 2.0 released"]);
  });

  it("does not resolve a result that an earlier run already settled", async () => {
    const { fetcher, urls } = setup(googleRoutes);
    const candidates = await collectNews(
      { fetcher, engine: "google-news", maxResultsPerQuery: 20, isSeen: (url) => url === "https://news.google.com/rss/articles/AAA111" },
      "rust release",
      locale,
      window,
    );
    expect(candidates.map((candidate) => candidate.title)).toEqual(["Older coverage"]);
    expect(urls().some((url) => url.includes("AAA111"))).toBe(false);
  });

  it("fails when the search answers with an error status", async () => {
    const { fetcher } = setup({});
    await expect(
      collectNews({ fetcher, engine: "google-news", maxResultsPerQuery: 20, isSeen: () => false }, "q", locale, window),
    ).rejects.toThrow(/HTTP status 404/);
  });
});

describe("collectNews with Bing News", () => {
  it("reads the original URL, source name and snippet from the result", async () => {
    const { fetcher, requests } = setup({ "https://www.bing.com/news/search": () => xml(BING) });
    const candidates = await collectNews({ fetcher, engine: "bing-news", maxResultsPerQuery: 20, isSeen: () => false }, "rust release", locale, window);
    expect(candidates).toEqual([
      {
        url: "https://times.example.org/rust-2?id=1",
        aliases: [],
        fetchable: true,
        title: "Rust 2.0 released",
        snippet: "The Rust team shipped version 2.0 today.",
        siteName: "Example Times",
        publishedAt: new Date("2026-03-01T09:00:00Z"),
        sourceKind: "news-search",
      },
    ]);
    expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toMatchObject({ q: "rust release", format: "rss", setlang: "en", cc: "US" });
  });
});
