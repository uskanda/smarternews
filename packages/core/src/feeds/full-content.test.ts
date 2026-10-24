import { describe, expect, it } from "vitest";
import { getArticle, setArticleFlags } from "../db/articles.ts";
import { insertFeed, updateFeed } from "../db/feeds.ts";
import { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { createTestDb, fakeClock, seedFeedArticle } from "../testing/db.ts";
import { fakeFetch, html } from "../testing/http.ts";
import { fakeLlm } from "../testing/llm.ts";
import { fetchFullContent, FullContentWorker } from "./full-content.ts";

const START = "2026-03-01T12:00:00.000Z";
const MINUTE = 60_000;

/** Text of a given length that reads like prose, so that Readability keeps it. */
const prose = (word: string, chars: number) => `${word} `.repeat(Math.ceil(chars / (word.length + 1))).trim();
const page = (inner: string) =>
  html(`<html><head><title>Page</title></head><body><nav><a href="/">Home</a> <a href="/about">About us</a></nav><article><h1>Page</h1>${inner}</article></body></html>`);
const FULL = prose("fulltext", 600);
const fullPage = () => page(`<p>${FULL}</p><p>${FULL}</p>`);
const EXCERPT = prose("excerpt", 120);

function setup(routes: Parameters<typeof fakeFetch>[0], options: { hostIntervalMs?: number; timeoutMs?: number } = {}) {
  const db = createTestDb();
  const clock = fakeClock(START);
  const fake = fakeFetch(routes, clock);
  const fetcher = new Fetcher({
    userAgent: "t",
    hostIntervalMs: options.hostIntervalMs ?? 0,
    timeoutMs: options.timeoutMs ?? 1000,
    maxBytes: 1_000_000,
    fetchImpl: fake.fetchImpl,
    clock,
    sleep: async (ms) => clock.advance(ms),
  });
  const llm = fakeLlm(db, clock, {});
  const feed = insertFeed(db, { url: "https://feeds.example.org/feed.xml", title: "Feed", fetchFullContent: true }, clock);
  clock.advance(MINUTE);
  let serial = 0;
  /** A feed article stored now, after the feed began to fetch full content. */
  const article = (options: { body?: string; url?: string | null; host?: string } = {}) => {
    serial += 1;
    clock.advance(MINUTE);
    const url = options.url === undefined ? `https://${options.host ?? "site.example.org"}/${serial}` : options.url;
    return seedFeedArticle(db, feed.id, { at: clock().toISOString(), body: options.body ?? EXCERPT, url });
  };
  const pages = new PageFetcher(fetcher, { pagesPerRun: Number.POSITIVE_INFINITY, remember: false });
  const deps = { db, clock, fetcher };
  const llmCalls = () => Number(db.prepare("SELECT count(*) AS n FROM llm_calls").get()!.n);
  const pageRequests = () => fake.urls().filter((url) => !url.endsWith("/robots.txt"));
  return { db, clock, deps, feed, article, pages, fake, llm, llmCalls, pageRequests };
}

describe("fetchFullContent", () => {
  it("stores the text of the page as Markdown, apart from what the feed delivered", async () => {
    const s = setup({ "https://site.example.org/1": fullPage });
    const id = s.article();

    const result = await fetchFullContent(s.deps, s.pages, id);

    expect(result).toMatchObject({ status: "fetched", fullContent: { fetchedAt: s.clock().toISOString() } });
    const article = getArticle(s.db, id);
    expect(article.body).toBe(EXCERPT);
    expect(article.fullContentStatus).toBe("fetched");
    expect(article.fullContent?.body).toContain("fulltext fulltext");
    expect(article.fullContent?.body).not.toContain("About us");
    expect(article.fullContent?.bodyHtml).toContain("<p>fulltext");
    expect(result.status === "fetched" && result.fullContent.body).toBe(article.fullContent?.body);
  });

  it("records an article without a page", async () => {
    const s = setup({});
    const id = s.article({ url: null });
    expect(await fetchFullContent(s.deps, s.pages, id)).toEqual({ status: "failed", error: { reason: "no-url", detail: null } });
    expect(s.fake.urls()).toEqual([]);
    expect(getArticle(s.db, id)).toMatchObject({ fullContentStatus: "failed", fullContentError: { reason: "no-url", detail: null }, body: EXCERPT });
  });

  it("does not fetch a page that robots.txt forbids, and records why", async () => {
    const s = setup({
      "https://site.example.org/robots.txt": () => new Response("User-agent: *\nDisallow: /", { status: 200 }),
      "https://site.example.org/1": fullPage,
    });
    const id = s.article();
    expect(await fetchFullContent(s.deps, s.pages, id)).toEqual({ status: "failed", error: { reason: "robots", detail: null } });
    expect(s.pageRequests()).toEqual([]);
  });

  it("records the HTTP status of a page that is not there, and keeps the delivered content", async () => {
    const s = setup({});
    const id = s.article();
    expect(await fetchFullContent(s.deps, s.pages, id)).toEqual({ status: "failed", error: { reason: "http", detail: "404" } });
    expect(getArticle(s.db, id)).toMatchObject({ body: EXCERPT, fullContent: null, fullContentError: { reason: "http", detail: "404" } });
  });

  it("records a page that is not HTML", async () => {
    const s = setup({ "https://site.example.org/1": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }) });
    const id = s.article();
    expect(await fetchFullContent(s.deps, s.pages, id)).toEqual({ status: "failed", error: { reason: "not-html", detail: "application/pdf" } });
  });

  it("records a page that does not answer in time", async () => {
    const s = setup({ "https://site.example.org/1": () => "hang" }, { timeoutMs: 20 });
    const id = s.article();
    expect(await fetchFullContent(s.deps, s.pages, id)).toMatchObject({ status: "failed", error: { reason: "timeout" } });
  });

  it("records a refused destination", async () => {
    const s = setup({});
    const id = s.article({ url: "http://127.0.0.1/1" });
    expect(await fetchFullContent(s.deps, s.pages, id)).toMatchObject({ status: "failed", error: { reason: "blocked" } });
    expect(s.fake.urls()).toEqual([]);
  });

  it("records a page from which no text can be taken", async () => {
    const s = setup({ "https://site.example.org/1": () => html("<html><body><script>app()</script></body></html>") });
    const id = s.article();
    expect(await fetchFullContent(s.deps, s.pages, id)).toEqual({ status: "failed", error: { reason: "no-content", detail: null } });
  });

  it("does not store text shorter than what the feed delivered, such as a notice to subscribe", async () => {
    const s = setup({ "https://site.example.org/1": () => page(`<p>${prose("subscribe", 300)}</p>`) });
    const id = s.article({ body: prose("delivered", 800) });
    expect(await fetchFullContent(s.deps, s.pages, id)).toMatchObject({ status: "failed", error: { reason: "shorter" } });
    expect(getArticle(s.db, id)).toMatchObject({ fullContent: null, fullContentStatus: "failed" });
  });

  it("stores any text for an article whose feed delivered no content", async () => {
    const s = setup({ "https://site.example.org/1": () => page(`<p>${prose("short", 150)}</p>`) });
    const id = s.article({ body: "" });
    expect(await fetchFullContent(s.deps, s.pages, id)).toMatchObject({ status: "fetched" });
    expect(getArticle(s.db, id).fullContent?.body).toContain("short short");
  });

  it("rewrites the page by the rules of delivered content: no scripts, no images over plain HTTP", async () => {
    const s = setup({
      "https://site.example.org/1": () =>
        page(
          `<p>${FULL}</p><script>steal()</script><p><img src="http://img.example.org/plain.png" alt="plain"></p>` +
            `<p><img src="https://img.example.org/safe.png" alt="safe" width="600" height="400"></p><p>${FULL}</p>`,
        ),
    });
    const id = s.article();
    await fetchFullContent(s.deps, s.pages, id);
    const body = getArticle(s.db, id).fullContent!.body;
    expect(body).not.toContain("steal");
    expect(body).not.toContain("http://img.example.org/plain.png");
    expect(body).toContain("![safe](https://img.example.org/safe.png)");
    expect(body.split("\n\n").filter((block) => block.startsWith("fulltext"))).toHaveLength(2);
  });

  it("returns what is stored without fetching the page again", async () => {
    const s = setup({ "https://site.example.org/1": fullPage });
    const id = s.article();
    await fetchFullContent(s.deps, s.pages, id);
    const requests = s.fake.urls().length;
    expect(await fetchFullContent(s.deps, s.pages, id)).toMatchObject({ status: "fetched" });
    expect(s.fake.urls()).toHaveLength(requests);
  });

  it("fetches the page again for an article whose fetch failed", async () => {
    let up = false;
    const s = setup({ "https://site.example.org/1": () => (up ? fullPage() : new Response("down", { status: 503 })) });
    const id = s.article();
    expect(await fetchFullContent(s.deps, s.pages, id)).toMatchObject({ status: "failed", error: { reason: "http", detail: "503" } });
    up = true;
    expect(await fetchFullContent(s.deps, s.pages, id)).toMatchObject({ status: "fetched" });
    expect(getArticle(s.db, id)).toMatchObject({ fullContentStatus: "fetched", fullContentError: null });
  });
});

describe("FullContentWorker", () => {
  /** Pages whose answers the test releases one by one. */
  function gatedPages() {
    const waiting: Array<{ url: string; release: () => void }> = [];
    const route = (request: { url: string }) =>
      request.url.endsWith("/robots.txt")
        ? new Response("none", { status: 404 })
        : new Promise<Response>((resolve) => waiting.push({ url: request.url, release: () => resolve(fullPage()) }));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
    const release = async () => {
      waiting.shift()!.release();
      await settle();
    };
    return { route, waiting, release, settle };
  }

  it("fetches everything that waits, the newest first, one at a time", async () => {
    const gate = gatedPages();
    const s = setup({ "https://site.example.org/": gate.route });
    const ids = [s.article(), s.article(), s.article()];
    const worker = new FullContentWorker(s.deps);

    worker.tick();
    await gate.settle();
    expect(gate.waiting.map((entry) => entry.url)).toEqual([`https://site.example.org/3`]);
    await gate.release();
    expect(gate.waiting.map((entry) => entry.url)).toEqual([`https://site.example.org/2`]);
    await gate.release();
    await gate.release();
    await worker.idle();

    expect(s.pageRequests()).toEqual(["https://site.example.org/3", "https://site.example.org/2", "https://site.example.org/1"]);
    expect(ids.every((id) => getArticle(s.db, id).fullContentStatus === "fetched")).toBe(true);
  });

  it("fetches an article it is asked for right after the one under way, before the others that wait", async () => {
    const gate = gatedPages();
    const s = setup({ "https://site.example.org/": gate.route, "https://other.example.org/": gate.route });
    s.article();
    s.article();
    s.article();
    const quiet = insertFeed(s.db, { url: "https://feeds.example.org/quiet.xml", title: "Quiet" }, s.clock);
    const asked = seedFeedArticle(s.db, quiet.id, { at: s.clock().toISOString(), url: "https://other.example.org/asked" });
    const worker = new FullContentWorker(s.deps);

    worker.tick();
    await gate.settle();
    const answer = worker.fetchFor(asked);
    await gate.settle();
    // Never two at once: the article under way finishes first.
    expect(gate.waiting).toHaveLength(1);
    await gate.release();
    expect(gate.waiting.map((entry) => entry.url)).toEqual(["https://other.example.org/asked"]);
    await gate.release();
    await expect(answer).resolves.toMatchObject({ status: "fetched" });
    await gate.release();
    await gate.release();
    await worker.idle();

    expect(s.pageRequests()).toEqual([
      "https://site.example.org/3",
      "https://other.example.org/asked",
      "https://site.example.org/2",
      "https://site.example.org/1",
    ]);
  });

  it("fetches once for two requests of the same article", async () => {
    const gate = gatedPages();
    const s = setup({ "https://site.example.org/": gate.route });
    updateFeed(s.db, s.feed.id, { fetchFullContent: false }, s.clock);
    const id = s.article();
    const worker = new FullContentWorker(s.deps);

    const first = worker.fetchFor(id);
    const second = worker.fetchFor(id);
    await gate.settle();
    await gate.release();

    expect(await first).toEqual(await second);
    expect(s.pageRequests()).toEqual(["https://site.example.org/1"]);
  });

  it("refuses a request for a generated article or one that does not exist", async () => {
    const s = setup({});
    const worker = new FullContentWorker(s.deps);
    await expect(worker.fetchFor(9999)).rejects.toMatchObject({ code: "not_found" });
  });

  it("answers a request for an article with full content without waiting for the article under way", async () => {
    const gate = gatedPages();
    const s = setup({ "https://site.example.org/": gate.route });
    const done = s.article();
    s.article();
    const worker = new FullContentWorker(s.deps);
    const first = worker.fetchFor(done);
    await gate.settle();
    await gate.release();
    await first;

    worker.tick();
    await gate.settle();
    expect(gate.waiting).toHaveLength(1);
    await expect(worker.fetchFor(done)).resolves.toMatchObject({ status: "fetched" });
    await gate.release();
    await worker.idle();
  });

  it("does not fetch again by itself an article that failed for a passing reason, a day later either", async () => {
    let calls = 0;
    const s = setup({
      "https://site.example.org/1": () => {
        calls += 1;
        return new Response("busy", { status: 503 });
      },
      "https://site.example.org/2": () => "hang",
    }, { timeoutMs: 20 });
    const busy = s.article();
    const slow = s.article();
    const worker = new FullContentWorker(s.deps);

    worker.tick();
    await worker.idle();
    expect(getArticle(s.db, busy)).toMatchObject({ fullContentStatus: "failed", fullContentError: { reason: "http", detail: "503" } });
    expect(getArticle(s.db, slow)).toMatchObject({ fullContentStatus: "failed", fullContentError: { reason: "timeout" } });
    const requests = s.pageRequests().length;

    s.clock.advance(24 * 60 * MINUTE);
    worker.tick();
    await worker.idle();
    expect(s.pageRequests()).toHaveLength(requests);
    expect(calls).toBe(1);

    await expect(worker.fetchFor(busy)).resolves.toMatchObject({ status: "failed" });
    expect(calls).toBe(2);
  });

  it("goes on with the others when one fails, and calls no model", async () => {
    const s = setup({
      "https://site.example.org/1": fullPage,
      "https://site.example.org/2": () => new Response("error", { status: 500 }),
      "https://site.example.org/3": fullPage,
    });
    const ids = [s.article(), s.article(), s.article()];
    const worker = new FullContentWorker(s.deps);

    worker.tick();
    await worker.idle();

    expect(ids.map((id) => getArticle(s.db, id).fullContentStatus)).toEqual(["fetched", "failed", "fetched"]);
    expect(s.llmCalls()).toBe(0);
    expect(Object.values(s.llm.requests).flat()).toEqual([]);
  });

  it("does not stop at a count for the day", async () => {
    const s = setup({ "https://": fullPage });
    const ids = Array.from({ length: 300 }, (_, index) => s.article({ host: `site${index}.example.org` }));
    const worker = new FullContentWorker(s.deps);

    worker.tick();
    await worker.idle();

    expect(ids.every((id) => getArticle(s.db, id).fullContentStatus === "fetched")).toBe(true);
    expect(s.llmCalls()).toBe(0);
  });

  it("keeps the interval between requests to the same host", async () => {
    const s = setup({ "https://site.example.org/": fullPage }, { hostIntervalMs: 2000 });
    s.article();
    s.article();
    s.article();
    const worker = new FullContentWorker(s.deps);

    worker.tick();
    await worker.idle();

    const times = s.fake.requests.filter((request) => !request.url.endsWith("/robots.txt")).map((request) => request.at);
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(2000);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(2000);
  });

  it("does not fetch an article read while it waited, nor those of a feed that stopped", async () => {
    const s = setup({ "https://site.example.org/": fullPage });
    const read = s.article();
    setArticleFlags(s.db, read, { isRead: true }, s.clock().toISOString());
    s.article();
    s.clock.advance(MINUTE);
    updateFeed(s.db, s.feed.id, { fetchFullContent: false }, s.clock);
    const worker = new FullContentWorker(s.deps);

    worker.tick();
    await worker.idle();
    expect(s.pageRequests()).toEqual([]);
  });

  it("begins no other article once it is stopped", async () => {
    const gate = gatedPages();
    const s = setup({ "https://site.example.org/": gate.route });
    const older = s.article();
    const newer = s.article();
    const worker = new FullContentWorker(s.deps);

    worker.start(60_000);
    expect(worker.running).toBe(true);
    await gate.settle();
    worker.stop();
    expect(worker.running).toBe(false);
    await gate.release();
    await worker.idle();

    expect(getArticle(s.db, newer).fullContentStatus).toBe("fetched");
    expect(getArticle(s.db, older).fullContentStatus).toBe("waiting");
  });
});
