import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFeeds } from "../db/feeds.ts";
import { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import type { FakeHandler } from "../testing/llm.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { fakeFetch, html } from "../testing/http.ts";
import { fakeLlm } from "../testing/llm.ts";
import { MODEL_HTML_CHARS, pageForModel, previewSelectors, proposeSelectors } from "./propose.ts";

describe("pageForModel", () => {
  it("takes out scripts, styles and embeds, with style and event attributes and comments", () => {
    const html = `<!doctype html><html><head><title>T</title><style>.x{}</style><link rel="stylesheet" href="a.css"><link rel="canonical" href="https://example.org/"><script>var a = "<li>";</script></head>
<body><!-- a comment --><noscript><p>Enable scripts</p></noscript><template><li>t</li></template>
<ul id="news" class="posts"><li class="post" style="color:red" onclick="go()" onmouseover="x()"><a href="/1" class="title">One</a></li></ul>
<iframe src="https://ads.example/"></iframe><embed src="a.swf"><object data="b"></object></body></html>`;
    const cleaned = pageForModel(html);
    for (const gone of ["<script", "<style", "stylesheet", "<noscript", "<template", "<iframe", "<embed", "<object", "style=", "onclick", "onmouseover", "a comment"]) {
      expect(cleaned).not.toContain(gone);
    }
    expect(cleaned).toContain('<ul id="news" class="posts">');
    expect(cleaned).toContain('<li class="post"><a href="/1" class="title">One</a></li>');
    expect(cleaned).toContain('rel="canonical"');
  });

  it("keeps the first 50,000 characters of a longer page", () => {
    const row = '<li class="post"><a href="/x">An article with a title</a></li>';
    const html = `<html><body><ul>${row.repeat(Math.ceil(120_000 / row.length))}</ul></body></html>`;
    const whole = pageForModel(html, Number.POSITIVE_INFINITY);
    expect(whole.length).toBeGreaterThanOrEqual(120_000);
    expect(MODEL_HTML_CHARS).toBe(50_000);
    expect(pageForModel(html)).toBe(whole.slice(0, 50_000));
  });
});

describe("proposeSelectors and previewSelectors", () => {
  const PAGE = "https://gazette.example.org/latest";
  const recorded = readFileSync(join(import.meta.dirname, "../testing/pages/news-list.html"), "utf8");
  const LIST = { item: "div.article-list > article.entry", title: "h2.entry-title", link: "h2 a", date: "time" };
  const INFERRED = { item: "#content > div.article-list > article.entry", date: "time" };

  function setup(options: { handler?: FakeHandler; selectorProposalsPerDay?: number; llmCallsPerDay?: number; body?: string; timeoutMs?: number } = {}) {
    const db = createTestDb();
    const clock = fakeClock("2026-10-25T03:00:00.000Z");
    const site = fakeFetch({ [PAGE]: () => html(options.body ?? recorded), "https://gone.example.org/": () => new Response("gone", { status: 404 }) }, clock);
    const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: site.fetchImpl, clock, sleep: async () => {} });
    const llm = fakeLlm(db, clock, options.handler ? { proposeSelectors: options.handler } : {}, {
      limits: { llmCallsPerRun: 40, llmCallsPerDay: options.llmCallsPerDay ?? 350, selectorProposalsPerDay: options.selectorProposalsPerDay ?? 50 },
      timeoutMs: options.timeoutMs,
    });
    const pages = new PageFetcher(fetcher, { pagesPerRun: Number.POSITIVE_INFINITY, remember: false });
    return { db, deps: { db, pages, runner: llm.runner }, asked: () => llm.requests.proposeSelectors, site };
  }

  it("returns the model's candidates with their previews when the proposal takes articles out", async () => {
    const s = setup({ handler: () => ({ candidates: [{ item: LIST.item, title: LIST.title, link: LIST.link, date: LIST.date }, { item: "div.article-list > article", title: null, link: null, date: null }] }) });
    const result = await proposeSelectors(s.deps, PAGE);

    expect(result.usedModel).toBe(true);
    expect(result.fallback).toBeNull();
    expect(result.candidates.map((candidate) => candidate.selectors)).toEqual([LIST, { item: "div.article-list > article" }]);
    expect(result.candidates[0]!.preview).toMatchObject({ count: 6 });
    expect(result.candidates[0]!.preview.items[0]).toEqual({
      title: "Harbor bridge reopens after two years of repairs",
      url: "https://gazette.example.org/2026/10/24/harbor-bridge-reopens",
      publishedAt: "2026-10-24T08:30:00.000Z",
    });
    expect(s.asked()).toHaveLength(1);
    const prompt = s.asked()[0]!.prompt;
    expect(prompt).not.toContain("<script");
    expect(prompt).toContain('class="article-list"');
    expect(listFeeds(s.db)).toEqual([]);
  });

  it("guesses without calling the adapter on a day that reached the limit of proposals", async () => {
    const s = setup({ handler: () => ({ candidates: [LIST] }), selectorProposalsPerDay: 0 });
    const result = await proposeSelectors(s.deps, PAGE);
    expect(s.asked()).toHaveLength(0);
    expect(result).toMatchObject({ usedModel: false, fallback: "limit" });
    expect(result.candidates[0]!.selectors).toEqual(INFERRED);
    expect(result.candidates[0]!.preview.count).toBe(6);
  });

  it("guesses on a day whose calls reached their limit", async () => {
    const s = setup({ handler: () => ({ candidates: [LIST] }), llmCallsPerDay: 1 });
    s.db.prepare("INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, error, created_at) VALUES (NULL, 'judge', 'judge', 1, 1, NULL, ?)").run("2026-10-25T02:00:00.000Z");
    const result = await proposeSelectors(s.deps, PAGE);
    expect(s.asked()).toHaveLength(0);
    expect(result).toMatchObject({ usedModel: false, fallback: "limit" });
  });

  it("guesses when the task runs out of time", async () => {
    const s = setup({ handler: () => new Promise(() => {}), timeoutMs: 50 });
    const result = await proposeSelectors(s.deps, PAGE);
    expect(result).toMatchObject({ usedModel: false, fallback: "failed" });
    expect(result.candidates[0]!.selectors).toEqual(INFERRED);
  });

  it("guesses after two outputs that are not CSS selectors", async () => {
    const s = setup({ handler: () => ({ candidates: [{ item: "div[", title: null, link: null, date: null }] }) });
    const result = await proposeSelectors(s.deps, PAGE);
    expect(s.asked()).toHaveLength(2);
    expect(result).toMatchObject({ usedModel: false, fallback: "failed" });
  });

  it("guesses when none of the proposed selectors takes an article out", async () => {
    const s = setup({ handler: () => ({ candidates: [{ item: "ol.missing > li", title: null, link: null, date: null }] }) });
    const result = await proposeSelectors(s.deps, PAGE);
    expect(result).toMatchObject({ usedModel: false, fallback: "empty" });
    expect(result.candidates[0]!.selectors).toEqual(INFERRED);
  });

  it("answers an empty list, and no error, when nothing can be found", async () => {
    const s = setup({ selectorProposalsPerDay: 0, body: '<html><body><p>Only <a href="/about">one link</a>.</p></body></html>' });
    expect(await proposeSelectors(s.deps, PAGE)).toEqual({ candidates: [], usedModel: false, fallback: "limit" });
  });

  it("refuses a page that cannot be fetched, with the reason", async () => {
    const s = setup({ selectorProposalsPerDay: 0 });
    await expect(proposeSelectors(s.deps, "https://gone.example.org/")).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/HTTP status 404/) });
  });

  it("previews the count and the first ten articles of a set of selectors, without calling the adapter", async () => {
    const rows = Array.from({ length: 15 }, (_unused, n) => `<li class="post"><a href="/p/${n + 1}">Post number ${n + 1}</a></li>`).join("");
    const s = setup({ body: `<html><head><title>T</title></head><body><ul>${rows}</ul></body></html>` });
    const preview = await previewSelectors(s.deps, PAGE, { item: "li.post" });
    expect(preview.count).toBe(15);
    expect(preview.items).toHaveLength(10);
    expect(preview.items[9]).toEqual({ title: "Post number 10", url: "https://gazette.example.org/p/10", publishedAt: null });
    expect(s.asked()).toHaveLength(0);
    expect(s.db.prepare("SELECT count(*) AS n FROM llm_calls").get()).toEqual({ n: 0 });
    expect(listFeeds(s.db)).toEqual([]);
  });

  it("previews nothing for selectors no element matches", async () => {
    const s = setup();
    expect(await previewSelectors(s.deps, PAGE, { item: "table.none tr" })).toEqual({ count: 0, items: [] });
  });
});
