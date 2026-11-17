import { describe, expect, it } from "vitest";
import { getArticle, insertArticle, listArticles, saveFullContent, searchArticles, setArticleFlags } from "../db/articles.ts";
import { createCategory } from "../db/categories.ts";
import { replaceMentions } from "../db/mentions.ts";
import { saveArticleNote } from "../db/annotations.ts";
import { deleteFeed, getFeed, insertFeed, listFeeds, updateFeed } from "../db/feeds.ts";
import { DomainError } from "../errors.ts";
import { updateSettings } from "../db/settings.ts";
import { createFilter } from "../db/filters.ts";
import { createRule } from "../db/rules.ts";
import { addHighlightTerm, createTermGroup } from "../db/term-highlights.ts";
import { Fetcher } from "../fetch/http.ts";
import { purgeExpired } from "../runs/retention.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { fakeFetch, html, xml, type Route } from "../testing/http.ts";
import { icoBytes, imageResponse, pngBytes } from "../testing/images.ts";
import { fakeLlm } from "../testing/llm.ts";
import { fakeTranslator } from "../testing/translation.ts";
import type { Translator } from "../translation/adapter.ts";
import { LlmTranslator } from "../translation/llm.ts";
import { TranslationService } from "../translation/service.ts";
import { changeFeedUrl, fetchFeed, MAX_NEW_ITEMS, subscribe } from "./ingest.ts";

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
  /** XML put inside the item as it is, such as enclosures and Media RSS elements. */
  extra?: string;
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
        item.extra ?? "",
        "</item>",
      ].join("");
    })
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${esc(title)}</title><link>https://example.org/</link>${body}</channel></rss>`;
}

/** `others` answers the requests besides the feed, such as those for its icon; the rest answer 404. */
function setup(initial: Item[] | (() => Response) = [], others: Record<string, Route> = {}) {
  const db = createTestDb();
  const clock = fakeClock(START);
  let answer: () => Response = typeof initial === "function" ? initial : () => xml(rss(initial));
  const fake = fakeFetch({ ...others, [FEED_URL]: () => answer() }, clock);
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

  it("keeps an embedded video as a link to it, and leaves the link out of the text for matching", async () => {
    const s = setup([{ title: "Clip", key: "clip", content: '<p>Watch this.</p><video controls><source src="https://media.example.org/clip.mp4"></video>' }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, categoryId: createCategory(s.db, { name: "Tools", kind: "news" }, s.clock).id });
    const [article] = s.list({ feed: feed.id });
    const row = s.db.prepare("SELECT body, content_text FROM articles WHERE id = ?").get(article!.id)!;
    expect(row.body).toBe("Watch this.\n\n[埋め込み（media.example.org）](https://media.example.org/clip.mp4)");
    expect(row.content_text).toBe("Watch this.");
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

  it("gives a new article the behaviour score of its feed, and matches it with the highlight terms", async () => {
    const s = setup([{ title: "Plain", key: "a" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    const group = createTermGroup(s.db, { name: "Power" }, s.clock);
    addHighlightTerm(s.db, group.id, { text: "battery" }, s.clock);
    s.db.prepare("UPDATE feeds SET relevance_score = 0.4 WHERE id = ?").run(feed.id);
    s.serve([{ title: "New BATTERY", key: "b" }, { title: "Plain", key: "a" }]);

    await fetchFeed(s.deps, feed.id);

    const rows = s.db.prepare("SELECT title, feed_score, term_match FROM articles ORDER BY id").all();
    expect(rows).toEqual([
      { title: "Plain", feed_score: 0, term_match: 0 },
      { title: "New BATTERY", feed_score: 0.4, term_match: 1 },
    ]);
  });

  it("matches a rewritten article with the highlight terms again", async () => {
    const s = setup([{ title: "Battery", key: "a" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    const group = createTermGroup(s.db, { name: "Power" }, s.clock);
    addHighlightTerm(s.db, group.id, { text: "battery" }, s.clock);
    expect(s.db.prepare("SELECT term_match FROM articles").get()).toEqual({ term_match: 1 });
    s.serve([{ title: "Solar", key: "a", content: "<p>Sun.</p>" }]);

    await fetchFeed(s.deps, feed.id);

    expect(s.db.prepare("SELECT term_match FROM articles").get()).toEqual({ term_match: 0 });
  });

  it("keeps the names found in an article when its item is rewritten", async () => {
    const s = setup([{ title: "A", key: "a", content: "<p>First words.</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    const [before] = s.list();
    replaceMentions(s.db, before!.id, [{ name: "日本銀行", kind: "organization" }]);
    s.clock.advance(HOUR);
    s.serve([{ title: "A (corrected)", key: "a", content: "<p>Better words.</p>" }]);

    await fetchFeed(s.deps, feed.id);

    expect(getArticle(s.db, before!.id)).toMatchObject({ title: "A (corrected)", summary: "Better words.", mentions: [{ name: "日本銀行", kind: "organization" }] });
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

describe("reading what a feed delivers", () => {
  const raw = (items: string) => () => xml(`<?xml version="1.0"?><rss version="2.0"><channel><title>Raw</title>${items}</channel></rss>`);

  it("sorts by dates with abbreviated zones, and leaves out the old ones", async () => {
    const s = setup(
      raw(`
        <item><title>Tokyo</title><link>https://example.org/t</link><guid>t</guid><pubDate>Sun, 01 Mar 2026 15:00:00 JST</pubDate></item>
        <item><title>Paris</title><link>https://example.org/p</link><guid>p</guid><pubDate>Sun, 01 Mar 2026 09:00:00 CET</pubDate></item>
        <item><title>Old</title><link>https://example.org/o</link><guid>o</guid><pubDate>Fri, 01 Mar 2024 09:00:00 JST</pubDate></item>
        <item><title>India</title><link>https://example.org/i</link><guid>i</guid><pubDate>Fri, 01 Mar 2024 09:00:00 IST</pubDate></item>`),
    );
    await subscribe(s.deps, { url: FEED_URL });
    expect(s.list().map((article) => [article.title, article.firstPublishedAt])).toEqual([
      ["India", START],
      ["Paris", "2026-03-01T08:00:00.000Z"],
      ["Tokyo", "2026-03-01T06:00:00.000Z"],
    ]);
  });

  it("reads a date without an offset in the time zone of the settings", async () => {
    const s = setup(raw(`<item><title>Local</title><link>https://example.org/l</link><guid>l</guid><dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">2026-03-01T15:00:00</dc:date></item>`));
    updateSettings(s.db, { timeZone: "Asia/Tokyo" });
    await subscribe(s.deps, { url: FEED_URL });
    expect(s.list()[0]!.firstPublishedAt).toBe("2026-03-01T06:00:00.000Z");
  });

  it("decodes the named references of HTML in titles", async () => {
    const s = setup([{ title: "Q1 &mdash; results&hellip;" }]);
    await subscribe(s.deps, { url: FEED_URL });
    expect(s.list()[0]!.title).toBe("Q1 — results…");
  });

  it("takes the page of an item without a link from a guid that is a permalink", async () => {
    const s = setup(
      raw(`
        <item><title>Permalink</title><guid>https://example.org/posts/1?utm_source=rss</guid></item>
        <item><title>Not a permalink</title><guid isPermaLink="false">https://example.org/?p=2</guid></item>`),
    );
    await subscribe(s.deps, { url: FEED_URL });
    expect(Object.fromEntries(s.list().map((article) => [article.title, article.primaryUrl]))).toEqual({
      Permalink: "https://example.org/posts/1",
      "Not a permalink": null,
    });
  });

  it("subscribes to a feed larger than the limit of pages, up to the limit of feeds", async () => {
    const items = Array.from({ length: 50 }, (_unused, index) => ({ title: `Episode ${index}`, key: `e${index}`, content: "x".repeat(200) }));
    const body = rss(items);
    const db = createTestDb();
    const clock = fakeClock(START);
    const fake = fakeFetch({ [FEED_URL]: () => xml(body) }, clock);
    const limited = (feedMaxBytes: number) =>
      new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 2048, feedMaxBytes, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });

    await expect(subscribe({ db, clock, fetcher: limited(4096) }, { url: FEED_URL })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringMatching(/larger than 4096 bytes/),
    });
    const feed = await subscribe({ db, clock, fetcher: limited(1_000_000) }, { url: FEED_URL });
    expect(getFeed(db, feed.id).articleCount).toBe(50);
    expect(await fetchFeed({ db, clock, fetcher: limited(1_000_000) }, feed.id)).toMatchObject({ status: "updated" });
  });
});

describe("rules when a feed is fetched", () => {
  const titleHas = (value: string) => [{ fields: ["title" as const], match: "contains" as const, value }];
  const flagsOf = (db: ReturnType<typeof createTestDb>, title: string) =>
    db.prepare("SELECT is_read, starred, rule_notify_at, rule_summary_requested_at FROM articles WHERE title = ?").get(title)!;

  it("act on a new article the moment it is stored, every rule it meets together", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createRule(s.db, { scope: { type: "all" }, conditions: titleHas("障害"), actions: ["star", "notify"] }, s.clock);
    createRule(s.db, { scope: { type: "feed", feedId: feed.id }, conditions: titleHas("障害"), actions: ["summarize"] }, s.clock);
    s.clock.advance(HOUR);
    s.serve([{ title: "大規模な障害", key: "o" }, { title: "One" }]);

    await fetchFeed(s.deps, feed.id);

    const now = s.clock().toISOString();
    expect(flagsOf(s.db, "大規模な障害")).toEqual({ is_read: 0, starred: 1, rule_notify_at: now, rule_summary_requested_at: now });
    expect(flagsOf(s.db, "One")).toMatchObject({ starred: 0, rule_notify_at: null });
  });

  it("do not make an article one to notify when a rule marks it read", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createRule(s.db, { scope: { type: "all" }, conditions: titleHas("障害"), actions: ["notify"] }, s.clock);
    createRule(s.db, { scope: { type: "all" }, conditions: titleHas("障害"), actions: ["read"] }, s.clock);
    s.serve([{ title: "障害", key: "o" }, { title: "One" }]);

    await fetchFeed(s.deps, feed.id);

    expect(flagsOf(s.db, "障害")).toMatchObject({ is_read: 1, rule_notify_at: null });
  });

  it("leave alone what was stored before, a rewritten article and an article a filter hides", async () => {
    const s = setup([{ title: "障害 1", key: "a" }, { title: "新製品", key: "b" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createRule(s.db, { scope: { type: "all" }, conditions: titleHas("障害"), actions: ["star"] }, s.clock);
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: titleHas("PR") }, s.clock);
    s.serve([
      { title: "障害 1", key: "a" },
      { title: "新製品の障害", key: "b" },
      { title: "【PR】障害対策", key: "c" },
    ]);

    await fetchFeed(s.deps, feed.id);

    expect(flagsOf(s.db, "障害 1").starred).toBe(0);
    expect(flagsOf(s.db, "新製品の障害").starred).toBe(0);
    expect(flagsOf(s.db, "【PR】障害対策").starred).toBe(0);
  });

  it("leave alone a disabled rule", async () => {
    const s = setup([{ title: "One" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    createRule(s.db, { scope: { type: "all" }, conditions: titleHas("障害"), actions: ["star"], enabled: false }, s.clock);
    s.serve([{ title: "障害", key: "o" }, { title: "One" }]);

    await fetchFeed(s.deps, feed.id);

    expect(flagsOf(s.db, "障害").starred).toBe(0);
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

  it("sends the condition for a JSON Feed too, and asks for JSON Feed in Accept", async () => {
    const json = JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      title: "Example JSON",
      home_page_url: "https://example.org/",
      items: [{ id: "a", url: "https://example.org/posts/a", title: "A", content_html: "<p>A.</p>", date_published: "2026-03-01T11:00:00Z" }],
    });
    const s = setup(() => new Response(json, { headers: { "content-type": "application/feed+json", etag: '"j1"' } }));
    const feed = await subscribe(s.deps, { url: FEED_URL });
    expect(feed).toMatchObject({ title: "Example JSON", siteUrl: "https://example.org/", articleCount: 1 });
    expect(s.requests[0]!.headers.accept).toContain("application/feed+json");
    s.clock.advance(HOUR);
    s.serve(() => new Response(null, { status: 304 }));

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "not_modified", created: 0 });
    expect(s.requests.at(-1)!.headers).toMatchObject({ "if-none-match": '"j1"' });
  });

  it("sends no condition on the first request", async () => {
    const s = setup([{ title: "A" }]);
    await subscribe(s.deps, { url: FEED_URL });
    expect(Object.keys(s.requests[0]!.headers)).not.toContain("if-none-match");
  });
});

describe("the feed's icon", () => {
  const FAVICON = "https://example.org/favicon.ico";
  const ico = () => imageResponse(icoBytes(), "image/x-icon");
  const iconRequests = (s: ReturnType<typeof setup>) => s.requests.filter((request) => request.url === FAVICON).length;
  const iconState = (s: ReturnType<typeof setup>, id: number) =>
    s.db.prepare("SELECT icon_url, icon_checked_at FROM feeds WHERE id = ?").get(id) as { icon_url: string | null; icon_checked_at: string | null };

  it("is looked for when the feed is subscribed, after its articles are stored", async () => {
    const s = setup([{ title: "A" }], { [FAVICON]: ico });
    const feed = await subscribe(s.deps, { url: FEED_URL });
    expect(feed.iconUrl).toBe(FAVICON);
    expect(feed.articleCount).toBe(1);
    expect(iconState(s, feed.id)).toEqual({ icon_url: FAVICON, icon_checked_at: START });
  });

  it("takes the icon an Atom feed names before the site's", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
      <link href="https://example.org/"/><icon>/icon.png</icon></feed>`;
    const s = setup(() => xml(atom), { [FAVICON]: ico, "https://example.org/icon.png": () => imageResponse(pngBytes()) });
    expect((await subscribe(s.deps, { url: FEED_URL })).iconUrl).toBe("https://example.org/icon.png");
    expect(iconRequests(s)).toBe(0);
  });

  it("is not looked for again within 30 days, and is looked for again after them", async () => {
    const s = setup([{ title: "A" }], { [FAVICON]: ico });
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(10 * DAY);
    await fetchFeed(s.deps, feed.id);
    expect(iconRequests(s)).toBe(1);

    s.clock.advance(21 * DAY);
    await fetchFeed(s.deps, feed.id);
    expect(iconRequests(s)).toBe(2);
    expect(iconState(s, feed.id).icon_checked_at).toBe(s.clock().toISOString());
  });

  it("is looked for on the first fetch of a feed stored before icons existed", async () => {
    const s = setup([{ title: "A" }], { [FAVICON]: ico });
    const feed = insertFeed(s.db, { url: FEED_URL, title: "Old", categoryId: null }, s.clock);
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).iconUrl).toBe(FAVICON);
  });

  it("is looked for on a not-modified answer once 30 days passed, trying the icon it had first", async () => {
    const s = setup([{ title: "A" }], { [FAVICON]: ico });
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(31 * DAY);
    s.serve(() => new Response(null, { status: 304 }));
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "not_modified" });
    expect(iconRequests(s)).toBe(2);
    expect(iconState(s, feed.id)).toEqual({ icon_url: FAVICON, icon_checked_at: s.clock().toISOString() });
  });

  it("is forgotten when a later search finds none", async () => {
    let icon = true;
    const s = setup([{ title: "A" }], { [FAVICON]: () => (icon ? ico() : new Response("gone", { status: 404 })) });
    const feed = await subscribe(s.deps, { url: FEED_URL });
    icon = false;
    s.clock.advance(31 * DAY);
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).iconUrl).toBeNull();
  });

  it("never fails the fetch when every place fails", async () => {
    const fail = () => new Response("down", { status: 500 });
    const s = setup([{ title: "A" }], { "https://example.org/robots.txt": () => new Response("", { status: 404 }), "https://example.org/": fail, [FAVICON]: fail });
    const feed = await subscribe(s.deps, { url: FEED_URL });
    expect(feed).toMatchObject({ iconUrl: null, articleCount: 1, lastError: null });
    expect(iconState(s, feed.id).icon_checked_at).toBe(START);
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

describe("a fetch the site answers with a wait or with gone", () => {
  const failing = (status: number, retryAfter?: string) => () =>
    new Response("no", { status, headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } });
  /** The next fetch as the doubled interval alone sets it, after the given failures in a row (30 minutes each). */
  const doubled = (s: ReturnType<typeof setup>, failures: number) => new Date(s.clock().getTime() + 30 * 60_000 * 2 ** failures).toISOString();

  it("waits at least until the time Retry-After gives on 429, and records it as a failure", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve(failing(429, "7200"));

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/HTTP status 429/) });
    expect(getFeed(s.db, feed.id)).toMatchObject({
      nextFetchAt: new Date(s.clock().getTime() + 2 * HOUR).toISOString(),
      failureCount: 1,
      lastError: expect.stringMatching(/429/),
      goneAt: null,
    });
  });

  it("keeps the doubled interval when it is later than the time Retry-After gives", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve(failing(429, "60"));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).nextFetchAt).toBe(doubled(s, 1));
  });

  it("waits only the doubled interval on 429 without Retry-After", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve(failing(429));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).nextFetchAt).toBe(doubled(s, 1));
  });

  it("reads an HTTP date on 503, and waits one day at most", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve(failing(503, "Sun, 01 Mar 2026 18:00:00 GMT"));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).nextFetchAt).toBe("2026-03-01T18:00:00.000Z");

    s.serve(failing(503, "Wed, 01 Apr 2026 00:00:00 GMT"));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).nextFetchAt).toBe(new Date(s.clock().getTime() + DAY).toISOString());
  });

  it("ignores Retry-After on any other failure", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve(failing(404, "7200"));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).nextFetchAt).toBe(doubled(s, 1));
  });

  it("forgets the time Retry-After gave once a later failure gives none", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve(failing(429, "36000"));
    await fetchFeed(s.deps, feed.id);
    s.serve(failing(500));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).nextFetchAt).toBe(doubled(s, 2));
  });

  it("records since when the feed answers 410, keeps that time while it goes on, and leaves the feed enabled", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    const first = s.clock().toISOString();
    s.serve(failing(410));

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/HTTP status 410/) });
    expect(getFeed(s.db, feed.id)).toMatchObject({ goneAt: first, failureCount: 1, lastError: expect.stringMatching(/410/), enabled: true });

    s.clock.advance(2 * HOUR);
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id)).toMatchObject({ goneAt: first, failureCount: 2, enabled: true, nextFetchAt: doubled(s, 2) });
  });

  it("forgets the 410 after another failure, and both the 410 and Retry-After after a success", async () => {
    const s = setup([{ title: "A" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve(failing(410));
    await fetchFeed(s.deps, feed.id);
    s.serve(failing(500));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id).goneAt).toBeNull();

    s.serve(failing(410));
    await fetchFeed(s.deps, feed.id);
    s.serve(failing(429, "36000"));
    await fetchFeed(s.deps, feed.id);
    s.serve([{ title: "A" }, { title: "B" }]);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "updated", created: 1 });
    expect(getFeed(s.db, feed.id)).toMatchObject({ goneAt: null, failureCount: 0, lastError: null, nextFetchAt: doubled(s, 0) });
  });

  it("refuses a subscription the site answers with 410, in the words it always used", async () => {
    const s = setup(failing(410));
    await expect(subscribe(s.deps, { url: FEED_URL })).rejects.toThrow(/the feed could not be fetched: HTTP status 410/);
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

describe("items whose identifier was replaced", () => {
  const keysOf = (s: ReturnType<typeof setup>) => s.db.prepare("SELECT item_key FROM articles ORDER BY id").all().map((row) => row.item_key);
  const readAll = (s: ReturnType<typeof setup>) => {
    for (const article of s.list()) setArticleFlags(s.db, article.id, { isRead: true }, START);
  };

  it("keeps the read articles when the identifiers move from http to https, and moves no time of a new item", async () => {
    const s = setup([
      { title: "Vendor ships a fix!", key: "http://example.org/?p=1", link: "https://example.org/posts/1" },
      { title: "Fix", key: "http://example.org/?p=2", link: "https://example.org/posts/2" },
    ]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    readAll(s);
    s.clock.advance(HOUR);
    s.serve([
      { title: "ＶＥＮＤＯＲ ships a fix", key: "https://example.org/?p=1", link: "https://example.org/posts/1" },
      { title: "fix", key: "https://example.org/?p=2", link: "https://example.org/posts/2" },
    ]);

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "updated", created: 0 });

    expect(s.list({ unread: "true" })).toEqual([]);
    expect(getFeed(s.db, feed.id)).toMatchObject({ articleCount: 2, lastNewItemAt: START });
    expect(keysOf(s).sort()).toEqual(["https://example.org/?p=1", "https://example.org/?p=2"]);
    // From then on the item is known by its new identifier.
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 0 });
  });

  it("moves the page of the article to https when the feed changes its identifiers and links together", async () => {
    const s = setup([{ title: "Vendor ships a fix", key: "old-1", link: "http://example.org/posts/1" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.clock.advance(HOUR);
    s.serve([{ title: "Vendor ships a fix", key: "post-0001", link: "https://example.org/posts/1" }]);

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 0 });

    expect(s.list()).toMatchObject([{ primaryUrl: "https://example.org/posts/1" }]);
    expect(s.db.prepare("SELECT item_key, dedup_url FROM articles").all()).toEqual([{ item_key: "post-0001", dedup_url: "https://example.org/posts/1" }]);
  });

  it("stores a new item with another title as new, on a feed whose items all point to one page", async () => {
    const s = setup([{ title: "Maintenance on Monday", key: "n1", link: "https://example.org/notice" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    readAll(s);
    s.clock.advance(HOUR);
    s.serve([{ title: "Maintenance on Friday", key: "n2", link: "https://example.org/notice", published: s.clock().toISOString() }]);

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 1 });

    expect(s.list({ unread: "true" }).map((article) => article.title)).toEqual(["Maintenance on Friday"]);
    expect(s.list().map((article) => article.title)).toContain("Maintenance on Monday");
  });

  it("stores the item as new while the old identifier is still in the document", async () => {
    const s = setup([{ title: "Vendor ships a fix", key: "a", link: "https://example.org/posts/1" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve([
      { title: "Vendor ships a fix", key: "b", link: "https://example.org/posts/1" },
      { title: "Vendor ships a fix", key: "a", link: "https://example.org/posts/1" },
    ]);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 1 });
    expect(keysOf(s)).toEqual(["a", "b"]);
  });

  it("stores the item as new when two stored articles have its page", async () => {
    const s = setup([
      { title: "Vendor ships a fix", key: "a", link: "https://example.org/posts/1" },
      { title: "Vendor ships a fix", key: "b", link: "http://example.org/posts/1" },
    ]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve([{ title: "Vendor ships a fix", key: "c", link: "https://example.org/posts/1" }]);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 1 });
    expect(keysOf(s).sort()).toEqual(["a", "b", "c"]);
  });

  it("stores the items as new when two of them match one stored article", async () => {
    const s = setup([{ title: "Vendor ships a fix", key: "a", link: "https://example.org/posts/1" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    s.serve([
      { title: "Vendor ships a fix", key: "b", link: "https://example.org/posts/1" },
      { title: "Vendor ships a fix", key: "c", link: "http://example.org/posts/1" },
    ]);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ created: 2 });
    expect(keysOf(s).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not send the title of a replaced item to translation when it did not change", async () => {
    const s = setup([]);
    updateSettings(s.db, { outputLanguage: "ja" });
    const llm = fakeLlm(s.db, s.clock, {});
    const google = fakeTranslator();
    const translation = new TranslationService({
      db: s.db,
      clock: s.clock,
      google,
      llm: new LlmTranslator(llm.runner),
      monthlyChars: 450_000,
      maxCharsPerArticle: 20_000,
      log: () => {},
    });
    const deps = { ...s.deps, translation };
    s.serve([{ title: "Vendor ships a fix", key: "http://example.org/?p=1", link: "https://example.org/posts/1" }]);
    const feed = await subscribe(deps, { url: FEED_URL, translate: true });
    s.serve([{ title: "Vendor ships a fix", key: "https://example.org/?p=1", link: "https://example.org/posts/1" }]);

    await fetchFeed(deps, feed.id);

    expect(google.calls).toHaveLength(1);
    expect(s.list()).toMatchObject([{ translatedTitle: "訳:Vendor ships a fix" }]);
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

  it("keeps the translations when only the attachments changed", async () => {
    const s = translating();
    const enclosure = (name: string) => `<enclosure url="https://cdn.example.org/${name}.mp3" type="audio/mpeg"/>`;
    s.serve([{ title: "Title", key: "a", content: "<p>Same content.</p>", extra: enclosure("old") }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, translate: true });
    const id = s.list()[0]!.id;
    await s.service.translateArticle(id);

    s.serve([{ title: "Title", key: "a", content: "<p>Same content.</p>", extra: enclosure("new") }]);
    await fetchFeed(s.deps, feed.id);

    const article = getArticle(s.db, id);
    expect(article.attachments.map((attachment) => attachment.url)).toEqual(["https://cdn.example.org/new.mp3"]);
    expect(article).toMatchObject({ translatedTitle: "訳:Title", translation: { segments: [{ translated: "訳:Same content." }] } });
  });

  it("drops the translation of an empty body once the media description fills it", async () => {
    const s = translating();
    s.serve([{ title: "Video", key: "v", content: "" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL, translate: true });
    const id = s.list()[0]!.id;
    // An empty body has nothing to translate; a stored translation stands for one made before the fetch.
    s.db.prepare("INSERT INTO article_translations (article_id, segments, method, created_at) VALUES (?, '[]', 'google', ?)").run(id, START);

    s.serve([{ title: "Video", key: "v", content: "", extra: "<media:group><media:description>What the video shows.</media:description></media:group>" }]);
    await fetchFeed(s.deps, feed.id);

    expect(getArticle(s.db, id).body).toBe("What the video shows.");
    expect(s.db.prepare("SELECT count(*) AS n FROM article_translations").get()).toEqual({ n: 0 });
  });
});

describe("attachments and media descriptions", () => {
  const PAGE_OF_ITEM = "https://example.org/posts/ep";
  const media = `<enclosure url="https://cdn.example.org/ep.mp3" type="audio/mpeg" length="2048"/>
    <media:thumbnail url="/thumbs/ep.jpg"/>
    <media:description>Line one
https://example.com/x</media:description>`;

  it("stores the attachments of a new article, and makes its body of the media description when it has no content", async () => {
    const s = setup([{ title: "Episode", key: "ep", link: PAGE_OF_ITEM, content: "", extra: media }]);
    await subscribe(s.deps, { url: FEED_URL });
    const article = getArticle(s.db, s.list()[0]!.id);
    expect(article.body).toBe("Line one\\\n[https://example.com/x](https://example.com/x)");
    expect(article.attachments).toEqual([
      { url: "https://cdn.example.org/ep.mp3", kind: "audio", mimeType: "audio/mpeg", size: 2048, title: null, thumbnailOf: null, imageUrl: null },
      { url: "https://example.org/thumbs/ep.jpg", kind: "image", mimeType: null, size: null, title: null, thumbnailOf: PAGE_OF_ITEM, imageUrl: null },
    ]);
  });

  it("keeps the content and leaves the description out when the item has content", async () => {
    const s = setup([{ title: "Episode", key: "ep", link: PAGE_OF_ITEM, content: "<p>Show notes.</p>", extra: media }]);
    await subscribe(s.deps, { url: FEED_URL });
    expect(getArticle(s.db, s.list()[0]!.id).body).toBe("Show notes.");
  });

  it("rewrites an empty article stored before with the description, and judges it again", async () => {
    const s = setup([{ title: "Episode", key: "ep", content: "" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    expect(getArticle(s.db, s.list()[0]!.id).attachments).toEqual([]);
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["content"], match: "contains", value: "sponsored" }] }, s.clock);
    expect(s.list()).toHaveLength(1);

    s.serve([{ title: "Episode", key: "ep", content: "", extra: "<media:description>This episode is sponsored.</media:description>" }]);
    await fetchFeed(s.deps, feed.id);

    expect(s.list()).toEqual([]);
    expect(s.db.prepare("SELECT body FROM articles").get()).toEqual({ body: "This episode is sponsored." });
  });

  it("writes only the attachments when nothing else changed, and does not judge the article again", async () => {
    const s = setup([{ title: "Episode", key: "ep", content: "<p>Notes.</p>" }]);
    const feed = await subscribe(s.deps, { url: FEED_URL });
    const id = s.list()[0]!.id;
    createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["content"], match: "contains", value: "Notes" }] }, s.clock);
    // What the filter found is cleared by hand: judging the article again would find it once more.
    s.db.prepare("DELETE FROM filter_matches").run();

    s.serve([{ title: "Episode", key: "ep", content: "<p>Notes.</p>", extra: '<enclosure url="https://cdn.example.org/ep.mp3" type="audio/mpeg"/>' }]);
    await fetchFeed(s.deps, feed.id);

    expect(getArticle(s.db, id).attachments.map((attachment) => attachment.url)).toEqual(["https://cdn.example.org/ep.mp3"]);
    expect(s.db.prepare("SELECT count(*) AS n FROM filter_matches").get()).toEqual({ n: 0 });

    s.serve([{ title: "Episode", key: "ep", content: "<p>Notes.</p>" }]);
    await fetchFeed(s.deps, feed.id);
    expect(getArticle(s.db, id).attachments).toEqual([]);
  });

  it("gives no attachments for an article whose stored list cannot be read", async () => {
    const s = setup([{ title: "Episode", key: "ep" }]);
    await subscribe(s.deps, { url: FEED_URL });
    const id = s.list()[0]!.id;
    s.db.prepare("UPDATE articles SET attachments = 'not json' WHERE id = ?").run(id);
    expect(getArticle(s.db, id).attachments).toEqual([]);
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

  it("applies the rules to the article kept, and not to a hidden duplicate", async () => {
    const s = several();
    createRule(s.db, { scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "fix" }], actions: ["star"] }, s.clock);
    await s.deliver("A", [{ key: "a", title: "Vendor ships a fix", link: "https://news.example.org/1" }]);
    await s.deliver("B", [{ key: "b", title: "Vendor ships a fix", link: "https://news.example.org/1" }]);

    const starred = (name: "A" | "B", key: string) => s.db.prepare("SELECT starred FROM articles WHERE id = ?").get(s.idOf(name, key))!.starred;
    expect(s.duplicateOf("B", "b")).toBe(s.idOf("A", "a"));
    expect(starred("A", "a")).toBe(1);
    expect(starred("B", "b")).toBe(0);
  });

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
    // What the subscription asked for its icon is not the point here.
    const before = s.requests.length;

    await fetchFeed(s.deps, s.feed.id);

    expect(getArticle(s.db, s.id)).toMatchObject({
      title: "A (corrected)",
      body: "Better words.",
      fullContentStatus: "fetched",
      fullContent: { body: FULL_MARKDOWN, fetchedAt: START },
    });
    expect(s.requests.slice(before).map((request) => request.url).filter((url) => url !== FEED_URL)).toEqual([]);
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

describe("a web feed", () => {
  const PAGE = "https://news.example.org/list/";
  const ROBOTS = "https://news.example.org/robots.txt";
  const SELECTORS = { item: "li.post", date: "time" };

  const post = (n: number, date?: string) =>
    `<li class="post"><a href="/posts/${n}">Post ${n}</a>${date ? `<time datetime="${date}">${date}</time>` : ""}<p>Excerpt ${n}</p></li>`;
  const page = (posts: string[], title = "Example News") =>
    `<!doctype html><html><head><title>${title}</title></head><body><nav><a href="/">Home</a></nav><ul>${posts.join("")}</ul></body></html>`;

  function pageSetup(initial: string) {
    const db = createTestDb();
    const clock = fakeClock(START);
    let body = initial;
    let answer: (() => Response) | null = null;
    let robots: string | null = null;
    const fake = fakeFetch(
      {
        [ROBOTS]: () => (robots === null ? new Response("", { status: 404 }) : new Response(robots, { status: 200 })),
        [PAGE]: () => (answer === null ? html(body) : answer()),
      },
      clock,
    );
    const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
    const llm = fakeLlm(db, clock, {});
    return {
      db,
      clock,
      deps: { db, clock, fetcher },
      requests: fake.requests,
      pageRequests: () => fake.requests.filter((request) => request.url === PAGE),
      llmCalls: () => Object.values(llm.requests).flat().length + Number(db.prepare("SELECT count(*) AS n FROM llm_calls").get()!.n),
      serve(next: string) {
        body = next;
        answer = null;
      },
      /** Answers the page with this instead of the body. */
      respond(next: () => Response) {
        answer = next;
      },
      forbid(rules: string) {
        robots = rules;
      },
      list: () => listArticles(db, {}, clock().toISOString()).items,
    };
  }

  it("stores the page under its title, with every article it lists as an unread article", async () => {
    const s = pageSetup(page(Array.from({ length: 10 }, (_unused, n) => post(n + 1, "2026-02-28T09:00:00Z"))));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });

    expect(feed).toMatchObject({ title: "Example News", format: "page", selectors: SELECTORS, siteUrl: PAGE, lastError: null });
    const articles = s.list();
    expect(articles).toHaveLength(10);
    expect(articles.every((article) => !article.isRead && article.feedId === feed.id)).toBe(true);
    expect(articles[0]).toMatchObject({ title: "Post 1", summary: "", primaryUrl: "https://news.example.org/posts/1" });
    expect(getArticle(s.db, articles[0]!.id).body).toBe("");
    expect(s.llmCalls()).toBe(0);
  });

  it("refuses a page none of whose elements the item selector matches, and stores nothing", async () => {
    const s = pageSetup(page([post(1)]));
    await expect(subscribe(s.deps, { url: PAGE, format: "page", selectors: { item: "article.entry" } })).rejects.toThrow(/no article could be taken out/);
    expect(listFeeds(s.db)).toEqual([]);
  });

  it("refuses a page robots.txt forbids without asking for the page", async () => {
    const s = pageSetup(page([post(1)]));
    s.forbid("User-agent: *\nDisallow: /list/");
    await expect(subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS })).rejects.toThrow(/robots\.txt forbids/);
    expect(s.pageRequests()).toEqual([]);
    expect(listFeeds(s.db)).toEqual([]);
  });

  it("records robots.txt as the reason when it forbids the page after the subscription", async () => {
    const s = pageSetup(page([post(1)]));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });
    s.forbid("User-agent: *\nDisallow: /");
    s.clock.advance(HOUR);

    const outcome = await fetchFeed(s.deps, feed.id);
    expect(outcome).toMatchObject({ status: "failed", error: "robots.txt forbids" });
    expect(s.pageRequests()).toHaveLength(1);
    expect(getFeed(s.db, feed.id)).toMatchObject({ lastError: "robots.txt forbids", failureCount: 1 });
  });

  it("sorts an article without a date by the fetch that found it", async () => {
    const s = pageSetup(page([post(1, "2026-02-28T09:00:00Z")]));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });
    s.clock.advance(HOUR);
    s.serve(page([post(2), post(1, "2026-02-28T09:00:00Z")]));

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "updated", created: 1 });
    const newest = s.list()[0]!;
    expect(newest).toMatchObject({ title: "Post 2", firstPublishedAt: s.clock().toISOString() });
  });

  it("records a fetch whose page has no item element as a failure, and keeps the times of the last success and the last new item", async () => {
    const s = pageSetup(page([post(1)]));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });
    const before = getFeed(s.db, feed.id);
    s.clock.advance(HOUR);
    s.serve(page([], "Redesigned").replace("<ul></ul>", '<div class="cards"><a href="/posts/9">Post 9</a></div>'));

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "failed", created: 0, error: "no element matches the item selector" });
    const after = getFeed(s.db, feed.id);
    expect(after).toMatchObject({
      lastError: "no element matches the item selector",
      lastFetchedAt: s.clock().toISOString(),
      lastSucceededAt: before.lastSucceededAt,
      lastNewItemAt: before.lastNewItemAt,
      title: "Example News",
    });
    expect(s.list()).toHaveLength(1);

    // New selectors that find the articles again: the reason goes, and the fetch is a success.
    updateFeed(s.db, feed.id, { selectors: { item: "div.cards a" } });
    s.clock.advance(HOUR);
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "updated", created: 1 });
    expect(getFeed(s.db, feed.id)).toMatchObject({ lastError: null, failureCount: 0, lastSucceededAt: s.clock().toISOString() });
    expect(s.list().map((article) => article.title)).toEqual(["Post 9", "Post 1"]);
  });

  it("waits until the time Retry-After gives on 429, and records 410 apart, as a feed does", async () => {
    const s = pageSetup(page([post(1)]));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });
    s.clock.advance(HOUR);
    s.respond(() => new Response("slow down", { status: 429, headers: { "retry-after": "10800" } }));

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "failed", error: `HTTP status 429: ${PAGE}` });
    expect(getFeed(s.db, feed.id)).toMatchObject({ nextFetchAt: new Date(s.clock().getTime() + 3 * HOUR).toISOString(), goneAt: null });

    s.respond(() => new Response("gone", { status: 410 }));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id)).toMatchObject({ goneAt: s.clock().toISOString(), failureCount: 2, enabled: true });

    s.serve(page([post(2), post(1)]));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id)).toMatchObject({ goneAt: null, failureCount: 0 });
  });

  it("keeps the articles whose links only move from http to https", async () => {
    const linked = (n: number, scheme: string) => `<li class="post"><a href="${scheme}://news.example.org/posts/${n}">Post ${n}</a><p>Excerpt ${n}</p></li>`;
    const s = pageSetup(page([linked(1, "http"), linked(2, "http")]));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });
    s.clock.advance(HOUR);
    s.serve(page([linked(1, "https"), linked(2, "https")]));

    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "updated", created: 0 });
    expect(s.list().map((article) => article.primaryUrl)).toEqual(["https://news.example.org/posts/1", "https://news.example.org/posts/2"]);
  });

  it("sends no conditional request", async () => {
    const s = pageSetup(page([post(1)]));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });
    s.clock.advance(HOUR);
    await fetchFeed(s.deps, feed.id);
    for (const request of s.pageRequests()) {
      expect(request.headers["if-none-match"]).toBeUndefined();
      expect(request.headers["if-modified-since"]).toBeUndefined();
    }
    expect(s.pageRequests()).toHaveLength(2);
  });

  it("looks for the icon in the page it fetched, without asking for it again", async () => {
    const s = pageSetup(page([post(1)]).replace("</head>", '<link rel="icon" href="/fav.png"></head>'));
    const feed = await subscribe(s.deps, { url: PAGE, format: "page", selectors: SELECTORS });
    expect(s.pageRequests()).toHaveLength(1);
    expect(s.requests.map((request) => request.url)).toContain("https://news.example.org/fav.png");
    expect(feed.iconUrl).toBeNull();
  });

  it("calls no model to subscribe, to fetch, or to store, for three web feeds", async () => {
    const s = pageSetup(page([post(1), post(2)]));
    const feeds = [];
    for (const query of ["", "?a", "?b"]) {
      feeds.push(await subscribe(s.deps, { url: `${PAGE}${query}`, format: "page", selectors: SELECTORS }));
    }
    s.clock.advance(HOUR);
    s.serve(page([post(3), post(1), post(2)]));
    for (const feed of feeds) await fetchFeed(s.deps, feed.id);
    expect(s.list().length).toBeGreaterThan(0);
    expect(s.llmCalls()).toBe(0);
  });
});

const OLD_URL = "http://old.example.org/feed.xml";
const NEW_URL = "https://new.example.org/feed.xml";
const OTHER_URL = "https://other.example.org/feed.xml";
const MID_URL = "https://mid.example.org/feed.xml";

/** A feed at `OLD_URL` whose answer can be changed, and the same items at the other URLs. */
function moveSetup() {
  const db = createTestDb();
  const clock = fakeClock(START);
  const items: Item[] = [
    { title: "First post", key: "k1", link: "/posts/1" },
    { title: "Second post", key: "k2", link: "/posts/2" },
  ];
  let answer: () => Response = () => xml(rss(items));
  const same = () => xml(rss(items));
  const fake = fakeFetch({ [OLD_URL]: () => answer(), [NEW_URL]: same, [OTHER_URL]: same, [MID_URL]: same }, clock);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
  const deps = { db, clock, fetcher };
  const llm = fakeLlm(db, clock, {});
  return {
    db,
    clock,
    deps,
    requests: fake.requests,
    llmCalls: () => Object.values(llm.requests).flat().length,
    /** Answers the old URL with a redirect of this status to `location`. */
    redirect(location: string, status = 301) {
      answer = () => new Response(null, { status, headers: { location } });
    },
    respond(next: () => Response) {
      answer = next;
    },
    async fetchTimes(feedId: number, times: number) {
      for (let n = 0; n < times; n++) {
        clock.advance(HOUR);
        expect(await fetchFeed(deps, feedId)).not.toMatchObject({ status: "failed" });
      }
    },
    list: () => listArticles(db, {}, clock().toISOString()).items,
  };
}

describe("a feed that moved for good", () => {
  it("takes the target of a permanent redirect as its URL at the third successful fetch in a row, and keeps its articles", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    const [first] = s.list();
    setArticleFlags(s.db, first!.id, { starred: true }, START);
    saveArticleNote(s.db, first!.id, "A note", START);
    s.redirect(NEW_URL);

    await s.fetchTimes(feed.id, 2);
    expect(getFeed(s.db, feed.id)).toMatchObject({ url: OLD_URL, movedFrom: null, movedAt: null });

    await s.fetchTimes(feed.id, 1);
    expect(getFeed(s.db, feed.id)).toMatchObject({ url: NEW_URL, movedFrom: OLD_URL, movedAt: s.clock().toISOString(), lastError: null, starredCount: 1, annotatedCount: 1 });
    expect(s.list()).toHaveLength(2);

    // From then on the feed is asked at its new URL.
    await s.fetchTimes(feed.id, 1);
    expect(s.requests.at(-1)!.url).toBe(NEW_URL);
    expect(s.list()).toHaveLength(2);
    expect(s.llmCalls()).toBe(0);
  });

  it("starts counting again after a fetch that is not redirected", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 2);
    s.respond(() => xml(rss([{ title: "First post", key: "k1" }])));
    await s.fetchTimes(feed.id, 1);
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 2);
    expect(getFeed(s.db, feed.id).url).toBe(OLD_URL);
    await s.fetchTimes(feed.id, 1);
    expect(getFeed(s.db, feed.id).url).toBe(NEW_URL);
  });

  it("starts counting again when the redirect leads elsewhere", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 2);
    s.redirect(OTHER_URL);
    await s.fetchTimes(feed.id, 1);
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 2);
    expect(getFeed(s.db, feed.id).url).toBe(OLD_URL);
  });

  it("leaves the count as it is after a failed fetch", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 2);
    s.respond(() => new Response("oops", { status: 500 }));
    expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "failed" });
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 1);
    expect(getFeed(s.db, feed.id)).toMatchObject({ url: NEW_URL, movedFrom: OLD_URL, failureCount: 0 });
  });

  it("does not count a redirect to a target that is no feed: the fetch fails", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect("https://new.example.org/");
    for (let n = 0; n < 3; n++) expect(await fetchFeed(s.deps, feed.id)).toMatchObject({ status: "failed" });
    expect(getFeed(s.db, feed.id).url).toBe(OLD_URL);
  });

  it("counts a not-modified answer of the target as a success", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.deps.fetcher = new Fetcher({
      userAgent: "t",
      hostIntervalMs: 0,
      timeoutMs: 1000,
      maxBytes: 5_000_000,
      fetchImpl: fakeFetch({
        [OLD_URL]: () => new Response(null, { status: 301, headers: { location: `${NEW_URL}?unchanged` } }),
        [NEW_URL]: () => new Response(null, { status: 304 }),
      }).fetchImpl,
      clock: s.clock,
      sleep: async () => {},
    });
    await s.fetchTimes(feed.id, 3);
    expect(getFeed(s.db, feed.id)).toMatchObject({ url: `${NEW_URL}?unchanged`, movedFrom: OLD_URL });
  });

  it("takes the target of the permanent redirects before a temporary one", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.deps.fetcher = new Fetcher({
      userAgent: "t",
      hostIntervalMs: 0,
      timeoutMs: 1000,
      maxBytes: 5_000_000,
      fetchImpl: fakeFetch({
        [OLD_URL]: () => new Response(null, { status: 301, headers: { location: `${MID_URL}?step` } }),
        [`${MID_URL}?step`]: () => new Response(null, { status: 302, headers: { location: NEW_URL } }),
        [NEW_URL]: () => xml(rss([{ title: "First post", key: "k1" }])),
      }).fetchImpl,
      clock: s.clock,
      sleep: async () => {},
    });
    await s.fetchTimes(feed.id, 3);
    expect(getFeed(s.db, feed.id).url).toBe(`${MID_URL}?step`);
  });

  it("never follows a temporary redirect", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect(NEW_URL, 302);
    await s.fetchTimes(feed.id, 3);
    s.redirect(NEW_URL, 307);
    await s.fetchTimes(feed.id, 3);
    expect(getFeed(s.db, feed.id)).toMatchObject({ url: OLD_URL, movedFrom: null });
  });

  it("follows a 308 as it does a 301", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect(NEW_URL, 308);
    await s.fetchTimes(feed.id, 3);
    expect(getFeed(s.db, feed.id).url).toBe(NEW_URL);
  });

  it("neither counts nor follows a redirect to the URL of another feed, and records the fetch as a success", async () => {
    const s = moveSetup();
    const other = await subscribe(s.deps, { url: NEW_URL });
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 4);
    expect(getFeed(s.db, feed.id)).toMatchObject({ url: OLD_URL, movedFrom: null, lastError: null, failureCount: 0 });
    // Once the other feed is gone, counting starts from nothing.
    deleteFeed(s.db, other.id);
    await s.fetchTimes(feed.id, 2);
    expect(getFeed(s.db, feed.id).url).toBe(OLD_URL);
    await s.fetchTimes(feed.id, 1);
    expect(getFeed(s.db, feed.id).url).toBe(NEW_URL);
  });

  it("follows the permanent redirect of a web feed only by fetches whose page gives articles", async () => {
    const OLD_PAGE = "http://old.example.org/news/";
    const NEW_PAGE = "https://new.example.org/news/";
    const db = createTestDb();
    const clock = fakeClock(START);
    const list = (inner: string) => `<!doctype html><html><head><title>News</title></head><body><ul>${inner}</ul></body></html>`;
    let target = list('<li class="post"><a href="/posts/1">Post 1</a></li>');
    let old: () => Response = () => html(target);
    const fake = fakeFetch(
      { "http://old.example.org/robots.txt": () => new Response("", { status: 404 }), "https://new.example.org/robots.txt": () => new Response("", { status: 404 }), [OLD_PAGE]: () => old(), [NEW_PAGE]: () => html(target) },
      clock,
    );
    const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
    const deps = { db, clock, fetcher };
    const feed = await subscribe(deps, { url: OLD_PAGE, format: "page", selectors: { item: "li.post" } });
    old = () => new Response(null, { status: 301, headers: { location: NEW_PAGE } });

    await fetchFeed(deps, feed.id);
    target = list("");
    expect(await fetchFeed(deps, feed.id)).toMatchObject({ status: "failed" });
    target = list('<li class="post"><a href="/posts/1">Post 1</a></li>');
    await fetchFeed(deps, feed.id);
    expect(getFeed(db, feed.id).url).toBe(OLD_PAGE);
    await fetchFeed(deps, feed.id);
    expect(getFeed(db, feed.id)).toMatchObject({ url: NEW_PAGE, movedFrom: OLD_PAGE });
  });
});

describe("changing the URL of a feed", () => {
  it("fetches the new URL, keeps the articles with their stars, notes and reading, and forgets what it knew of the old one", async () => {
    const s = moveSetup();
    s.respond(() => new Response(rss([{ title: "First post", key: "k1", link: "/posts/1" }, { title: "Second post", key: "k2", link: "/posts/2" }]), { headers: { "content-type": "application/xml", etag: '"old"' } }));
    const feed = await subscribe(s.deps, { url: OLD_URL });
    const [first, second] = s.list();
    setArticleFlags(s.db, first!.id, { starred: true }, START);
    saveArticleNote(s.db, first!.id, "A note", START);
    setArticleFlags(s.db, second!.id, { isRead: true }, START);
    s.respond(() => new Response("oops", { status: 410 }));
    await fetchFeed(s.deps, feed.id);
    expect(getFeed(s.db, feed.id)).toMatchObject({ failureCount: 1 });

    s.clock.advance(HOUR);
    const changed = await changeFeedUrl(s.deps, feed.id, { url: NEW_URL, title: "Moved blog" });

    expect(changed).toMatchObject({
      url: NEW_URL,
      title: "Moved blog",
      lastError: null,
      failureCount: 0,
      goneAt: null,
      movedFrom: null,
      lastSucceededAt: s.clock().toISOString(),
      starredCount: 1,
      annotatedCount: 1,
      articleCount: 2,
    });
    expect(s.list().find((article) => article.id === second!.id)).toMatchObject({ isRead: true });
    // The ETag of the old URL is not sent to the new one.
    s.clock.advance(HOUR);
    await fetchFeed(s.deps, feed.id);
    expect(s.requests.at(-1)).toMatchObject({ url: NEW_URL });
    expect(s.requests.at(-1)!.headers["if-none-match"]).toBeUndefined();
    expect(s.llmCalls()).toBe(0);
  });

  it("stores the new items the new URL delivers", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.deps.fetcher = new Fetcher({
      userAgent: "t",
      hostIntervalMs: 0,
      timeoutMs: 1000,
      maxBytes: 5_000_000,
      fetchImpl: fakeFetch({ [NEW_URL]: () => xml(rss([{ title: "Third post", key: "k3" }, { title: "First post", key: "k1" }])) }).fetchImpl,
      clock: s.clock,
      sleep: async () => {},
    });
    expect(await changeFeedUrl(s.deps, feed.id, { url: NEW_URL })).toMatchObject({ articleCount: 3 });
  });

  it("forgets a move that permanent redirects made", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    s.redirect(NEW_URL);
    await s.fetchTimes(feed.id, 3);
    expect(getFeed(s.db, feed.id).movedFrom).toBe(OLD_URL);
    expect(await changeFeedUrl(s.deps, feed.id, { url: OTHER_URL })).toMatchObject({ url: OTHER_URL, movedFrom: null, movedAt: null });
  });

  it("refuses a URL that is no feed, as a fault of the URL, and changes nothing", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    const error = await changeFeedUrl(s.deps, feed.id, { url: "https://new.example.org/", title: "Renamed" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).fields).toEqual([expect.objectContaining({ path: "url", code: "unreachable" })]);
    expect(getFeed(s.db, feed.id)).toMatchObject({ url: OLD_URL, title: "Example Feed" });
  });

  it("refuses the URL of another feed without fetching it", async () => {
    const s = moveSetup();
    await subscribe(s.deps, { url: NEW_URL });
    const feed = await subscribe(s.deps, { url: OLD_URL });
    const asked = s.requests.length;
    await expect(changeFeedUrl(s.deps, feed.id, { url: `${NEW_URL}?utm_source=x` })).rejects.toThrow(/already subscribed/);
    expect(s.requests).toHaveLength(asked);
    expect(getFeed(s.db, feed.id).url).toBe(OLD_URL);
  });

  it("changes the rest without a fetch when the URL is the one the feed has", async () => {
    const s = moveSetup();
    const feed = await subscribe(s.deps, { url: OLD_URL });
    const asked = s.requests.length;
    expect(await changeFeedUrl(s.deps, feed.id, { url: `${OLD_URL}#top`, title: "Renamed" })).toMatchObject({ url: OLD_URL, title: "Renamed" });
    expect(s.requests).toHaveLength(asked);
  });

  it("checks a web feed with its selectors, or with the ones sent along", async () => {
    const OLD_PAGE = "https://old.example.org/news/";
    const NEW_PAGE = "https://new.example.org/news/";
    const db = createTestDb();
    const clock = fakeClock(START);
    const list = (inner: string) => `<!doctype html><html><head><title>News</title></head><body>${inner}</body></html>`;
    const fake = fakeFetch(
      {
        "https://old.example.org/robots.txt": () => new Response("", { status: 404 }),
        "https://new.example.org/robots.txt": () => new Response("", { status: 404 }),
        // Absolute links: an item without a key is told apart by its link, and a relative one resolves against the page.
        [OLD_PAGE]: () => html(list('<ul><li class="post"><a href="https://blog.example.org/posts/1">Post 1</a></li></ul>')),
        [NEW_PAGE]: () => html(list('<div class="card"><a href="https://blog.example.org/posts/1">Post 1</a></div>')),
      },
      clock,
    );
    const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
    const deps = { db, clock, fetcher };
    const feed = await subscribe(deps, { url: OLD_PAGE, format: "page", selectors: { item: "li.post" } });

    await expect(changeFeedUrl(deps, feed.id, { url: NEW_PAGE })).rejects.toThrow(/no article could be taken out/);
    expect(getFeed(db, feed.id).url).toBe(OLD_PAGE);
    const changed = await changeFeedUrl(deps, feed.id, { url: NEW_PAGE, selectors: { item: "div.card" } });
    expect(changed).toMatchObject({ url: NEW_PAGE, selectors: { item: "div.card" }, articleCount: 1 });
  });
});
