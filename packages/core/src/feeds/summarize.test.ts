import { describe, expect, it } from "vitest";
import { getArticle, recordFullContentFailure, saveFullContent, setArticleFlags } from "../db/articles.ts";
import { insertFeed, updateFeed } from "../db/feeds.ts";
import { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { createTestDb, fakeClock, seedFeedArticle } from "../testing/db.ts";
import { fakeFetch, html, xml } from "../testing/http.ts";
import { resolvePricing, type ModelPricing } from "../llm/pricing.ts";
import { fakeLlm, type FakeHandler } from "../testing/llm.ts";
import { FullContentWorker } from "./full-content.ts";
import { FeedPoller } from "./poller.ts";
import { summarizeNext, SummaryWorker } from "./summarize.ts";

const START = "2026-03-01T12:00:00.000Z";
const MINUTE = 60_000;
const FEED_URL = "https://feeds.example.org/feed.xml";

/** Text of a given length that reads like prose, so that the page extraction keeps it. */
const prose = (word: string, chars: number) => `${word} `.repeat(Math.ceil(chars / (word.length + 1))).trim();
const page = (text: string) => html(`<html><head><title>Page</title></head><body><article><h1>Page</h1><p>${text}</p><p>${text}</p></article></body></html>`);
const PAGE_TEXT = prose("fulltext", 400);
const DELIVERED = prose("excerpt", 300);

function setup(
  routes: Parameters<typeof fakeFetch>[0],
  summarize: FakeHandler = () => ({ summary: "A summary." }),
  limits: { summariesPerDay?: number } = {},
  feedOptions: { fetchFullContent?: boolean } = {},
  pricing?: ModelPricing,
) {
  const db = createTestDb();
  const clock = fakeClock(START);
  const fake = fakeFetch(routes, clock);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 1_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
  const llm = fakeLlm(db, clock, { summarize }, { limits: { llmCallsPerRun: 40, llmCallsPerDay: 300, ...limits }, pricing });
  const fullContent = new FullContentWorker({ db, clock, fetcher });
  const deps = { db, clock, fetcher, runner: llm.runner, fullContent };
  const feed = insertFeed(db, { url: FEED_URL, title: "Feed", autoSummarize: true, ...feedOptions }, clock);
  clock.advance(MINUTE);
  let serial = 0;
  /** A feed article stored now, a minute after the feed began to summarise or later. */
  const article = (options: { body?: string; url?: string | null } = {}) => {
    serial += 1;
    clock.advance(MINUTE);
    return seedFeedArticle(db, feed.id, { at: clock().toISOString(), body: options.body ?? DELIVERED, url: options.url === undefined ? `https://site.example.org/${serial}` : options.url });
  };
  const pages = new PageFetcher(fetcher, { pagesPerRun: Number.POSITIVE_INFINITY, remember: false });
  const calls = () => db.prepare("SELECT task, ok FROM llm_calls ORDER BY id").all();
  const pageRequests = () => fake.urls().filter((url) => !url.endsWith("/robots.txt"));
  return { db, clock, deps, feed, fetcher, article, pages, prompts: () => llm.requests.summarize.map((request) => request.prompt), urls: fake.urls, pageRequests, calls, fullContent };
}

describe("summarizeNext", () => {
  it("summarises from the article's page, and stores the summary but not the page", async () => {
    const s = setup({ "https://site.example.org/1": () => page(PAGE_TEXT) });
    const id = s.article();
    s.clock.advance(MINUTE);

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");

    expect(s.prompts()).toHaveLength(1);
    expect(s.prompts()[0]).toContain("fulltext fulltext");
    expect(s.prompts()[0]).not.toContain("excerpt");
    expect(s.prompts()[0]).toContain("Output language: ja");
    const stored = getArticle(s.db, id);
    expect(stored.autoSummary).toEqual({ text: "A summary.", source: "page", createdAt: s.clock().toISOString() });
    expect(stored.autoSummaryPending).toBe(false);
    expect(stored.body).toBe(DELIVERED);
    expect(JSON.stringify(s.db.prepare("SELECT * FROM articles WHERE id = ?").get(id))).not.toContain("fulltext");
    expect(s.calls()).toEqual([{ task: "summarize", ok: 1 }]);
  });

  it("stores no full content from the page it read for a feed that does not fetch full content", async () => {
    const s = setup({ "https://site.example.org/1": () => page(PAGE_TEXT) });
    const id = s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");

    expect(getArticle(s.db, id)).toMatchObject({ fullContent: null, fullContentStatus: "none", body: DELIVERED });
  });

  it("summarises from the stored full content without fetching the page, and says it read the page", async () => {
    const s = setup({ "https://site.example.org/1": () => page(PAGE_TEXT) });
    const id = s.article();
    saveFullContent(s.db, id, { markdown: prose("stored", 400), text: prose("stored", 400), now: s.clock().toISOString() });

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");

    expect(s.urls()).toEqual([]);
    expect(s.prompts()[0]).toContain("stored stored");
    expect(getArticle(s.db, id).autoSummary?.source).toBe("page");
  });

  it("summarises an article whose full content failed from what the feed delivered, without fetching the page", async () => {
    const s = setup({ "https://site.example.org/1": () => page(PAGE_TEXT) });
    const id = s.article();
    recordFullContentFailure(s.db, id, { reason: "http", detail: "404" });

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");

    expect(s.urls()).toEqual([]);
    expect(s.prompts()[0]).toContain("excerpt excerpt");
    expect(getArticle(s.db, id).autoSummary?.source).toBe("feed");
  });

  it("requests the page once for a feed that fetches full content and summarises, and stores both", async () => {
    const s = setup({ "https://site.example.org/1": () => page(PAGE_TEXT) }, undefined, {}, { fetchFullContent: true });
    const id = s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    s.fullContent.tick();
    await s.fullContent.idle();

    expect(s.pageRequests()).toEqual(["https://site.example.org/1"]);
    const article = getArticle(s.db, id);
    expect(article.fullContent?.body).toContain("fulltext fulltext");
    expect(article.autoSummary?.source).toBe("page");
    expect(s.prompts()[0]).toContain("fulltext fulltext");
  });

  it("summarises from what the feed delivered when the full content fails, with one request for the page", async () => {
    const s = setup({}, undefined, {}, { fetchFullContent: true });
    const id = s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");

    expect(s.pageRequests()).toEqual(["https://site.example.org/1"]);
    expect(getArticle(s.db, id)).toMatchObject({ fullContentStatus: "failed", autoSummary: { source: "feed" } });
  });

  it("summarises from what the feed delivered when the page cannot be fetched, and says so", async () => {
    const s = setup({});
    const id = s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");

    expect(s.urls()).toContain("https://site.example.org/1");
    expect(s.prompts()[0]).toContain("excerpt excerpt");
    expect(getArticle(s.db, id).autoSummary).toMatchObject({ text: "A summary.", source: "feed" });
  });

  it("summarises from what the feed delivered when the page holds too little text", async () => {
    const s = setup({ "https://site.example.org/1": () => page("Please enable scripts.") });
    const id = s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    expect(getArticle(s.db, id).autoSummary?.source).toBe("feed");
  });

  it("does not fetch a page that robots.txt forbids", async () => {
    const s = setup({
      "https://site.example.org/robots.txt": () => new Response("User-agent: *\nDisallow: /", { status: 200 }),
      "https://site.example.org/1": () => page(PAGE_TEXT),
    });
    const id = s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    expect(s.urls()).not.toContain("https://site.example.org/1");
    expect(getArticle(s.db, id).autoSummary?.source).toBe("feed");
  });

  it("summarises an article without a page from what the feed delivered", async () => {
    const s = setup({});
    const id = s.article({ url: null });

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    expect(s.urls()).toEqual([]);
    expect(getArticle(s.db, id).autoSummary?.source).toBe("feed");
  });

  it("writes no summary when the page cannot be fetched and the feed delivered less than 200 characters", async () => {
    const s = setup({});
    const id = s.article({ body: prose("short", 50) });

    expect(await summarizeNext(s.deps, s.pages)).toBe("skipped");
    expect(s.prompts()).toEqual([]);
    expect(getArticle(s.db, id)).toMatchObject({ autoSummary: null, autoSummaryPending: false });
    expect(await summarizeNext(s.deps, s.pages)).toBe("none");
  });

  it("does nothing when no article waits", async () => {
    const s = setup({});
    setArticleFlags(s.db, s.article(), { isRead: true }, "2026-03-01T12:00:00.000Z");
    expect(await summarizeNext(s.deps, s.pages)).toBe("none");
    expect(s.urls()).toEqual([]);
    expect(s.prompts()).toEqual([]);
  });
});

describe("summarizeNext, when a call fails", () => {
  it("tries the article once more, then leaves it without a summary and goes on with the next", async () => {
    let failing = true;
    const s = setup({}, () => {
      if (failing) throw new Error("the provider is down");
      return { summary: "A summary." };
    });
    const older = s.article();
    const newer = s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("failed");
    expect(getArticle(s.db, newer).autoSummaryPending).toBe(true);
    expect(await summarizeNext(s.deps, s.pages)).toBe("failed");
    expect(getArticle(s.db, newer)).toMatchObject({ autoSummary: null, autoSummaryPending: false });

    failing = false;
    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    expect(getArticle(s.db, older).autoSummary?.text).toBe("A summary.");
    expect(await summarizeNext(s.deps, s.pages)).toBe("none");
    expect(s.calls()).toEqual([{ task: "summarize", ok: 0 }, { task: "summarize", ok: 0 }, { task: "summarize", ok: 1 }]);
  });

  it("counts an answer outside the schema as a failure", async () => {
    const s = setup({}, () => ({ summary: "" }));
    const id = s.article();
    expect(await summarizeNext(s.deps, s.pages)).toBe("failed");
    expect(getArticle(s.db, id).autoSummaryPending).toBe(true);
  });

  it("calls no model once the budget period has used its budget, and summarises in the next period", async () => {
    const s = setup({}, () => ({ summary: "A summary." }), {}, {}, resolvePricing("claude-haiku-5-5")!);
    const waiting = s.article();
    s.db
      .prepare("INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES ('write', 'write', 1, 1, ?, 100, 1)")
      .run(s.clock().toISOString());

    expect(await summarizeNext(s.deps, s.pages)).toBe("limit");
    expect(s.prompts()).toHaveLength(0);
    expect(getArticle(s.db, waiting)).toMatchObject({ autoSummary: null, autoSummaryPending: true });

    s.clock.set("2026-04-01T00:00:00.000Z");
    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    expect(getArticle(s.db, waiting).autoSummary?.text).toBe("A summary.");
  });

  it("calls no model and fetches no page once the day has used its allowance, and goes on the next day", async () => {
    const s = setup({}, () => ({ summary: "A summary." }), { summariesPerDay: 2 });
    const first = s.article();
    s.article();
    s.article();

    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    const requests = s.urls().length;
    expect(await summarizeNext(s.deps, s.pages)).toBe("limit");
    expect(s.prompts()).toHaveLength(2);
    expect(s.urls()).toHaveLength(requests);
    // The newest went first; the oldest still waits, and a day without allowance is not a failure.
    expect(getArticle(s.db, first)).toMatchObject({ autoSummary: null, autoSummaryPending: true });

    s.clock.advance(24 * 60 * MINUTE);
    expect(await summarizeNext(s.deps, s.pages)).toBe("summarized");
    expect(getArticle(s.db, first).autoSummary?.text).toBe("A summary.");
  });
});

describe("SummaryWorker", () => {
  /** A model whose answers the test releases one by one. */
  function gated() {
    const waiting: Array<(value: unknown) => void> = [];
    const handler: FakeHandler = () => new Promise((resolve) => waiting.push(resolve));
    const release = async () => {
      waiting.shift()!({ summary: "A summary." });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { handler, release, settle, waiting };
  }

  it("summarises everything that waits, the newest first", async () => {
    const order: string[] = [];
    const s = setup({}, (request) => {
      order.push(/Headline:\n<material>\n(.*)\n/.exec(request.prompt)![1]!);
      return { summary: "A summary." };
    });
    const ids = [s.article(), s.article(), s.article()];
    const worker = new SummaryWorker(s.deps);

    worker.tick();
    await worker.idle();

    expect(order).toEqual(ids.reverse().map((id) => getArticle(s.db, id).title));
    expect(ids.every((id) => getArticle(s.db, id).autoSummary !== null)).toBe(true);
  });

  it("begins the next article only when the one before is finished, however often it is told to look", async () => {
    const gate = gated();
    const s = setup({}, gate.handler);
    s.article();
    s.article();
    const worker = new SummaryWorker(s.deps);

    worker.tick();
    worker.tick();
    await gate.settle();
    worker.tick();
    await gate.settle();
    expect(s.prompts()).toHaveLength(1);

    await gate.release();
    expect(s.prompts()).toHaveLength(2);
    await gate.release();
    await worker.idle();
    expect(s.calls()).toHaveLength(2);
  });

  it("tries a failed article again at the next look, not at once", async () => {
    const s = setup({}, () => {
      throw new Error("the provider is down");
    });
    const id = s.article();
    const worker = new SummaryWorker(s.deps);

    worker.tick();
    await worker.idle();
    expect(s.prompts()).toHaveLength(1);
    expect(getArticle(s.db, id).autoSummaryPending).toBe(true);

    worker.tick();
    await worker.idle();
    expect(s.prompts()).toHaveLength(2);
    expect(getArticle(s.db, id).autoSummaryPending).toBe(false);
  });

  it("begins no other article once it is stopped", async () => {
    const gate = gated();
    const s = setup({}, gate.handler);
    const older = s.article();
    const newer = s.article();
    const worker = new SummaryWorker(s.deps);

    worker.start(60_000);
    await gate.settle();
    worker.stop();
    await gate.release();
    await worker.idle();

    expect(getArticle(s.db, newer).autoSummary).not.toBeNull();
    expect(getArticle(s.db, older).autoSummary).toBeNull();
    worker.tick();
    await worker.idle();
    expect(s.prompts()).toHaveLength(1);
  });

  const rss = (content: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>Item</title><guid>item-1</guid><link>https://site.example.org/item</link><description>${content}</description></item></channel></rss>`;

  it("lets a feed be fetched and its articles stored while the model has not answered", async () => {
    const gate = gated();
    const s = setup({ [FEED_URL]: () => xml(rss(DELIVERED)) }, gate.handler);
    s.article();
    const worker = new SummaryWorker(s.deps);
    const poller = new FeedPoller(s.deps);

    worker.tick();
    await gate.settle();
    expect(gate.waiting).toHaveLength(1);

    expect(await poller.fetchNow(s.feed.id)).toMatchObject({ status: "updated", created: 1 });
    expect(gate.waiting).toHaveLength(1);
    expect(s.calls()).toEqual([]);

    await gate.release();
    await gate.release();
    await worker.idle();
  });

  it("summarises an article a feed delivers after the feed began to summarise, and keeps the summary when the item is rewritten", async () => {
    let content = DELIVERED;
    const s = setup({ [FEED_URL]: () => xml(rss(content)) });
    const worker = new SummaryWorker(s.deps);
    const poller = new FeedPoller(s.deps);

    await poller.fetchNow(s.feed.id);
    const id = Number(s.db.prepare("SELECT id FROM articles").get()!.id);
    expect(getArticle(s.db, id)).toMatchObject({ autoSummary: null, autoSummaryPending: true });

    worker.tick();
    await worker.idle();
    expect(getArticle(s.db, id).autoSummary).toMatchObject({ text: "A summary.", source: "feed" });

    content = prose("corrected", 300);
    s.clock.advance(60 * MINUTE);
    await poller.fetchNow(s.feed.id);
    worker.tick();
    await worker.idle();
    const rewritten = getArticle(s.db, id);
    expect(rewritten.body).toContain("corrected");
    expect(rewritten.autoSummary?.text).toBe("A summary.");
    expect(s.prompts()).toHaveLength(1);
  });

  it("summarises none of the articles a feed held before it began to summarise, nor those that wait when it stops", async () => {
    const s = setup({});
    const quiet = insertFeed(s.db, { url: "https://feeds.example.org/quiet.xml", title: "Quiet" }, s.clock);
    for (let index = 0; index < 10; index += 1) seedFeedArticle(s.db, quiet.id, { at: s.clock().toISOString() });
    s.clock.advance(MINUTE);
    updateFeed(s.db, quiet.id, { autoSummarize: true }, s.clock);
    const worker = new SummaryWorker(s.deps);

    worker.tick();
    await worker.idle();
    expect(s.prompts()).toEqual([]);

    for (let index = 0; index < 3; index += 1) s.article();
    updateFeed(s.db, s.feed.id, { autoSummarize: false }, s.clock);
    worker.tick();
    await worker.idle();
    expect(s.prompts()).toEqual([]);
  });
});
