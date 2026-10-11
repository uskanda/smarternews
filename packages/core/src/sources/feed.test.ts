import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeFetch, xml } from "../testing/http.ts";
import { collectFeed, parseFeed, parseSubscription } from "./feed.ts";

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

const RSS_FULL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Example Releases</title>
  <link>https://example.org/releases/</link>
  <item>
    <title>Version 3</title>
    <link>https://example.org/releases/3?utm_source=rss</link>
    <guid isPermaLink="false">release-3</guid>
    <dc:creator>Alex Writer</dc:creator>
    <description>Short note.</description>
    <content:encoded><![CDATA[<p>Version 3 is <b>out</b>.</p><p>Second paragraph.</p>]]></content:encoded>
    <pubDate>Sun, 01 Mar 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Version 2</title>
    <link>https://example.org/releases/2</link>
    <author>editor@example.org (Sam Editor)</author>
    <description>&lt;p&gt;Only a description.&lt;/p&gt;</description>
  </item>
</channel></rss>`;

const ATOM_FULL = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Notes</title>
  <link rel="self" href="https://example.net/atom.xml"/>
  <link rel="alternate" href="https://example.net/"/>
  <entry>
    <id>tag:example.net,2026:1</id>
    <title>First note</title>
    <link rel="alternate" href="https://example.net/notes/1"/>
    <author><name>Kim Author</name></author>
    <content type="html">&lt;p&gt;Escaped &lt;em&gt;markup&lt;/em&gt;.&lt;/p&gt;</content>
    <updated>2026-03-01T10:30:00Z</updated>
  </entry>
  <entry>
    <id>tag:example.net,2026:2</id>
    <title>Second note</title>
    <link href="https://example.net/notes/2"/>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Inline <a href="https://example.net/x">link</a> here.</p></div></content>
    <updated>2026-03-01T11:00:00Z</updated>
  </entry>
  <entry>
    <id>tag:example.net,2026:3</id>
    <title>Third note</title>
    <link href="https://example.net/notes/3"/>
    <summary>Only a summary.</summary>
    <updated>2026-03-01T12:00:00Z</updated>
  </entry>
</feed>`;

describe("parseSubscription", () => {
  it("reads the identifier, the author and the full content of RSS 2.0 items", () => {
    const feed = parseSubscription(RSS_FULL);
    expect(feed.title).toBe("Example Releases");
    expect(feed.siteUrl).toBe("https://example.org/releases/");
    expect(feed.items[0]).toEqual({
      title: "Version 3",
      url: "https://example.org/releases/3?utm_source=rss",
      snippet: "Short note.",
      publishedAt: new Date("2026-03-01T09:00:00Z"),
      key: "release-3",
      author: "Alex Writer",
      contentHtml: "<p>Version 3 is <b>out</b>.</p><p>Second paragraph.</p>",
    });
    expect(feed.items[1]).toMatchObject({ key: null, author: "Sam Editor", contentHtml: "<p>Only a description.</p>", publishedAt: null });
  });

  it("reads the identifier of RSS 1.0 items from rdf:about", () => {
    const [item] = parseSubscription(RDF).items;
    expect(item).toMatchObject({ key: "https://example.com/advisory/7", author: null, contentHtml: "Details of advisory 7." });
  });

  it("reads the id, the author and the content of Atom entries", () => {
    const feed = parseSubscription(ATOM_FULL);
    expect(feed.siteUrl).toBe("https://example.net/");
    expect(feed.items.map((item) => item.key)).toEqual(["tag:example.net,2026:1", "tag:example.net,2026:2", "tag:example.net,2026:3"]);
    expect(feed.items[0]).toMatchObject({ author: "Kim Author", contentHtml: "<p>Escaped <em>markup</em>.</p>" });
    expect(feed.items[2]).toMatchObject({ author: null, contentHtml: "Only a summary." });
  });

  it("keeps the order of text and elements in XHTML content", () => {
    const item = parseSubscription(ATOM_FULL).items[1]!;
    expect(item.contentHtml).toContain('<p>Inline <a href="https://example.net/x">link</a> here.</p>');
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
