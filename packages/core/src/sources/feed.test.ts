import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeFetch, xml } from "../testing/http.ts";
import { collectFeed, parseFeed } from "./feed.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example Security</title>
  <link>https://example.org/</link>
  <item>
    <title>Patch released for &lt;widget&gt; &amp; friends</title>
    <link>https://example.org/patch?utm_source=rss</link>
    <description><![CDATA[<p>The vendor <b>fixed</b> the flaw.</p>]]></description>
    <pubDate>Sun, 01 Mar 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Old story</title>
    <link>https://example.org/old</link>
    <description>Three days old.</description>
    <pubDate>Thu, 26 Feb 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>No date</title>
    <link>https://example.org/undated</link>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Blog</title>
  <entry>
    <title type="html">Release 2.0</title>
    <link rel="self" href="https://example.net/api/entry/1"/>
    <link rel="alternate" type="text/html" href="https://example.net/release-2"/>
    <summary>What is new in 2.0.</summary>
    <updated>2026-03-01T10:30:00Z</updated>
    <published>2026-03-01T08:00:00Z</published>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.com/rss"><title>Example Advisories</title></channel>
  <item rdf:about="https://example.com/advisory/7">
    <title>Advisory 7</title>
    <link>https://example.com/advisory/7</link>
    <description>Details of advisory 7.</description>
    <dc:date>2026-03-01T05:00:00+09:00</dc:date>
  </item>
</rdf:RDF>`;

describe("parseFeed", () => {
  it("reads RSS 2.0 items with decoded titles and plain-text snippets", () => {
    const feed = parseFeed(RSS);
    expect(feed.title).toBe("Example Security");
    expect(feed.items[0]).toEqual({
      title: "Patch released for <widget> & friends",
      url: "https://example.org/patch?utm_source=rss",
      snippet: "The vendor fixed the flaw.",
      publishedAt: new Date("2026-03-01T09:00:00Z"),
    });
    expect(feed.items[2]).toMatchObject({ title: "No date", publishedAt: null, snippet: "" });
  });

  it("reads Atom entries, taking the alternate link and the published time", () => {
    expect(parseFeed(ATOM)).toEqual({
      title: "Example Blog",
      items: [
        {
          title: "Release 2.0",
          url: "https://example.net/release-2",
          snippet: "What is new in 2.0.",
          publishedAt: new Date("2026-03-01T08:00:00Z"),
        },
      ],
    });
  });

  it("reads RSS 1.0 items with their dc:date", () => {
    expect(parseFeed(RDF).items).toEqual([
      {
        title: "Advisory 7",
        url: "https://example.com/advisory/7",
        snippet: "Details of advisory 7.",
        publishedAt: new Date("2026-02-28T20:00:00Z"),
      },
    ]);
  });

  it("refuses a document that is not a feed", () => {
    expect(() => parseFeed("<html><body>hello</body></html>")).toThrow(/not a feed/);
  });
});

describe("collectFeed", () => {
  const fetcher = (routes: Parameters<typeof fakeFetch>[0]) =>
    new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 100000, fetchImpl: fakeFetch(routes).fetchImpl });

  it("turns the items published inside the window into candidates", async () => {
    const since = new Date("2026-02-28T12:00:00Z"); // 24 hours before noon on March 1
    const candidates = await collectFeed(fetcher({ "https://example.org/feed.xml": () => xml(RSS) }), "https://example.org/feed.xml", since);
    expect(candidates.map((candidate) => candidate.title)).toEqual(["Patch released for <widget> & friends", "No date"]);
    expect(candidates[0]).toEqual({
      url: "https://example.org/patch",
      aliases: [],
      fetchable: true,
      title: "Patch released for <widget> & friends",
      snippet: "The vendor fixed the flaw.",
      siteName: "Example Security",
      publishedAt: new Date("2026-03-01T09:00:00Z"),
      sourceKind: "feed",
    });
  });

  it("keeps every item when there is no window", async () => {
    const candidates = await collectFeed(fetcher({ "https://example.org/feed.xml": () => xml(RSS) }), "https://example.org/feed.xml", null);
    expect(candidates).toHaveLength(3);
  });

  it("fails when the feed answers with an error status", async () => {
    await expect(collectFeed(fetcher({}), "https://example.org/feed.xml", null)).rejects.toThrow(/HTTP status 404/);
  });
});
