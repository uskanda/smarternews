import { describe, expect, it } from "vitest";
import { getArticle, listArticles, setArticleFlags } from "../db/articles.ts";
import { createCategory } from "../db/categories.ts";
import { getFeed, insertFeed, listFeeds } from "../db/feeds.ts";
import { updateSettings } from "../db/settings.ts";
import { createStopWord } from "../db/stop-words.ts";
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
    for (const article of s.list()) setArticleFlags(s.db, article.id, { isRead: true });
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
    setArticleFlags(s.db, before!.id, { isRead: true });
    s.clock.advance(HOUR);
    s.serve([{ title: "A (corrected)", key: "a", content: "<p>Better words.</p>", published: s.clock().toISOString() }]);

    await fetchFeed(s.deps, feed.id);

    const [after] = s.list();
    expect(after).toMatchObject({ id: before!.id, title: "A (corrected)", summary: "Better words.", isRead: true, updatedAt: before!.updatedAt });
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

  it("hides a new article that contains a stop word, and still stores it", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createStopWord(s.db, { text: "特売" }, s.clock);
    s.serve([{ title: "春の特売", key: "sale" }, { title: "One" }]);

    await fetchFeed(s.deps, feed.id);

    expect(s.list().map((article) => article.title)).toEqual(["One"]);
    expect(getFeed(s.db, feed.id).articleCount).toBe(2);
  });

  it("judges an article again when its title is rewritten", async () => {
    const s = setup([{ title: "新製品", key: "a" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createStopWord(s.db, { text: "特売" }, s.clock);
    s.serve([{ title: "新製品の特売", key: "a" }]);
    await fetchFeed(s.deps, feed.id);
    expect(s.list()).toEqual([]);
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
    setArticleFlags(s.db, s.list()[0]!.id, { starred: true });
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
});
