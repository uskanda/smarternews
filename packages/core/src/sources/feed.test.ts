import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeFetch, xml } from "../testing/http.ts";
import { collectFeed, MAX_ATTACHMENT_URL_CHARS, MAX_ATTACHMENTS, parseFeed, parseSubscription } from "./feed.ts";

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
      attachments: [],
      description: null,
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

const PODCAST = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Example Cast</title>
  <link>https://example.org/cast/</link>
  <item>
    <title>Episode 12</title>
    <link>https://example.org/cast/12</link>
    <guid>ep-12</guid>
    <description>Show notes.</description>
    <enclosure url="https://cdn.example.org/ep12.mp3" type="audio/mpeg" length="12345678"/>
    <media:content url="covers/ep12.jpg" medium="image" fileSize="2048"><media:title>Cover of episode 12</media:title></media:content>
    <media:content url="https://cdn.example.org/ep12.mp3" type="audio/mpeg"/>
    <media:content url="javascript:alert(1)" type="image/png"/>
    <media:thumbnail url="https://cdn.example.org/ep12-small.jpg"/>
  </item>
  <item>
    <title>Episode 11</title>
    <link>https://example.org/cast/11</link>
    <description>Has content.</description>
    <enclosure url="https://cdn.example.org/ep11.pdf" type="application/pdf" length="0"/>
    <enclosure url="https://cdn.example.org/ep11.mp4" type="video/mp4" length="nope"/>
    <media:description>Not used: the item has content.</media:description>
  </item>
  <item>
    <title>Episode 10</title>
    <link>https://example.org/cast/10</link>
    <media:description>Only a media description.</media:description>
  </item>
</channel></rss>`;

const YOUTUBE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Example Channel</title>
  <link rel="alternate" href="https://www.youtube.com/channel/UC000"/>
  <entry>
    <id>yt:video:abc123</id>
    <title>How the widget works</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <author><name>Example Channel</name></author>
    <published>2026-03-01T08:00:00+00:00</published>
    <media:group>
      <media:title>How the widget works</media:title>
      <media:content url="https://www.youtube.com/v/abc123?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i.example.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
      <media:description>First line.
Second line: https://example.com/more

New paragraph.</media:description>
    </media:group>
  </entry>
</feed>`;

const RDF_MEDIA = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel rdf:about="https://example.com/rss"><title>Example Photos</title></channel>
  <item rdf:about="https://example.com/photo/1">
    <title>Photo 1</title>
    <link>https://example.com/photo/1</link>
    <media:content url="https://example.com/photo/1.jpg" type="image/jpeg">
      <media:description type="html">&lt;p&gt;A &lt;b&gt;photo&lt;/b&gt;.&lt;/p&gt;</media:description>
    </media:content>
  </item>
</rdf:RDF>`;

describe("parseSubscription with enclosures and Media RSS", () => {
  it("reads enclosures, media:content and media:thumbnail, resolving relative URLs against the item's page", () => {
    const [item] = parseSubscription(PODCAST).items;
    expect(item!.attachments).toEqual([
      { url: "https://cdn.example.org/ep12.mp3", kind: "audio", mimeType: "audio/mpeg", size: 12345678, title: null, thumbnail: false },
      { url: "https://example.org/cast/covers/ep12.jpg", kind: "image", mimeType: null, size: 2048, title: "Cover of episode 12", thumbnail: false },
      { url: "https://cdn.example.org/ep12-small.jpg", kind: "image", mimeType: null, size: null, title: null, thumbnail: true },
    ]);
  });

  it("tells the kind by the media type when there is no medium, and drops a size that is not a positive number", () => {
    const item = parseSubscription(PODCAST).items[1]!;
    expect(item.attachments.map(({ kind, size }) => ({ kind, size }))).toEqual([
      { kind: "other", size: null },
      { kind: "video", size: null },
    ]);
  });

  it("uses media:description only when the item has no content", () => {
    const items = parseSubscription(PODCAST).items;
    expect(items[0]!.description).toBeNull();
    expect(items[1]!.description).toBeNull();
    expect(items[2]).toMatchObject({ contentHtml: "", description: { text: "Only a media description.", html: false } });
  });

  it("reads the description, the thumbnail and the content inside a media:group of a video feed", () => {
    const [item] = parseSubscription(YOUTUBE).items;
    expect(item!.contentHtml).toBe("");
    expect(item!.description).toEqual({ text: "First line.\nSecond line: https://example.com/more\n\nNew paragraph.", html: false });
    expect(item!.attachments).toEqual([
      {
        url: "https://www.youtube.com/v/abc123?version=3",
        kind: "other",
        mimeType: "application/x-shockwave-flash",
        size: null,
        title: "How the widget works",
        thumbnail: false,
      },
      { url: "https://i.example.com/vi/abc123/hqdefault.jpg", kind: "image", mimeType: null, size: null, title: "How the widget works", thumbnail: true },
    ]);
  });

  it("reads media:content of RSS 1.0 items, and a description of type html inside it", () => {
    const [item] = parseSubscription(RDF_MEDIA).items;
    expect(item!.attachments).toEqual([
      { url: "https://example.com/photo/1.jpg", kind: "image", mimeType: "image/jpeg", size: null, title: null, thumbnail: false },
    ]);
    expect(item!.description).toEqual({ text: "<p>A <b>photo</b>.</p>", html: true });
  });

  it("keeps a bounded number of attachments, and leaves out URLs that are too long", () => {
    const enclosures = Array.from({ length: 30 }, (_, index) => `<enclosure url="https://cdn.example.org/${index}.mp3" type="audio/mpeg"/>`).join("");
    const long = `<enclosure url="https://cdn.example.org/${"a".repeat(MAX_ATTACHMENT_URL_CHARS)}.mp3" type="audio/mpeg"/>`;
    const xml = `<rss version="2.0"><channel><title>T</title><item><title>A</title><link>https://example.org/a</link>${long}${enclosures}</item></channel></rss>`;
    const [item] = parseSubscription(xml).items;
    expect(item!.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(item!.attachments[0]!.url).toBe("https://cdn.example.org/0.mp3");
  });

  it("resolves an item whose page is relative against the URL of the feed", () => {
    const xml = `<rss version="2.0"><channel><title>T</title><item><title>A</title><link>/posts/a</link><enclosure url="a.mp3" type="audio/mpeg"/></item></channel></rss>`;
    expect(parseSubscription(xml, "https://example.org/feed.xml").items[0]!.attachments[0]!.url).toBe("https://example.org/posts/a.mp3");
    expect(parseSubscription(xml).items[0]!.attachments).toEqual([]);
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
