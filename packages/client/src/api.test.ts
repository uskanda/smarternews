import { API_TOKEN, testServer } from "@smarternews/server/testing";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api.ts";

function setup(token: string | null = API_TOKEN) {
  const server = testServer();
  const onUnauthorized = vi.fn();
  const seen: Array<{ url: string; authorization: string | null }> = [];
  const api = createApi({
    fetchImpl: (input, init) => {
      seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
      return server.app.request(String(input), init);
    },
    getToken: () => token,
    onUnauthorized,
  });
  return { server, api, onUnauthorized, seen };
}

describe("the API client", () => {
  it("calls the server at the base URL it was given", async () => {
    const server = testServer();
    const seen: string[] = [];
    const api = createApi({
      baseUrl: "http://news.example:8787",
      fetchImpl: (input, init) => {
        seen.push(String(input));
        return server.app.request(new URL(String(input)).pathname, init);
      },
      getToken: () => API_TOKEN,
      onUnauthorized: () => {},
    });
    await api.categories();
    expect(seen).toEqual(["http://news.example:8787/api/v1/categories"]);
  });

  it("ignores a slash at the end of the base URL", async () => {
    const seen: string[] = [];
    const api = createApi({
      baseUrl: "http://news.example:8787/",
      fetchImpl: (input) => {
        seen.push(String(input));
        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
      getToken: () => null,
      onUnauthorized: () => {},
    });
    await api.categories();
    expect(seen).toEqual(["http://news.example:8787/api/v1/categories"]);
  });

  it("sends the stored token as a bearer token", async () => {
    const { api, seen } = setup();
    await api.categories();
    expect(seen[0]).toEqual({ url: "/api/v1/categories", authorization: `Bearer ${API_TOKEN}` });
  });

  it("returns what the server stored, in the shared shape", async () => {
    const { api, server } = setup();
    const created = await api.createCategory({ name: "Security", kind: "news" });
    server.article(created.id, { title: "A story", importance: 4 });

    const list = await api.articles({ category: created.id, unread: "true" });

    expect(created).toMatchObject({ slug: "security", minImportance: 3 });
    expect(list.items).toMatchObject([{ title: "A story", importance: 4, isRead: false }]);
    expect(list.nextCursor).toBeNull();
  });

  it("reports a refused value with the field and the reason", async () => {
    const { api, server } = setup();
    const category = server.category();
    const error = await api.updateCategory(category.id, { minImportance: 9 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "invalid", status: 400, fields: [{ path: "minImportance" }] });
  });

  it("tells a missing object from a conflict", async () => {
    const { api, server } = setup();
    server.category("Security");
    await expect(api.article(4242)).rejects.toMatchObject({ kind: "not_found" });
    await expect(api.createCategory({ name: "Other", slug: "security", kind: "news" })).rejects.toMatchObject({ kind: "conflict" });
  });

  it("reports an unreachable server as a network failure", async () => {
    const api = createApi({
      fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
      getToken: () => API_TOKEN,
      onUnauthorized: () => {},
    });
    await expect(api.categories()).rejects.toMatchObject({ kind: "network", status: null });
  });

  it("announces a rejected token so that the app can ask for a new one", async () => {
    const { api, onUnauthorized } = setup("wrong-token");
    await expect(api.categories()).rejects.toMatchObject({ kind: "unauthorized" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("checks a candidate token without touching the stored one", async () => {
    const { api, onUnauthorized } = setup(null);
    await expect(api.verifyToken(API_TOKEN)).resolves.toBe(true);
    await expect(api.verifyToken("wrong")).resolves.toBe(false);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("passes list filters as query parameters and leaves out the unset ones", async () => {
    const { api, seen } = setup();
    await api.articles({ unread: "true", minImportance: 4, limit: 50 });
    const url = new URL(seen[0]!.url, "http://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({ unread: "true", minImportance: "4", limit: "50" });
  });

  it("downloads the settings file as text and uploads it back", async () => {
    const { api, server } = setup();
    server.category("Security");
    const text = await api.exportSettings();
    expect(text).toContain("slug: security");
    await expect(api.importSettings(text)).resolves.toEqual({ categoriesCreated: 0, categoriesUpdated: 1, topicsCreated: 0, topicsUpdated: 0, feedsCreated: 0, feedsUpdated: 0, filtersCreated: 0 });
  });

  it("subscribes to a feed, changes it, fetches it now and deletes it", async () => {
    const { api, server } = setup();
    const url = "https://blog.example.org/feed.xml";
    server.site.set(url, `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><item><title>One</title><guid>1</guid><link>https://blog.example.org/1</link></item></channel></rss>`);
    server.site.set("https://blog.example.org/", () =>
      new Response('<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">', { headers: { "content-type": "text/html" } }),
    );

    expect(await api.discoverFeeds("https://blog.example.org/")).toEqual({ feeds: [{ url, title: "Posts" }] });
    const feed = await api.createFeed({ url });
    expect(feed).toMatchObject({ title: "Blog", articleCount: 1 });
    expect(await api.feeds()).toHaveLength(1);
    expect((await api.updateFeed(feed.id, { title: "Mine", enabled: false })).title).toBe("Mine");
    expect(await api.fetchFeed(feed.id)).toMatchObject({ status: "updated", created: 0, feed: { id: feed.id } });
    expect((await api.articles({ feed: feed.id, origin: "feed" })).items.map((item) => item.title)).toEqual(["One"]);
    expect((await api.counts()).feeds).toEqual([{ feedId: feed.id, unread: 1 }]);
    expect(await api.markRead({ feedId: feed.id, before: "2099-01-01T00:00:00.000Z" })).toMatchObject({ updated: 1 });

    await api.deleteFeed(feed.id);
    expect(await api.feeds()).toEqual([]);
  });

  it("downloads the subscribed feeds as OPML and uploads the document back", async () => {
    const { api, server, seen } = setup();
    server.site.set("https://blog.example.org/feed.xml", `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title></channel></rss>`);
    await api.createFeed({ url: "https://blog.example.org/feed.xml" });

    const text = await api.exportOpml();
    expect(text).toContain('xmlUrl="https://blog.example.org/feed.xml"');
    expect(await api.importOpml(text)).toEqual({ feedsCreated: 0, feedsSkipped: 1, categoriesCreated: 0 });
    expect(seen.at(-1)!.url).toBe("/api/v1/feeds/opml");
  });

  it("adds a filter, tries one, changes, lists and removes it, on the paths of the filters", async () => {
    const { api, seen } = setup();
    const at = () => seen.at(-1)!.url;
    const conditions = [{ fields: ["title" as const], match: "contains" as const, value: "sponsored" }];

    const filter = await api.createFilter({ action: "hide", scope: { type: "all" }, conditions });
    expect([at(), filter]).toEqual(["/api/v1/filters", expect.objectContaining({ action: "hide", enabled: true, hiddenCount: 0 })]);
    expect(await api.previewFilter({ action: "hide", scope: { type: "all" }, conditions, id: filter.id })).toEqual({ hiddenCount: 0 });
    expect(at()).toBe("/api/v1/filters/preview");
    expect(await api.updateFilter(filter.id, { enabled: false })).toMatchObject({ enabled: false, restored: 0 });
    expect(at()).toBe(`/api/v1/filters/${filter.id}`);
    expect(await api.filters()).toHaveLength(1);
    expect(at()).toBe("/api/v1/filters");
    expect(await api.filterArticles(filter.id, { limit: 10 })).toEqual({ items: [], nextCursor: null });
    expect(at()).toBe(`/api/v1/filters/${filter.id}/articles?limit=10`);
    expect(await api.deleteFilter(filter.id)).toEqual({ restored: 0 });
    expect(at()).toBe(`/api/v1/filters/${filter.id}`);
    await expect(api.createFilter({ action: "keep", scope: { type: "all" }, conditions })).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("moving categories and feeds", () => {
  it("moves a category and a feed, and reads the move-on setting", async () => {
    const { server, api } = setup();
    const a = server.category("A");
    const b = server.category("B");
    expect((await api.moveCategory(b.id, a.id)).map((category) => category.name)).toEqual(["B", "A"]);

    server.site.set("https://blog.example.org/feed.xml", `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title></channel></rss>`);
    const feed = await api.createFeed({ url: "https://blog.example.org/feed.xml", categoryId: a.id });
    const moved = await api.moveFeed(feed.id, { categoryId: b.id, before: null });
    expect(moved.map((entry) => entry.categoryId)).toEqual([b.id]);

    expect((await api.settings()).advanceAfterMarkAll).toBe(true);
    expect((await api.updateSettings({ advanceAfterMarkAll: false })).advanceAfterMarkAll).toBe(false);
  });

  describe("translation", () => {
    const FEED = "https://blog.example.org/feed.xml";
    const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><item><title>A title</title><guid>a</guid><link>https://blog.example.org/a</link><description>One paragraph.</description></item></channel></rss>';

    async function translating(options: Parameters<typeof testServer>[1] = {}) {
      const server = testServer(undefined, options);
      const api = createApi({ fetchImpl: (input, init) => server.app.request(String(input), init), getToken: () => API_TOKEN, onUnauthorized: () => {} });
      server.site.set(FEED, rss);
      const feed = await api.createFeed({ url: FEED, translate: true });
      return { server, api, feed };
    }

    it("sends the setting of a feed, and reads the translated title and whether an article can be translated", async () => {
      const { api, feed } = await translating();
      expect(feed.translate).toBe(true);
      const [item] = (await api.articles({ feed: feed.id })).items;
      expect(item).toMatchObject({ title: "A title", translatedTitle: "訳:A title" });
      expect(await api.article(item!.id)).toMatchObject({ translatable: true, translation: null });
      expect((await api.updateFeed(feed.id, { translate: false })).translate).toBe(false);
    });

    it("asks for the translation of an article and reads its segments", async () => {
      const { api, feed } = await translating();
      const [item] = (await api.articles({ feed: feed.id })).items;
      const translation = await api.translateArticle(item!.id);
      expect(translation).toMatchObject({
        translatedTitle: "訳:A title",
        method: "google",
        truncated: false,
        segments: [{ original: "One paragraph.", translated: "訳:One paragraph.", translatedHtml: "<p>訳:One paragraph.</p>" }],
      });
      expect((await api.article(item!.id)).translation).toEqual(translation);
    });

    it("reads how much the translation API was used", async () => {
      const { api } = await translating({ monthlyChars: 1000 });
      expect(await api.translation()).toEqual({ month: "2026-03", chars: "A title".length, monthlyChars: 1000, apiKeyConfigured: true });
    });

    it("reports as unavailable an article that cannot be translated now", async () => {
      const { api, feed } = await translating({ google: null, llmCallsPerDay: 0 });
      const [item] = (await api.articles({ feed: feed.id })).items;
      const failure = await api.translateArticle(item!.id).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({ kind: "unavailable", status: 503 });
    });
  });
});
