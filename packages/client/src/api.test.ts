import { replaceMentions } from "@smarternews/core";
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

  it("asks for the recently read articles, and reads when each was read", async () => {
    const { api, server, seen } = setup();
    const id = server.article(server.category().id, { title: "Read" });
    await api.updateArticle(id, { isRead: true });

    const list = await api.articles({ recentlyRead: "true", limit: 50 });

    expect(Object.fromEntries(new URL(seen.at(-1)!.url, "http://x").searchParams)).toEqual({ recentlyRead: "true", limit: "50" });
    expect(list.items).toMatchObject([{ title: "Read", isRead: true, readAt: server.clock().toISOString() }]);
  });

  it("downloads the settings file as text and uploads it back", async () => {
    const { api, server } = setup();
    server.category("Security");
    const text = await api.exportSettings();
    expect(text).toContain("slug: security");
    await expect(api.importSettings(text)).resolves.toEqual({ categoriesCreated: 0, categoriesUpdated: 1, topicsCreated: 0, topicsUpdated: 0, feedsCreated: 0, feedsUpdated: 0, filtersCreated: 0, termGroupsCreated: 0, highlightTermsCreated: 0, listViewsUpdated: 0 });
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

  it("marks read the articles a screen showed, sending each with its version, and can keep the request alive", async () => {
    const server = testServer();
    const sent: Array<{ body: unknown; keepalive: boolean | undefined }> = [];
    const api = createApi({
      fetchImpl: (input, init) => {
        if (init?.body !== undefined) sent.push({ body: JSON.parse(String(init.body)), keepalive: init.keepalive });
        return server.app.request(String(input), init);
      },
      getToken: () => API_TOKEN,
      onUnauthorized: () => {},
    });
    const category = server.category();
    const ids = [server.article(category.id), server.article(category.id)];
    const shown = (await api.articles({ category: category.id })).items.map((item) => ({ id: item.id, updatedAt: item.updatedAt }));
    sent.length = 0;

    expect(await api.markSeenRead(shown)).toEqual({ updated: 2, ids: [...ids].sort((a, b) => a - b) });
    expect(await api.markSeenRead(shown, { keepalive: true })).toEqual({ updated: 0, ids: [] });
    expect(sent).toEqual([
      { body: { articles: shown }, keepalive: undefined },
      { body: { articles: shown }, keepalive: true },
    ]);
  });

  it("records that an article was opened with a POST to its path, and reads the time", async () => {
    const server = testServer();
    const sent: Array<{ url: string; method: string | undefined }> = [];
    const api = createApi({
      fetchImpl: (input, init) => {
        sent.push({ url: String(input), method: init?.method });
        return server.app.request(String(input), init);
      },
      getToken: () => API_TOKEN,
      onUnauthorized: () => {},
    });
    const id = server.article(server.category().id);

    expect(await api.openArticle(id)).toEqual({ openedAt: server.clock().toISOString() });
    expect(sent.at(-1)).toEqual({ url: `/api/v1/articles/${id}/open`, method: "POST" });
    expect((await api.article(id)).openedAt).toBe(server.clock().toISOString());
    await expect(api.openArticle(999)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("reads the stats of a feed and whether it is stale", async () => {
    const { api, server, seen } = setup();
    const url = "https://blog.example.org/feed.xml";
    server.site.set(url, `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><item><title>One</title><guid>1</guid><link>https://blog.example.org/1</link></item></channel></rss>`);
    const feed = await api.createFeed({ url });
    expect(feed).toMatchObject({ stale: false, lastNewItemAt: server.clock().toISOString(), recentArticleCount: 1 });

    expect(await api.feedStats(feed.id)).toMatchObject({ received: 1, opened: 0, starred: 0, hiddenByFilters: 0, hiddenAsDuplicates: 0 });
    expect(seen.at(-1)!.url).toBe(`/api/v1/feeds/${feed.id}/stats`);
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

describe("searching articles", () => {
  it("sends the query and the narrowing that is given, and reads the result with its terms", async () => {
    const { server, api, seen } = setup();
    const category = server.category();
    const id = server.article(category.id, { title: "電池の話" });

    const result = await api.search({ q: "電池" });
    expect(seen.at(-1)!.url).toBe(`/api/v1/search?q=${encodeURIComponent("電池")}`);
    expect(result).toMatchObject({ items: [{ id, excerpt: null, excerptFromNote: false }], nextCursor: null, terms: ["電池"] });

    // The server refuses a cursor it did not issue; what matters here is what was sent.
    await api.search({ q: "電池 工場", category: 3, feed: 4, unread: "true", cursor: "c", limit: 20 }).catch(() => undefined);
    expect(seen.at(-1)!.url).toBe("/api/v1/search?q=%E9%9B%BB%E6%B1%A0+%E5%B7%A5%E5%A0%B4&category=3&feed=4&unread=true&cursor=c&limit=20");
  });

  it("fails as invalid for an empty query", async () => {
    const { api } = setup();
    await expect(api.search({ q: " " })).rejects.toMatchObject({ kind: "invalid", fields: [{ path: "q", message: "is empty" }] });
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
    expect((await api.settings()).removeDuplicates).toBe(true);
    expect((await api.updateSettings({ removeDuplicates: false })).removeDuplicates).toBe(false);
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
      expect(await api.article(item!.id)).toMatchObject({ translatable: true, translation: null, otherFeeds: [] });
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

  describe("full content", () => {
    const FEED = "https://blog.example.org/feed.xml";
    const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><item><title>A title</title><guid>a</guid><link>https://blog.example.org/a</link><description>One paragraph.</description></item></channel></rss>';
    const LONG = "A sentence of the page that the full content is taken from. ".repeat(8);

    async function subscribed() {
      const server = testServer();
      const api = createApi({ fetchImpl: (input, init) => server.app.request(String(input), init), getToken: () => API_TOKEN, onUnauthorized: () => {} });
      server.site.set(FEED, rss);
      const feed = await api.createFeed({ url: FEED, fetchFullContent: true });
      const [item] = (await api.articles({ feed: feed.id })).items;
      return { server, api, feed, id: item!.id };
    }

    it("sends the setting of a feed, and reads the state of an article", async () => {
      const { api, feed, id } = await subscribed();
      expect(feed.fetchFullContent).toBe(true);
      expect(await api.article(id)).toMatchObject({ fullContent: null, fullContentStatus: "none", fullContentError: null });
      expect((await api.updateFeed(feed.id, { fetchFullContent: false })).fetchFullContent).toBe(false);
    });

    it("asks for the full content of an article and reads it", async () => {
      const { api, server, id } = await subscribed();
      server.site.set(
        "https://blog.example.org/a",
        () => new Response(`<html><body><article><h1>a</h1><p>${LONG}</p><p>${LONG}</p></article></body></html>`, { headers: { "content-type": "text/html" } }),
      );
      const result = await api.fetchFullContent(id);
      expect(result).toMatchObject({ status: "fetched", fullContent: { body: expect.stringContaining("A sentence") } });
      expect((await api.article(id)).fullContentStatus).toBe("fetched");
    });

    it("reads a failure and its reason", async () => {
      const { api, id } = await subscribed();
      expect(await api.fetchFullContent(id)).toEqual({ status: "failed", error: { reason: "http", detail: "404" } });
    });

    it("refuses an answer outside the shape", async () => {
      const api = createApi({
        fetchImpl: async () => new Response(JSON.stringify({ status: "fetched" }), { headers: { "content-type": "application/json" } }),
        getToken: () => API_TOKEN,
        onUnauthorized: () => {},
      });
      await expect(api.fetchFullContent(1)).rejects.toBeInstanceOf(Error);
    });
  });
});

describe("term groups", () => {
  it("adds, lists, changes, moves and removes groups and terms, on the paths of the term groups", async () => {
    const { api, seen } = setup();
    const at = () => seen.at(-1)!.url;

    const a = await api.createTermGroup({ name: "半導体" });
    expect([at(), a]).toEqual(["/api/v1/term-groups", { id: a.id, name: "半導体", color: "green", terms: [] }]);
    const b = await api.createTermGroup({ name: "通商", color: "orange" });
    const withTerm = await api.addHighlightTerm(a.id, { text: "TSMC" });
    expect([at(), withTerm.terms.map((term) => term.text)]).toEqual([`/api/v1/term-groups/${a.id}/terms`, ["TSMC"]]);
    expect(await api.updateTermGroup(a.id, { color: "purple" })).toMatchObject({ color: "purple" });
    expect(at()).toBe(`/api/v1/term-groups/${a.id}`);
    expect((await api.moveTermGroup(b.id, a.id)).map((group) => group.name)).toEqual(["通商", "半導体"]);
    expect(at()).toBe(`/api/v1/term-groups/${b.id}/move`);
    await api.deleteHighlightTerm(a.id, withTerm.terms[0]!.id);
    expect(at()).toBe(`/api/v1/term-groups/${a.id}/terms/${withTerm.terms[0]!.id}`);
    await api.deleteTermGroup(b.id);
    expect(await api.termGroups()).toEqual([{ id: a.id, name: "半導体", color: "purple", terms: [] }]);
    await expect(api.createTermGroup({ name: "半導体" })).rejects.toMatchObject({ kind: "conflict" });
  });

  it("refuses an answer outside the shape, such as a colour the apps do not know", async () => {
    const api = createApi({
      fetchImpl: async () => new Response(JSON.stringify([{ id: 1, name: "A", color: "yellow", terms: [] }]), { headers: { "content-type": "application/json" } }),
      getToken: () => API_TOKEN,
      onUnauthorized: () => {},
    });
    await expect(api.termGroups()).rejects.toBeInstanceOf(Error);
  });
});

describe("list views", () => {
  it("are read, and one entry is changed, in the shared shape", async () => {
    const { api, seen } = setup();
    expect(await api.listViews()).toEqual({ items: [] });
    expect(seen.at(-1)!.url).toBe("/api/v1/list-views");

    expect(await api.updateListView("unread", { sort: "oldest" })).toEqual({ key: "unread", sort: "oldest" });
    expect(seen.at(-1)!.url).toBe("/api/v1/list-views/unread");
    expect(await api.listViews()).toEqual({ items: [{ key: "unread", sort: "oldest" }] });
    await expect(api.updateListView("recently-read", { sort: "oldest" })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("order the article list when the list sends its order, and the answer says when it was read", async () => {
    const { server, api, seen } = setup();
    const category = server.category();
    const older = server.article(category.id);
    server.clock.advance(60_000);
    const newer = server.article(category.id);

    const list = await api.articles({ category: category.id, order: "oldest" });

    expect(seen.at(-1)!.url).toBe(`/api/v1/articles?category=${category.id}&order=oldest`);
    expect(list.items.map((item) => item.id)).toEqual([older, newer]);
    expect(list.asOf).toBe(server.clock().toISOString());
  });
});

describe("annotations", () => {
  const anchor = { quote: "電池の工場", prefix: "同社は", suffix: "を新設する", position: 3 };

  it("adds, changes and removes a highlight, and reads it in the article and the list", async () => {
    const { server, api, seen } = setup();
    const id = server.article(server.category().id);
    const highlight = await api.addHighlight(id, anchor);
    expect(seen.at(-1)!.url).toBe(`/api/v1/articles/${id}/highlights`);
    expect(highlight).toMatchObject({ articleId: id, ...anchor, note: null });
    expect(await api.updateHighlight(highlight.id, "規模を確かめる")).toMatchObject({ note: "規模を確かめる" });
    expect((await api.article(id)).annotations.highlights).toEqual([{ ...highlight, note: "規模を確かめる", updatedAt: expect.any(String) }]);
    expect((await api.annotations({ limit: 10 })).items.map((item) => [item.kind, item.quote, item.note])).toEqual([["highlight", "電池の工場", "規模を確かめる"]]);
    expect(seen.at(-1)!.url).toBe("/api/v1/annotations?limit=10");
    await api.deleteHighlight(highlight.id);
    await expect(api.deleteHighlight(highlight.id)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("saves and removes the note on a whole article", async () => {
    const { server, api } = setup();
    const id = server.article(server.category().id);
    expect(await api.saveArticleNote(id, "あとで比べる")).toMatchObject({ articleId: id, text: "あとで比べる" });
    expect((await api.article(id)).annotations.note?.text).toBe("あとで比べる");
    await api.deleteArticleNote(id);
    expect((await api.article(id)).annotations.note).toBeNull();
    await expect(api.saveArticleNote(id, " ")).rejects.toMatchObject({ kind: "invalid", fields: [{ path: "text", message: "is empty" }] });
  });

  it("refuses an answer that does not have the shape of a highlight", async () => {
    const api = createApi({
      fetchImpl: () => new Response(JSON.stringify({ id: 1 }), { headers: { "content-type": "application/json" } }),
      getToken: () => null,
      onUnauthorized: () => {},
    });
    await expect(api.addHighlight(1, anchor)).rejects.toThrow();
  });
});

describe("the articles of a name", () => {
  it("sends the name, the limit and the cursor, and reads a page in the shape of the article list", async () => {
    const { server, api, seen } = setup();
    const id = server.article(server.category().id, { title: "金融政策" });
    replaceMentions(server.db, id, [{ name: "日本銀行", kind: "organization" }]);

    const page = await api.mentionArticles({ name: "日本銀行" });
    expect(seen.at(-1)!.url).toBe(`/api/v1/mentions/articles?name=${encodeURIComponent("日本銀行")}`);
    expect(page).toMatchObject({ items: [{ id, origin: "generated" }], nextCursor: null });
    expect((await api.article(id)).mentions).toEqual([{ name: "日本銀行", kind: "organization" }]);

    await api.mentionArticles({ name: "日本銀行", cursor: "c", limit: 20 }).catch(() => undefined);
    expect(seen.at(-1)!.url).toBe(`/api/v1/mentions/articles?name=${encodeURIComponent("日本銀行")}&cursor=c&limit=20`);
  });

  it("fails as invalid for a name of spaces only", async () => {
    const { api } = setup();
    await expect(api.mentionArticles({ name: " " })).rejects.toMatchObject({ kind: "invalid", fields: [{ path: "name", message: "is empty" }] });
  });

  it("refuses an answer outside the shape", async () => {
    const api = createApi({
      fetchImpl: async () => new Response(JSON.stringify({ items: [{ id: 1 }], nextCursor: null, asOf: "x" }), { headers: { "content-type": "application/json" } }),
      getToken: () => API_TOKEN,
      onUnauthorized: () => {},
    });
    await expect(api.mentionArticles({ name: "日本銀行" })).rejects.toBeInstanceOf(Error);
  });
});
