import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const FEED = "https://blog.example.org/feed.xml";
const HOUR = 3_600_000;

function rss(title: string, items: Array<{ key: string; title?: string; published?: string }>): string {
  const body = items
    .map(
      (item) =>
        `<item><title>${item.title ?? item.key}</title><guid>${item.key}</guid><link>https://blog.example.org/${item.key}</link>` +
        `<description>&lt;p&gt;About ${item.key}.&lt;/p&gt;</description><pubDate>${new Date(item.published ?? "2026-03-01T11:00:00.000Z").toUTCString()}</pubDate></item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://blog.example.org/</link>${body}</channel></rss>`;
}

describe("subscribed feeds", () => {
  it("registers a feed and lists it with its category, interval and fetch state", async () => {
    const s = testServer();
    const category = s.category("Tools");
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }, { key: "b" }]));

    const created = await s.post("/api/v1/feeds", { url: FEED, categoryId: category.id });

    expect(created.status).toBe(201);
    const list = await (await s.get("/api/v1/feeds")).json();
    expect(list).toEqual([
      expect.objectContaining({
        url: FEED,
        title: "Example Blog",
        categoryId: category.id,
        intervalMinutes: null,
        enabled: true,
        lastSucceededAt: "2026-03-01T12:00:00.000Z",
        lastError: null,
        nextFetchAt: "2026-03-01T12:30:00.000Z",
        articleCount: 2,
      }),
    ]);
  });

  it("refuses a URL that is not a feed with 400 and the field", async () => {
    const s = testServer();
    s.site.set(FEED, () => new Response("<html>hello</html>", { headers: { "content-type": "text/html" } }));
    const response = await s.post("/api/v1/feeds", { url: FEED });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual([{ path: "url", message: expect.stringMatching(/not a feed/) }]);
    expect(await (await s.get("/api/v1/feeds")).json()).toEqual([]);
  });

  it("refuses a destination on a private network without a request", async () => {
    const s = testServer();
    const response = await s.post("/api/v1/feeds", { url: "http://10.0.0.5/feed.xml" });
    expect(response.status).toBe(400);
    expect(s.site.requests).toEqual([]);
  });

  it("refuses a second registration of the same URL with 409", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    await s.post("/api/v1/feeds", { url: FEED });
    expect((await s.post("/api/v1/feeds", { url: FEED })).status).toBe(409);
  });

  it("refuses an event category and an interval outside five minutes to one day", async () => {
    const s = testServer();
    const events = s.category("Events", "event");
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    expect((await s.post("/api/v1/feeds", { url: FEED, categoryId: events.id })).status).toBe(400);
    const short = await s.post("/api/v1/feeds", { url: FEED, intervalMinutes: 1 });
    expect(short.status).toBe(400);
    expect((await short.json()).error.fields).toEqual([{ path: "intervalMinutes", message: "must be between 5 and 1440 minutes" }]);
    expect((await s.post("/api/v1/feeds", { url: FEED, intervalMinutes: 1441 })).status).toBe(400);
  });

  it("changes the name, the category, the interval and whether it is enabled", async () => {
    const s = testServer();
    const category = s.category("Tools");
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();

    const response = await s.patch(`/api/v1/feeds/${feed.id}`, { title: "Mine", categoryId: category.id, intervalMinutes: 120, enabled: false });

    expect(await response.json()).toMatchObject({ title: "Mine", categoryId: category.id, intervalMinutes: 120, enabled: false, nextFetchAt: null });
    const articles = await (await s.get(`/api/v1/articles?category=${category.id}`)).json();
    expect(articles.items).toHaveLength(1);
  });

  it("deletes a feed with its articles", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    expect((await s.delete(`/api/v1/feeds/${feed.id}`)).status).toBe(204);
    expect((await (await s.get("/api/v1/articles")).json()).items).toEqual([]);
    expect((await s.get(`/api/v1/feeds/${feed.id}`)).status).toBe(404);
  });

  it("fetches a feed at once and reports what the fetch did", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    s.clock.advance(60_000);
    s.site.set(FEED, rss("Example Blog", [{ key: "b" }, { key: "a" }]));

    const response = await s.post(`/api/v1/feeds/${feed.id}/fetch`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "updated", created: 1, feed: { id: feed.id, articleCount: 2, lastSucceededAt: "2026-03-01T12:01:00.000Z" } });
  });

  it("reports a failed fetch in the answer and on the feed, not as an error status", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    s.site.set(FEED, () => new Response("down", { status: 503 }));

    const body = await (await s.post(`/api/v1/feeds/${feed.id}/fetch`)).json();

    expect(body).toMatchObject({ status: "failed", created: 0, feed: { lastError: expect.stringMatching(/503/), failureCount: 1 } });
  });

  it("answers 404 for a feed that does not exist", async () => {
    const s = testServer();
    expect((await s.post("/api/v1/feeds/41/fetch")).status).toBe(404);
    expect((await s.patch("/api/v1/feeds/41", { enabled: false })).status).toBe(404);
    expect((await s.delete("/api/v1/feeds/41")).status).toBe(404);
  });

  it("looks for the feeds of a page without subscribing", async () => {
    const s = testServer();
    s.site.set("https://blog.example.org/", () =>
      new Response('<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">', { headers: { "content-type": "text/html" } }),
    );
    const response = await s.post("/api/v1/feeds/discover", { url: "https://blog.example.org/" });
    expect(await response.json()).toEqual({ feeds: [{ url: FEED, title: "Posts" }] });
    expect(await (await s.get("/api/v1/feeds")).json()).toEqual([]);
  });

  it("needs the API token", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/feeds", null)).status).toBe(401);
  });

  it("uses no model and leaves the run history alone, however often feeds are fetched", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    for (let round = 0; round < 10; round += 1) {
      s.clock.advance(HOUR);
      s.poller.tick();
      await s.poller.idle();
    }
    await s.post(`/api/v1/feeds/${feed.id}/fetch`);

    expect(s.site.requests.length).toBe(12);
    expect(await (await s.get("/api/v1/runs")).json()).toEqual([]);
    expect((await (await s.get("/api/v1/providers")).json()).llmCallsToday).toBe(0);
  });
});

describe("the base interval", () => {
  it("is thirty minutes at first and can be changed within five minutes to one day", async () => {
    const s = testServer();
    expect((await (await s.get("/api/v1/settings")).json()).feedIntervalMinutes).toBe(30);
    expect((await (await s.patch("/api/v1/settings", { feedIntervalMinutes: 60 })).json()).feedIntervalMinutes).toBe(60);
    expect((await s.patch("/api/v1/settings", { feedIntervalMinutes: 3 })).status).toBe(400);
  });

  it("moves the next fetch of feeds without an interval of their own", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    await s.patch("/api/v1/settings", { feedIntervalMinutes: 60 });
    expect((await (await s.get(`/api/v1/feeds/${feed.id}`)).json()).nextFetchAt).toBe("2026-03-01T13:00:00.000Z");
  });
});

describe("articles of subscribed feeds", () => {
  async function mixed() {
    const s = testServer();
    const tools = s.category("Tools");
    const generated = s.article(tools.id, { importance: 5 });
    s.site.set(FEED, rss("Example Blog", [{ key: "a", published: "2026-03-01T10:00:00.000Z" }, { key: "b", published: "2026-03-01T09:00:00.000Z" }]));
    const inCategory = await (await s.post("/api/v1/feeds", { url: FEED, categoryId: tools.id })).json();
    s.site.set("https://other.example.org/rss", rss("Other", [{ key: "x", published: "2026-03-01T08:00:00.000Z" }]));
    const loose = await (await s.post("/api/v1/feeds", { url: "https://other.example.org/rss" })).json();
    const titles = async (query: string) => (await (await s.get(`/api/v1/articles${query}`)).json()).items.map((item: { title: string }) => item.title);
    return { s, tools, generated, inCategory, loose, titles };
  }

  it("come in the lists mixed with generated articles, newest first, with their origin and feed", async () => {
    const { s, tools, inCategory } = await mixed();
    const body = await (await s.get(`/api/v1/articles?category=${tools.id}`)).json();
    expect(body.items.map((item: { title: string }) => item.title)).toEqual(["Article 1", "a", "b"]);
    expect(body.items[0]).toMatchObject({ origin: "generated", feedId: null, importance: 5 });
    expect(body.items[1]).toMatchObject({ origin: "feed", feedId: inCategory.id, importance: null, author: null, categoryId: tools.id, summary: "About a." });
  });

  it("can be narrowed to an origin, to one feed, and to feeds without a category", async () => {
    const { inCategory, titles } = await mixed();
    expect(await titles("")).toEqual(["Article 1", "a", "b", "x"]);
    expect(await titles("?origin=generated")).toEqual(["Article 1"]);
    expect(await titles("?origin=feed")).toEqual(["a", "b", "x"]);
    expect(await titles(`?feed=${inCategory.id}`)).toEqual(["a", "b"]);
    expect(await titles("?uncategorized=true")).toEqual(["x"]);
  });

  it("are left out when a lower bound of importance is given", async () => {
    const { titles } = await mixed();
    expect(await titles("?minImportance=4")).toEqual(["Article 1"]);
    expect(await titles("?minImportance=1")).toEqual(["Article 1"]);
  });

  it("open with their content, their page as the only reference, and no topics", async () => {
    const { s } = await mixed();
    const [first] = (await (await s.get("/api/v1/articles?origin=feed")).json()).items;
    const article = await (await s.get(`/api/v1/articles/${first.id}`)).json();
    expect(article).toMatchObject({ body: "About a.", origin: "feed", refs: [{ url: "https://blog.example.org/a", siteName: "Example Blog" }], topics: [], primaryUrl: "https://blog.example.org/a" });
  });

  it("can be starred and marked read like any article", async () => {
    const { s, titles } = await mixed();
    const [first] = (await (await s.get("/api/v1/articles?origin=feed")).json()).items;
    await s.patch(`/api/v1/articles/${first.id}`, { starred: true, isRead: true });
    expect(await titles("?starred=true")).toEqual(["a"]);
    expect(await titles("?origin=feed&unread=true")).toEqual(["b", "x"]);
  });

  it("page through a mixed list without repeating or skipping", async () => {
    const s = testServer();
    const tools = s.category("Tools");
    const items = Array.from({ length: 60 }, (_unused, index) => ({ key: `k${index}`, published: new Date(Date.parse("2026-03-01T06:00:00.000Z") + index * 60_000).toISOString() }));
    s.site.set(FEED, rss("Example Blog", items));
    await s.post("/api/v1/feeds", { url: FEED, categoryId: tools.id });
    for (let index = 0; index < 60; index += 1) {
      s.clock.set(new Date(Date.parse("2026-03-01T06:00:30.000Z") + index * 60_000).toISOString());
      s.article(tools.id);
    }
    s.clock.set("2026-03-01T12:00:00.000Z");

    const seen: number[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const body = (await (await s.get(`/api/v1/articles?limit=50${cursor ? `&cursor=${cursor}` : ""}`)).json()) as { items: Array<{ id: number; updatedAt: string }>; nextCursor: string | null };
      sizes.push(body.items.length);
      seen.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
  });

  it("are counted with their category, per feed, and apart when they have no category", async () => {
    const { s, tools, inCategory, loose } = await mixed();
    expect(await (await s.get("/api/v1/counts")).json()).toEqual({
      unread: 4,
      starred: 0,
      generatedUnread: 1,
      uncategorizedUnread: 1,
      categories: [{ categoryId: tools.id, unread: 3, total: 3, generatedUnread: 1, generatedTotal: 1 }],
      feeds: [
        { feedId: inCategory.id, unread: 2 },
        { feedId: loose.id, unread: 1 },
      ],
    });
  });

  it("are marked read all at once by feed, by origin, or by having no category", async () => {
    const { s, tools, inCategory, titles } = await mixed();
    const before = "2026-03-01T12:00:01.000Z";

    expect((await (await s.post("/api/v1/articles/mark-read", { feedId: inCategory.id, before })).json()).updated).toBe(2);
    expect(await titles("?unread=true")).toEqual(["Article 1", "x"]);

    expect((await (await s.post("/api/v1/articles/mark-read", { uncategorized: true, before })).json()).updated).toBe(1);
    expect(await titles("?unread=true")).toEqual(["Article 1"]);

    expect((await (await s.post("/api/v1/articles/mark-read", { categoryId: tools.id, origin: "generated", before })).json()).updated).toBe(1);
    expect(await titles("?unread=true")).toEqual([]);
  });

  it("stay out of the RSS output, per category and overall", async () => {
    const { s } = await mixed();
    for (const file of ["tools", "all"]) {
      const xml = await (await s.get(`/rss/${file}.xml?token=test-feed-token-0123456789`, null)).text();
      expect(xml.match(/<item>/g)).toHaveLength(1);
      expect(xml).toContain("Article 1");
      expect(xml).not.toContain("blog.example.org");
    }
  });
});

describe("OPML", () => {
  const OPML = `<?xml version="1.0"?><opml version="2.0"><body>
    <outline text="Tools"><outline type="rss" text="A" xmlUrl="https://a.example.org/feed.xml"/></outline>
    <outline type="rss" text="B" xmlUrl="https://b.example.org/feed.xml"/>
  </body></opml>`;

  it("loads a document and reports what it registered, skipped and created", async () => {
    const s = testServer();
    const response = await s.post("/api/v1/feeds/opml", OPML);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ feedsCreated: 2, feedsSkipped: 0, categoriesCreated: 1 });
    expect(await (await s.post("/api/v1/feeds/opml", OPML)).json()).toEqual({ feedsCreated: 0, feedsSkipped: 2, categoriesCreated: 0 });
    // Loading does not fetch: the feeds wait for their turn.
    expect(s.site.requests).toEqual([]);
  });

  it("writes the subscribed feeds as a document that loads again", async () => {
    const s = testServer();
    await s.post("/api/v1/feeds/opml", OPML);
    const response = await s.get("/api/v1/feeds/opml");
    expect(response.headers.get("content-type")).toMatch(/^text\/x-opml/);
    const text = await response.text();
    expect(text).toContain('xmlUrl="https://a.example.org/feed.xml"');
    expect(text).toContain('<outline text="Tools" title="Tools">');
  });

  it("refuses a document that is not OPML with 400", async () => {
    const s = testServer();
    expect((await s.post("/api/v1/feeds/opml", "<rss/>")).status).toBe(400);
    expect(await (await s.get("/api/v1/feeds")).json()).toEqual([]);
  });
});

describe("summaries of a subscribed feed", () => {
  it("are off for a feed registered without saying so, and can be switched on and off by a change", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const created = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    expect(created.autoSummarize).toBe(false);

    const changed = await s.patch(`/api/v1/feeds/${created.id}`, { autoSummarize: true });
    expect(changed.status).toBe(200);
    expect((await changed.json()).autoSummarize).toBe(true);
    expect(await (await s.get("/api/v1/feeds")).json()).toEqual([expect.objectContaining({ id: created.id, autoSummarize: true })]);

    await s.patch(`/api/v1/feeds/${created.id}`, { autoSummarize: false });
    expect((await (await s.get(`/api/v1/feeds/${created.id}`)).json()).autoSummarize).toBe(false);
  });

  it("can be switched on at registration", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const created = await s.post("/api/v1/feeds", { url: FEED, autoSummarize: true });
    expect(created.status).toBe(201);
    expect((await created.json()).autoSummarize).toBe(true);
    expect(await (await s.get("/api/v1/feeds")).json()).toEqual([expect.objectContaining({ autoSummarize: true })]);
  });

  it("refuses a value that is not true or false with 400", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const created = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    expect((await s.patch(`/api/v1/feeds/${created.id}`, { autoSummarize: "yes" })).status).toBe(400);
  });
});

describe("the summary of an article", () => {
  const LONG = "A sentence of the page that the summary is written from. ".repeat(8);
  const page = () => new Response(`<html><head><title>a</title></head><body><article><h1>a</h1><p>${LONG}</p><p>${LONG}</p></article></body></html>`, { headers: { "content-type": "text/html" } });

  /** A feed that summarises, and one article it delivered afterwards. */
  async function delivered(s: ReturnType<typeof testServer>) {
    s.site.set(FEED, rss("Example Blog", []));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED, autoSummarize: true })).json();
    s.clock.advance(HOUR);
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    await s.post(`/api/v1/feeds/${feed.id}/fetch`);
    const list = await (await s.get(`/api/v1/articles?feed=${feed.id}`)).json();
    return { feed, id: list.items[0].id as number };
  }

  it("is absent and waited for on a feed article that was just delivered", async () => {
    const s = testServer();
    const { id } = await delivered(s);
    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({ autoSummary: null, autoSummaryPending: true });
  });

  it("comes with what it was written from and when, once it is made", async () => {
    const s = testServer(undefined, { summarize: () => ({ summary: "What the page says." }) });
    s.site.set("https://blog.example.org/a", page);
    const { id } = await delivered(s);
    s.clock.advance(HOUR);
    s.summarizer.tick();
    await s.summarizer.idle();

    const article = await (await s.get(`/api/v1/articles/${id}`)).json();
    expect(article.autoSummary).toEqual({ text: "What the page says.", source: "page", createdAt: s.clock().toISOString() });
    expect(article.autoSummaryPending).toBe(false);
    // The content stays what the feed delivered.
    expect(article.body).toContain("About a.");
    expect(article.body).not.toContain("A sentence of the page");
  });

  it("is absent and not waited for on a feed article of a feed without summaries, and on a generated article", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    const list = await (await s.get(`/api/v1/articles?feed=${feed.id}`)).json();
    expect(await (await s.get(`/api/v1/articles/${list.items[0].id}`)).json()).toMatchObject({ autoSummary: null, autoSummaryPending: false });

    const generated = s.article(s.category().id);
    expect(await (await s.get(`/api/v1/articles/${generated}`)).json()).toMatchObject({ autoSummary: null, autoSummaryPending: false });
  });

  it("is no longer waited for once the article is read", async () => {
    const s = testServer();
    const { id } = await delivered(s);
    expect((await (await s.patch(`/api/v1/articles/${id}`, { isRead: true })).json()).autoSummaryPending).toBe(false);
    s.summarizer.tick();
    await s.summarizer.idle();
    expect(s.llmRequests.summarize).toEqual([]);
  });
});

describe("how up to date a feed is, and its stats", () => {
  const DAY = 24 * HOUR;
  const OTHER = "https://news.example.org/feed.xml";

  it("lists whether each feed is stale, when its last new item came, and its articles of the last 30 days", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }, { key: "b" }]));
    s.site.set(OTHER, rss("Other News", [{ key: "x" }]));
    const stopped = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    const subscribedAt = s.clock().toISOString();
    s.clock.advance(60 * DAY);
    const lively = await (await s.post("/api/v1/feeds", { url: OTHER })).json();
    const freshAt = s.clock().toISOString();
    s.clock.advance(DAY + HOUR);

    const list = await (await s.get("/api/v1/feeds")).json();

    expect(list).toEqual([
      expect.objectContaining({ id: stopped.id, stale: true, lastNewItemAt: subscribedAt, recentArticleCount: 0 }),
      expect.objectContaining({ id: lively.id, stale: false, lastNewItemAt: freshAt, recentArticleCount: 1 }),
    ]);
    expect(await (await s.get(`/api/v1/feeds/${stopped.id}`)).json()).toMatchObject({ stale: true });
  });

  it("answers the stats of the last 30 days, and 404 for a feed that does not exist", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }, { key: "b" }, { key: "c" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    const subscribedAt = s.clock().toISOString();
    const items = (await (await s.get(`/api/v1/articles?feed=${feed.id}`)).json()).items as Array<{ id: number }>;
    await s.post(`/api/v1/articles/${items[0]!.id}/open`);
    await s.patch(`/api/v1/articles/${items[1]!.id}`, { starred: true });
    s.clock.advance(HOUR);

    const response = await s.get(`/api/v1/feeds/${feed.id}/stats`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      since: new Date(s.clock().getTime() - 30 * DAY).toISOString(),
      received: 3,
      opened: 1,
      starred: 1,
      hiddenByFilters: 0,
      hiddenAsDuplicates: 0,
      lastNewItemAt: subscribedAt,
    });
    expect((await s.get("/api/v1/feeds/999/stats")).status).toBe(404);
  });

  it("calls no model to find new items, judge staleness or count the stats", async () => {
    const s = testServer();
    s.site.set(FEED, rss("Example Blog", [{ key: "a" }]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    s.site.set(FEED, rss("Example Blog", [{ key: "b" }, { key: "a" }]));
    s.clock.advance(HOUR);
    await s.post(`/api/v1/feeds/${feed.id}/fetch`);
    await s.get(`/api/v1/feeds/${feed.id}/stats`);
    await s.get("/api/v1/feeds");

    expect(Object.values(s.llmRequests).flat()).toEqual([]);
    expect((await (await s.get("/api/v1/providers")).json()).llmCallsToday).toBe(0);
  });
});
