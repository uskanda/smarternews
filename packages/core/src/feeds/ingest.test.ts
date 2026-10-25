import { describe, expect, it } from "vitest";
import { getArticle, insertArticle, listArticles, saveFullContent, searchArticles, setArticleFlags } from "../db/articles.ts";
import { createCategory } from "../db/categories.ts";
import { getFeed, insertFeed, listFeeds } from "../db/feeds.ts";
import { updateSettings } from "../db/settings.ts";
import { createFilter } from "../db/filters.ts";
import { Fetcher } from "../fetch/http.ts";
import { purgeExpired } from "../runs/retention.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { fakeFetch, html, xml } from "../testing/http.ts";
import { fakeLlm } from "../testing/llm.ts";
import { fakeTranslator } from "../testing/translation.ts";
import type { Translator } from "../translation/adapter.ts";
import { LlmTranslator } from "../translation/llm.ts";
import { TranslationService } from "../translation/service.ts";
import { fetchFeed, MAX_NEW_ITEMS, subscribe } from "./ingest.ts";

const START = "2026-03-01T12:00:00.000Z";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FEED_URL = "https://example.org/feed.xml";

interface Item {
  key?: string | null;
  title: string;
  link?: string;
  /** ISO time; null for an item without a date. Defaults to one hour before the start. */
  published?: string | null;
  content?: string;
  author?: string;
}

const esc = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function rss(items: Item[], title = "Example Feed"): string {
  const body = items
    .map((item, index) => {
      const published = item.published === undefined ? "2026-03-01T11:00:00.000Z" : item.published;
      return [
        "<item>",
        `<title>${esc(item.title)}</title>`,
        `<link>${esc(item.link ?? `https://example.org/posts/${item.key ?? index}`)}</link>`,
        item.key === null ? "" : `<guid>${esc(item.key ?? `id-${item.title}`)}</guid>`,
        item.author ? `<author>${esc(item.author)}</author>` : "",
        `<description>${esc(item.content ?? `<p>Content of ${item.title}.</p>`)}</description>`,
        published === null ? "" : `<pubDate>${new Date(published).toUTCString()}</pubDate>`,
        "</item>",
      ].join("");
    })
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${esc(title)}</title><link>https://example.org/</link>${body}</channel></rss>`;
}

function setup(initial: Item[] | (() => Response) = []) {
  const db = createTestDb();
  const clock = fakeClock(START);
  let answer: () => Response = typeof initial === "function" ? initial : () => xml(rss(initial));
  const fake = fakeFetch({ [FEED_URL]: () => answer() }, clock);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
  const deps = { db, clock, fetcher };
  return {
    db,
    clock,
    deps,
    requests: fake.requests,
    serve(items: Item[] | (() => Response)) {
      answer = typeof items === "function" ? items : () => xml(rss(items));
    },
    list: (query: Parameters<typeof listArticles>[1] = {}) => listArticles(db, query, clock().toISOString()).items,
  };
}

describe("subscribe", () => {
  it("stores the feed under its own title with every delivered item as an unread article", async () => {
    const items = Array.from({ length: 20 }, (_unused, index) => ({ title: `Post ${index}`, key: `k${index}` }));
    const s = setup(items);

    const feed = await subscribe(s.deps, { url: FEED_URL });

    expect(feed).toMatchObject({ title: "Example Feed", siteUrl: "https://example.org/", articleCount: 20, lastSucceededAt: START, lastError: null });
    const stored = s.list({ feed: feed.id });
    expect(stored).toHaveLength(20);
    expect(stored.every((article) => !article.isRead && article.origin === "feed" && article.importance === null)).toBe(true);
  });

  it("keeps the order of the feed for items of the same time", async () => {
    const s = setup([
      { title: "Newest", published: null },
      { title: "Middle", published: null },
      { title: "Oldest", published: null },
    ]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    expect(s.list({ feed: feed.id }).map((article) => article.title)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("stores the page, the author, the converted content and a plain summary", async () => {
    const s = setup([
      {
        title: "Version 3",
        key: "v3",
        link: "https://example.org/posts/v3?utm_source=rss",
        author: "editor@example.org (Sam Editor)",
        content: '<p>It is <b>out</b>.</p><script>x()</script><p><img src="https://img.example.org/a.png" alt="Chart"></p>',
      },
    ]);
    const feed = await subscribe(s.deps, { url: FEED_URL, categoryId: createCategory(s.db, { name: "Tools", kind: "news" }, s.clock).id });
    const [article] = s.list({ feed: feed.id });
    expect(article).toMatchObject({
      title: "Version 3",
      author: "Sam Editor",
      summary: "It is out.",
      primaryUrl: "https://example.org/posts/v3",
      categoryId: feed.categoryId,
      feedId: feed.id,
      firstPublishedAt: "2026-03-01T11:00:00.000Z",
      updatedAt: "2026-03-01T11:00:00.000Z",
    });
    const row = s.db.prepare("SELECT body, content_text FROM articles WHERE id = ?").get(article!.id)!;
    expect(row.body).toBe("It is **out**.\n\n![Chart](https://img.example.org/a.png)");
    expect(row.content_text).toBe("It is out.");
  });

  it("refuses a page that is not a feed, and stores nothing", async () => {
    const s = setup(() => html("<html><body>Hello</body></html>"));
    await expect(subscribe(s.deps, { url: FEED_URL })).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/not a feed/) });
    expect(listFeeds(s.db)).toEqual([]);
  });

  it("refuses a URL that does not answer, and stores nothing", async () => {
    const s = setup(() => new Response("gone", { status: 404 }));
    await expect(subscribe(s.deps, { url: FEED_URL })).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/404/) });
    expect(listFeeds(s.db)).toEqual([]);
  });

  it("refuses a destination on a private network without connecting to it", async () => {
    const s = setup();
    await expect(subscribe(s.deps, { url: "http://192.168.1.10/feed.xml" })).rejects.toMatchObject({ code: "invalid" });
    expect(s.requests).toEqual([]);
  });

  it("refuses a second subscription to the same URL without fetching it", async () => {
    const s = setup([{ title: "One" }]);
    await subscribe(s.deps, { url: FEED_URL });
    const before = s.requests.length;
    await expect(subscribe(s.deps, { url: `${FEED_URL}?utm_medium=x` })).rejects.toMatchObject({ code: "conflict" });
    expect(s.requests.length).toBe(before);
  });

  it("keeps the name the user gave over the feed's title", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, title: "Mine" });
    s.serve(() => xml(rss([{ title: "One" }], "Renamed Feed")));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).title).toBe("Mine");
  });
});

describe("fetchFeed", () => {
  it("adds only the items it has not stored, as unread articles", async () => {
    const s = setup([{ title: "A" }, { title: "B" }, { title: "C" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    for (const article of s.list()) setArticleFlags(s.db, article.id, { isRead: true }, "2026-03-01T12:00:00.000Z");
    s.clock.advance(HOUR);
    s.serve([{ title: "E", published: s.clock().toISOString() }, { title: "D", published: s.clock().toISOString() }, { title: "A" }, { title: "B" }, { title: "C" }]);

    const outcome = await fetchFeed(s.deps, feed.id);

    expect(outcome).toMatchObject({ status: "updated", created: 2 });
    expect(s.list({ unread: "true" }).map((article) => article.title)).toEqual(["E", "D"]);
    expect(s.list()).toHaveLength(5);
  });

  it("tells items apart by their identifier, not by their link", async () => {
    const s = setup([{ title: "A", key: "same", link: "https://example.org/old-path" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve([{ title: "A", key: "same", link: "https://example.org/new-path" }]);

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 0 });
    expect(s.list().map((article) => article.primaryUrl)).toEqual(["https://example.org/new-path"]);
  });

  it("tells items without an identifier apart by their link", async () => {
    const s = setup([{ title: "A", key: null, link: "https://example.org/a?utm_source=x" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve([{ title: "A", key: null, link: "https://example.org/a" }, { title: "B", key: null, link: "https://example.org/b" }]);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 1 });
  });

  it("replaces rewritten content and leaves the article read, where it was in the list", async () => {
    const s = setup([{ title: "A", key: "a", content: "<p>First words.</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    const [before] = s.list();
    setArticleFlags(s.db, before!.id, { isRead: true }, "2026-03-01T12:00:00.000Z");
    s.clock.advance(HOUR);
    s.serve([{ title: "A (corrected)", key: "a", content: "<p>Better words.</p>", published: s.clock().toISOString() }]);

    await fetchFeed(s.deps, feed.id);

    const [after] = s.list();
    expect(after).toMatchObject({ id: before!.id, title: "A (corrected)", summary: "Better words.", isRead: true, updatedAt: before!.updatedAt });
  });

  it("makes a stored item searchable, and a rewrite replaces what search finds", async () => {
    const s = setup([{ title: "Battery news", key: "a", content: "<p>新しい<a href=\"https://example.org/x\">電池</a>の工場。</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    const found = (q: string) => searchArticles(s.db, { q }).items.map((item) => item.title);
    expect(found("電池")).toEqual(["Battery news"]);
    expect(found("example")).toEqual([]);
    s.clock.advance(HOUR);
    s.serve([{ title: "Battery news", key: "a", content: "<p>新しい工場。</p>", published: s.clock().toISOString() }]);

    await fetchFeed(s.deps, feed.id);

    expect(found("電池")).toEqual([]);
    expect(found("工場")).toEqual(["Battery news"]);
  });

  it("sorts an item by its published time, or by the fetch time when that is missing or in the future", async () => {
    const s = setup([
      { title: "Dated", published: "2026-02-28T08:00:00.000Z" },
      { title: "Undated", published: null },
      { title: "Future", published: "2026-03-04T12:00:00.000Z" },
    ]);
    await subscribe(s.deps, { url: FEED_URL });
    const byTitle = Object.fromEntries(s.list().map((article) => [article.title, article.updatedAt]));
    expect(byTitle).toEqual({ Dated: "2026-02-28T08:00:00.000Z", Undated: START, Future: START });
  });

  it("does not store items published before the retention period", async () => {
    const s = setup([
      { title: "Two years old", published: "2024-03-01T00:00:00.000Z" },
      { title: "Yesterday", published: "2026-02-28T12:00:00.000Z" },
    ]);
    await subscribe(s.deps, { url: FEED_URL });
    expect(s.list().map((article) => article.title)).toEqual(["Yesterday"]);
  });

  it("stores at most the newest items of one fetch", async () => {
    const items = Array.from({ length: MAX_NEW_ITEMS + 30 }, (_unused, index) => ({ title: `Post ${index}`, key: `k${index}`, published: null }));
    const s = setup(items);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    expect(getFeed(s.db, feed.id).articleCount).toBe(MAX_NEW_ITEMS);
    expect(s.list({ limit: 1 })[0]!.title).toBe("Post 0");
  });

  const hideTitle = (value: string) => ({ action: "hide" as const, scope: { type: "all" as const }, conditions: [{ fields: ["title" as const], match: "contains" as const, value }] });

  it("hides a new article that a filter matches, and still stores it", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createFilter(s.db, hideTitle("特売"), s.clock);
    s.serve([{ title: "春の特売", key: "sale" }, { title: "One" }]);

    await fetchFeed(s.deps, feed.id);

    expect(s.list().map((article) => article.title)).toEqual(["One"]);
    expect(getFeed(s.db, feed.id).articleCount).toBe(2);
  });

  it("judges an article again when its title is rewritten", async () => {
    const s = setup([{ title: "新製品", key: "a" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createFilter(s.db, hideTitle("特売"), s.clock);
    s.serve([{ title: "新製品の特売", key: "a" }]);
    await fetchFeed(s.deps, feed.id);
    expect(s.list()).toEqual([]);
  });

  it("matches the author and the page of a new article", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["url"], match: "contains", value: "/sponsored/" }] }, s.clock);
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["author"], match: "regex", value: "^広報" }] }, s.clock);
    s.serve([
      { title: "Paid", key: "p", link: "https://example.org/sponsored/1" },
      { title: "Press", key: "q", author: "広報部" },
      { title: "One" },
    ]);

    await fetchFeed(s.deps, feed.id);

    expect(s.list().map((article) => article.title)).toEqual(["One"]);
  });

  it("matches a keep filter of the feed against what it delivers next", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createFilter(s.db, { action: "keep", scope: { type: "feed", feedId: feed.id }, conditions: [{ fields: ["title"], match: "contains", value: "release" }] }, s.clock);
    s.serve([{ title: "Release 2.0", key: "r" }, { title: "Weekly notes", key: "w" }]);

    await fetchFeed(s.deps, feed.id);

    expect(s.list().map((article) => article.title)).toEqual(["Release 2.0"]);
  });
});

describe("conditional requests", () => {
  it("sends back what the last answer gave, and takes a not-modified answer as a success", async () => {
    const s = setup(() => new Response(rss([{ title: "A" }]), { headers: { "content-type": "application/xml", etag: '"v1"', "last-modified": "Sun, 01 Mar 2026 09:00:00 GMT" } }));
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve(() => new Response(null, { status: 304 }));

    const outcome = await fetchFeed(s.deps, feed.id);

    expect(outcome).toMatchObject({ status: "not_modified", created: 0 });
    expect(s.requests.at(-1)!.headers).toMatchObject({ "if-none-match": '"v1"', "if-modified-since": "Sun, 01 Mar 2026 09:00:00 GMT" });
    expect(getFeed(s.db, feed.id)).toMatchObject({ lastSucceededAt: s.clock().toISOString(), lastError: null, articleCount: 1 });
  });

  it("sends no condition on the first request", async () => {
    const s = setup([{ title: "A" }]);
    await subscribe(s.deps, { url: FEED_URL });
    expect(Object.keys(s.requests[0]!.headers)).not.toContain("if-none-match");
  });
});

describe("a fetch that fails", () => {
  it("records when and why, and stores nothing", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve(() => new Response("oops", { status: 500 }));

    const outcome = await fetchFeed(s.deps, feed.id);

    expect(outcome).toMatchObject({ status: "failed", created: 0, error: expect.stringMatching(/500/) });
    expect(getFeed(s.db, feed.id)).toMatchObject({ lastFetchedAt: s.clock().toISOString(), lastSucceededAt: START, lastError: expect.stringMatching(/500/), failureCount: 1 });
  });

  it("records a document that stopped being a feed", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve(() => html("<html>maintenance</html>"));
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/not a feed/) });
  });
});

describe("items whose article was purged", () => {
  it("do not come back while the feed still lists them", async () => {
    const s = setup([{ title: "Undated", key: "u", published: null }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    // The feed is fetched now and then, so the item is seen all along.
    for (let day = 0; day < 91; day += 10) {
      s.clock.advance(10 * DAY);
      await fetchFeed(s.deps, feed.id);
    }
    purgeExpired(s.db, s.clock);
    expect(getFeed(s.db, feed.id).articleCount).toBe(0);

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 0 });
    expect(getFeed(s.db, feed.id).articleCount).toBe(0);
  });

  it("are forgotten once the feed has not listed them for the retention period", async () => {
    const s = setup([{ title: "Undated", key: "u", published: null }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve([]);
    s.clock.advance(91 * DAY);
    await fetchFeed(s.deps, feed.id);
    purgeExpired(s.db, s.clock);
    expect(s.db.prepare("SELECT count(*) AS n FROM feed_items_seen").get()).toEqual({ n: 0 });
  });

  it("keeps a starred article past the retention period", async () => {
    const s = setup([{ title: "Keep", key: "k" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    setArticleFlags(s.db, s.list()[0]!.id, { starred: true }, "2026-03-01T12:00:00.000Z");
    s.clock.advance(365 * DAY);
    purgeExpired(s.db, s.clock);
    expect(getFeed(s.db, feed.id)).toMatchObject({ articleCount: 1, starredCount: 1 });
  });
});

describe("a feed registered without fetching", () => {
  it("takes its articles' category from the feed", async () => {
    const s = setup([{ title: "A" }]);
    const category = createCategory(s.db, { name: "Tools", kind: "news" }, s.clock);
    const feed = insertFeed(s.db, { url: FEED_URL, title: "example.org", categoryId: category.id }, s.clock);
    await fetchFeed(s.deps, feed.id);
    expect(s.list({ category: category.id })).toHaveLength(1);
    expect(getFeed(s.db, feed.id).title).toBe("Example Feed");
  });
});

describe("translating titles when a feed is fetched", () => {
  function translating(google: (Translator & { calls: Array<{ items: unknown[] }> }) | null = fakeTranslator()) {
    const s = setup([]);
    updateSettings(s.db, { outputLanguage: "ja" });
    const llm = fakeLlm(s.db, s.clock, {});
    const service = new TranslationService({
      db: s.db,
      clock: s.clock,
      google,
      llm: new LlmTranslator(llm.runner),
      monthlyChars: 450_000,
      maxCharsPerArticle: 20_000,
      log: () => {},
    });
    const llmCalls = () => s.db.prepare("SELECT count(*) AS n FROM llm_calls").get()!.n;
    return { ...s, deps: { ...s.deps, translation: service }, service, google, llmCalls };
  }
  const failing = () =>
    fakeTranslator(() => {
      throw new Error("the translation API answered HTTP status 500");
    });

  it("stores a new article with its translated title next to the original, and sends only what is new", async () => {
    const s = translating();
    s.serve([{ title: "Vendor ships a fix", key: "a" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, translate: true });
    expect(feed.translate).toBe(true);
    expect(s.list()).toMatchObject([{ title: "Vendor ships a fix", translatedTitle: "訳:Vendor ships a fix" }]);

    s.serve([{ title: "Another post", key: "b" }, { title: "Vendor ships a fix", key: "a" }]);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "updated", created: 1 });
    expect(s.list().map((article) => article.translatedTitle)).toEqual(["訳:Another post", "訳:Vendor ships a fix"]);
    expect(s.google!.calls.map((call) => call.items)).toEqual([[{ text: "Vendor ships a fix", plain: true }], [{ text: "Another post", plain: true }]]);
    expect(s.llmCalls()).toBe(0);
  });

  it("stores the article without a translation, and records a success, when the API fails or no key is set", async () => {
    for (const google of [failing(), null]) {
      const s = translating(google);
      s.serve([{ title: "Vendor ships a fix", key: "a" }]);
      const feed = await subscribe(s.deps, { url: FEED_URL, translate: true });
      s.serve([{ title: "Another post", key: "b" }]);
      expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "updated", created: 1 });
      expect(s.list().map((article) => article.translatedTitle)).toEqual([null, null]);
      expect(getFeed(s.db, feed.id)).toMatchObject({ lastError: null, failureCount: 0 });
      expect(s.llmCalls()).toBe(0);
    }
  });

  it("matches filters against the original title only, and calls no model for them", async () => {
    const s = translating();
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "訳" }] }, s.clock);
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "regex", value: "^sponsored" }] }, s.clock);
    s.serve([{ title: "Vendor ships a fix", key: "a" }, { title: "Sponsored: buy now", key: "b" }]);

    await subscribe(s.deps, { url: FEED_URL, translate: true });

    expect(s.list()).toMatchObject([{ title: "Vendor ships a fix", translatedTitle: "訳:Vendor ships a fix" }]);
    expect(s.llmCalls()).toBe(0);
  });

  it("sends nothing for a feed that does not translate", async () => {
    const s = translating();
    s.serve([{ title: "Vendor ships a fix", key: "a" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve([{ title: "Another post", key: "b" }]);
    await fetchFeed(s.deps, feed.id);
    expect(s.google!.calls).toEqual([]);
    expect(s.list().map((article) => article.translatedTitle)).toEqual([null, null]);
  });

  it("drops the translations of an item that was rewritten, and translates its title again", async () => {
    const s = translating();
    s.serve([{ title: "Old title", key: "a", content: "<p>Old content.</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, translate: true });
    const id = s.list()[0]!.id;
    await s.service.translateArticle(id);
    expect(getArticle(s.db, id).translation).not.toBeNull();

    s.serve([{ title: "New title", key: "a", content: "<p>New content.</p>" }]);
    await fetchFeed(s.deps, feed.id);

    expect(getArticle(s.db, id)).toMatchObject({ title: "New title", translatedTitle: "訳:New title", translation: null });
    expect((await s.service.translateArticle(id)).segments).toMatchObject([{ original: "New content.", translated: "訳:New content." }]);
  });

  it("keeps the translation of the body when only the title was rewritten", async () => {
    const s = translating();
    s.serve([{ title: "Old title", key: "a", content: "<p>Same content.</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, translate: true });
    const id = s.list()[0]!.id;
    await s.service.translateArticle(id);
    s.serve([{ title: "New title", key: "a", content: "<p>Same content.</p>" }]);
    await fetchFeed(s.deps, feed.id);
    expect(getArticle(s.db, id)).toMatchObject({ translatedTitle: "訳:New title", translation: { segments: [{ translated: "訳:Same content." }] } });
  });

  it("keeps the translation of the full content when only what the feed delivered was rewritten", async () => {
    const s = translating();
    s.serve([{ title: "Title", key: "a", content: "<p>Old excerpt.</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, translate: true });
    const id = s.list()[0]!.id;
    saveFullContent(s.db, id, { markdown: "Full text.", text: "Full text.", now: s.clock().toISOString() });
    await s.service.translateArticle(id);

    s.serve([{ title: "Title", key: "a", content: "<p>New excerpt.</p>" }]);
    await fetchFeed(s.deps, feed.id);

    expect(getArticle(s.db, id)).toMatchObject({ body: "New excerpt.", translation: { segments: [{ original: "Full text.", translated: "訳:Full text." }] } });
  });
});

describe("duplicates across feeds", () => {
  const FEEDS = { A: "https://a.example.org/feed.xml", B: "https://b.example.org/feed.xml", C: "https://c.example.org/feed.xml" };
  type Name = keyof typeof FEEDS;

  function several(translator?: Translator & { calls: Array<{ items: unknown[] }> }) {
    const db = createTestDb();
    const clock = fakeClock(START);
    const answers: Record<string, Item[]> = {};
    const routes = Object.fromEntries(Object.values(FEEDS).map((url) => [url, () => xml(rss(answers[url] ?? [], url))]));
    const fake = fakeFetch(routes, clock);
    const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
    const llm = fakeLlm(db, clock, {});
    const translation = translator
      ? new TranslationService({ db, clock, google: translator, llm: new LlmTranslator(llm.runner), monthlyChars: 450_000, maxCharsPerArticle: 20_000, log: () => {} })
      : undefined;
    const deps = { db, clock, fetcher, translation };
    const ids: Partial<Record<Name, number>> = {};
    return {
      db,
      clock,
      llm,
      /** Serves the items as the feed's document, subscribing on first use and fetching after that. */
      async deliver(name: Name, items: Item[], options: { translate?: boolean; autoSummarize?: boolean } = {}) {
        answers[FEEDS[name]] = items;
        if (ids[name] === undefined) ids[name] = (await subscribe(deps, { url: FEEDS[name], ...options })).id;
        else await fetchFeed(deps, ids[name]);
        return ids[name];
      },
      /** The article of the feed with the given item key. */
      article(name: Name, key: string) {
        return db.prepare("SELECT id, duplicate_of, dedup_url, dedup_title, translated_title FROM articles WHERE feed_id = ? AND item_key = ?").get(ids[name]!, key)!;
      },
      duplicateOf(name: Name, key: string) {
        const row = this.article(name, key);
        return row.duplicate_of === null ? null : Number(row.duplicate_of);
      },
      idOf(name: Name, key: string) {
        return Number(this.article(name, key).id);
      },
      list: (query: Parameters<typeof listArticles>[1] = {}) => listArticles(db, query, clock().toISOString()).items,
    };
  }

  it("stores the normalized page and title of a new article, and replaces them when the item is rewritten", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Example社が新しい端末を発表！", link: "https://news.example.org/1?utm_source=rss#top" }]);
    expect(s.article("A", "a")).toMatchObject({ dedup_url: "https://news.example.org/1", dedup_title: "example社が新しい端末を発表" });

    await s.deliver("A", [{ key: "a", title: "Example社が新しい端末を正式に発表", link: "https://news.example.org/2" }]);
    expect(s.article("A", "a")).toMatchObject({ dedup_url: "https://news.example.org/2", dedup_title: "example社が新しい端末を正式に発表" });
  });

  it("records an article whose page differs only in tracking parameters as a duplicate, and calls no model", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix", link: "https://news.example.org/1?utm_source=a" }]);
    await s.deliver("B", [{ key: "b", title: "Something else entirely", link: "https://news.example.org/1?utm_source=b" }]);
    expect(s.duplicateOf("B", "b")).toBe(s.idOf("A", "a"));
    expect(s.db.prepare("SELECT count(*) AS n FROM llm_calls").get()).toEqual({ n: 0 });
    expect(Object.values(s.llm.requests).flat()).toEqual([]);
  });

  it("records an article with the same title on another page as a duplicate", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://a.example.org/1" }]);
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix for the bug", link: "https://b.example.org/1" }]);
    expect(s.duplicateOf("B", "b")).toBe(s.idOf("A", "a"));
  });

  it("does not record articles whose page and title both differ", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://a.example.org/1" }]);
    await s.deliver("B", [{ key: "b", title: "Another vendor ships a release", link: "https://b.example.org/1" }]);
    expect(s.duplicateOf("A", "a")).toBeNull();
    expect(s.duplicateOf("B", "b")).toBeNull();
  });

  it("does not compare the items of one feed with each other", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a1", title: "Weekly maintenance notice", link: "https://a.example.org/1" }]);
    await s.deliver("A", [
      { key: "a2", title: "Weekly maintenance notice", link: "https://a.example.org/2" },
      { key: "a3", title: "Weekly maintenance notice", link: "https://a.example.org/1" },
      { key: "a1", title: "Weekly maintenance notice", link: "https://a.example.org/1" },
    ]);
    expect(["a1", "a2", "a3"].map((key) => s.duplicateOf("A", key))).toEqual([null, null, null]);
  });

  it("ignores width, case, white space and punctuation in titles", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Example社が新しい端末を発表", link: "https://a.example.org/1" }]);
    await s.deliver("B", [{ key: "b", title: "ＥＸＡＭＰＬＥ社が 新しい 端末を発表！", link: "https://b.example.org/1" }]);
    expect(s.duplicateOf("B", "b")).toBe(s.idOf("A", "a"));
  });

  it("compares a short title only by its page", async () => {
    const s = several();
    await s.deliver("A", [
      { key: "a1", title: "お知らせ", link: "https://a.example.org/1" },
      { key: "a2", title: "お知らせ", link: "https://shared.example.org/1" },
    ]);
    await s.deliver("B", [
      { key: "b1", title: "お知らせ", link: "https://b.example.org/1" },
      { key: "b2", title: "お知らせ", link: "https://shared.example.org/1" },
    ]);
    expect(s.duplicateOf("B", "b1")).toBeNull();
    expect(s.duplicateOf("B", "b2")).toBe(s.idOf("A", "a2"));
  });

  it("does not compare with articles stored more than seven days before", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1", published: null }]);
    s.clock.advance(8 * DAY);
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1", published: null }]);
    expect(s.duplicateOf("B", "b")).toBeNull();
  });

  it("records every later copy against the article stored first, also when only a duplicate matches", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }]);
    s.clock.advance(HOUR);
    await s.deliver("B", [{ key: "b", title: "A fix ships from the vendor", link: "https://news.example.org/1" }]);
    s.clock.advance(HOUR);
    await s.deliver("C", [
      { key: "c1", title: "Vendor ships a fix for the bug", link: "https://c.example.org/1" },
      { key: "c2", title: "A fix ships from the vendor", link: "https://c.example.org/2" },
    ]);
    const kept = s.idOf("A", "a");
    expect([s.duplicateOf("B", "b"), s.duplicateOf("C", "c1"), s.duplicateOf("C", "c2")]).toEqual([kept, kept, kept]);
  });

  it("does not compare with generated articles or their sources", async () => {
    const s = several();
    const category = createCategory(s.db, { name: "Tools", kind: "news" }, s.clock);
    insertArticle(s.db, {
      categoryId: category.id,
      kind: "news",
      now: START,
      previousArticleId: null,
      title: "Vendor ships a fix for the bug",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      refs: [{ url: "https://news.example.org/1", siteName: "News", title: "Vendor ships a fix for the bug", publishedAt: null }],
      topicIds: [],
    });
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }]);
    expect(s.duplicateOf("A", "a")).toBeNull();
  });

  it("does not judge a rewritten item again", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://a.example.org/1" }]);
    await s.deliver("B", [{ key: "b", title: "Something else entirely", link: "https://b.example.org/1" }]);
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix for the bug", link: "https://b.example.org/1" }]);
    expect(s.duplicateOf("B", "b")).toBeNull();
  });

  it("neither records nor compares with articles stored before duplicate removal existed", async () => {
    const s = several();
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }]);
    // What an earlier version stored has nothing to compare.
    s.db.prepare("UPDATE articles SET dedup_url = NULL, dedup_title = NULL").run();
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }]);
    expect(s.duplicateOf("B", "b")).toBeNull();
    // Rewriting such an article does not make it one to compare with.
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug, again", link: "https://news.example.org/1" }]);
    expect(s.article("A", "a")).toMatchObject({ dedup_url: null, dedup_title: null });
  });

  it("records nothing while duplicate removal is off, and compares with what was stored then once it is on", async () => {
    const s = several();
    updateSettings(s.db, { removeDuplicates: false });
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }]);
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }]);
    expect([s.duplicateOf("A", "a"), s.duplicateOf("B", "b")]).toEqual([null, null]);

    updateSettings(s.db, { removeDuplicates: true });
    await s.deliver("C", [{ key: "c", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }]);
    expect(s.duplicateOf("C", "c")).toBe(s.idOf("A", "a"));
  });

  it("does not translate the title of a duplicate when it is fetched, new or rewritten", async () => {
    const google = fakeTranslator();
    const s = several(google);
    updateSettings(s.db, { outputLanguage: "ja" });
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix for the bug", link: "https://news.example.org/1" }], { translate: true });
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix for the bug", link: "https://b.example.org/1" }], { translate: true });
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix for the bug, now rewritten", link: "https://b.example.org/1" }], { translate: true });

    expect(s.duplicateOf("B", "b")).toBe(s.idOf("A", "a"));
    expect(s.article("A", "a").translated_title).toBe("訳:Vendor ships a fix for the bug");
    expect(s.article("B", "b").translated_title).toBeNull();
    expect(google.calls.map((call) => call.items)).toEqual([[{ text: "Vendor ships a fix for the bug", plain: true }]]);
    expect(s.db.prepare("SELECT coalesce(sum(chars), 0) AS n FROM translation_usage").get()).toEqual({ n: "Vendor ships a fix for the bug".length });
  });
});

describe("full content when a feed is fetched", () => {
  const FULL_MARKDOWN = "The whole story, with a giveaway at the end.";

  async function withFullContent() {
    const s = setup([{ title: "A", key: "a", content: "<p>First words.</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, fetchFullContent: true });
    const id = s.list()[0]!.id;
    saveFullContent(s.db, id, { markdown: FULL_MARKDOWN, text: FULL_MARKDOWN, now: s.clock().toISOString() });
    return { ...s, feed, id };
  }

  it("keeps the full content of a rewritten item, and fetches no page for it", async () => {
    const s = await withFullContent();
    s.clock.advance(HOUR);
    s.serve([{ title: "A (corrected)", key: "a", content: "<p>Better words.</p>" }]);

    await fetchFeed(s.deps, s.feed.id);

    expect(getArticle(s.db, s.id)).toMatchObject({
      title: "A (corrected)",
      body: "Better words.",
      fullContentStatus: "fetched",
      fullContent: { body: FULL_MARKDOWN, fetchedAt: START },
    });
    expect(s.requests.map((request) => request.url).filter((url) => url !== FEED_URL)).toEqual([]);
  });

  it("matches filters against what the feed delivered, never against the full content", async () => {
    const s = await withFullContent();
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["content"], match: "contains", value: "giveaway" }] }, s.clock);
    expect(s.list().map((article) => article.id)).toEqual([s.id]);

    s.serve([{ title: "A (corrected)", key: "a", content: "<p>Better words.</p>" }]);
    await fetchFeed(s.deps, s.feed.id);
    expect(s.list().map((article) => article.id)).toEqual([s.id]);
  });
});

describe("when a feed last listed a new item", () => {
  const lastNew = (s: ReturnType<typeof setup>, id: number) => getFeed(s.db, id).lastNewItemAt;

  it("is the time of the subscription for a feed that delivers items, and stays empty for one without", async () => {
    const items = Array.from({ length: 20 }, (_unused, index) => ({ title: `Post ${index}`, key: `k${index}` }));
    const s = setup(items);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    expect(lastNew(s, feed.id)).toBe(START);

    const empty = setup([]);
    const none = await subscribe(empty.deps, { url: FEED_URL });
    expect(lastNew(empty, none.id)).toBeNull();
  });

  it("becomes the time of the fetch that finds an item the feed never listed", async () => {
    const s = setup([{ title: "A" }, { title: "B" }, { title: "C" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve([{ title: "D", published: s.clock().toISOString() }, { title: "A" }, { title: "B" }, { title: "C" }]);
    await fetchFeed(s.deps, feed.id);
    expect(lastNew(s, feed.id)).toBe(s.clock().toISOString());
  });

  it("moves for an item published two years ago, which is not stored", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve([{ title: "Old", published: "2024-03-01T00:00:00.000Z" }, { title: "A" }]);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 0 });
    expect(lastNew(s, feed.id)).toBe(s.clock().toISOString());
  });

  it("moves for an item recorded as a duplicate of another feed's article", async () => {
    const s = setup([{ title: "A" }]);
    const other = insertFeed(s.db, { url: "https://other.example.org/feed.xml", title: "Other" }, s.clock);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.db
      .prepare(
        `INSERT INTO articles (origin, feed_id, item_key, kind, title, summary, body, first_published_at, updated_at, created_at, dedup_url, dedup_title)
         VALUES ('feed', ?, 'x', 'news', 'Shared', 's', 'b', ?, ?, ?, 'https://example.org/shared', 'shared story title')`,
      )
      .run(other.id, START, START, START);
    s.clock.advance(HOUR);
    s.serve([{ title: "Shared story title", key: "dup", link: "https://example.org/shared" }, { title: "A" }]);
    await fetchFeed(s.deps, feed.id);
    expect(s.db.prepare("SELECT duplicate_of FROM articles WHERE feed_id = ? AND item_key = 'dup'").get(feed.id)!.duplicate_of).not.toBeNull();
    expect(lastNew(s, feed.id)).toBe(s.clock().toISOString());
  });

  it("stays when only known items come, rewritten or not", async () => {
    const s = setup([{ title: "A", key: "a" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve([{ title: "A rewritten", key: "a", content: "<p>New words.</p>" }]);
    await fetchFeed(s.deps, feed.id);
    expect(getArticle(s.db, s.list()[0]!.id).title).toBe("A rewritten");
    expect(lastNew(s, feed.id)).toBe(START);
  });

  it("stays when the feed still lists an item whose article was purged", async () => {
    const s = setup([{ title: "Undated", key: "u", published: null }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    for (let day = 0; day < 91; day += 10) {
      s.clock.advance(10 * DAY);
      await fetchFeed(s.deps, feed.id);
    }
    purgeExpired(s.db, s.clock);
    expect(getFeed(s.db, feed.id).articleCount).toBe(0);
    s.clock.advance(HOUR);
    await fetchFeed(s.deps, feed.id);
    expect(lastNew(s, feed.id)).toBe(START);
  });

  it("stays when the feed answers that nothing changed", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve(() => new Response(null, { status: 304 }));
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "not_modified" });
    expect(lastNew(s, feed.id)).toBe(START);
  });
});
