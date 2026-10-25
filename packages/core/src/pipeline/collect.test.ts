import { describe, expect, it } from "vitest";
import { parseConfig } from "../config.ts";
import { getTopic, updateTopic } from "../db/topics.ts";
import { materialLines } from "../testing/llm.ts";
import { pipelineHarness } from "../testing/pipeline.ts";

const FEED = "https://example.org/feed.xml";

describe("interpretation before a run", () => {
  it("interprets a new topic first and searches with the queries it produced", async () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust releases", { interpreted: false });
    h.handlers.interpret = () => ({
      queries: ["rust stable release"],
      criteria: "official releases only",
      suggestedSources: { newsSearch: true, llmSearch: false },
    });
    h.news({ "rust stable release": [{ title: "Rust 2.0 is out", link: "https://example.org/rust-2" }] });

    await h.run();

    expect(getTopic(h.db, topic.id)).toMatchObject({ interpreted: true, sources: { newsSearch: true, llmSearch: false } });
    expect(h.articles().map((article) => article.title)).toEqual(["Rust 2.0 is out"]);
    expect(h.requests.judge[0]!.prompt).toContain("official releases only");
  });

  it("skips a topic whose interpretation fails and still processes the others", async () => {
    const h = pipelineHarness();
    const broken = h.addTopic("Broken topic", { interpreted: false });
    h.addTopic("Working topic", { feeds: [FEED] });
    h.handlers.interpret = () => {
      throw new Error("model unavailable");
    };
    h.feed(FEED, [{ title: "A story", link: "https://example.org/a" }]);

    const run = await h.run();

    expect(h.articles()).toHaveLength(1);
    expect(getTopic(h.db, broken.id).interpreted).toBe(false);
    expect(run.status).toBe("partial");
    expect(run.failures).toEqual([expect.objectContaining({ stage: "interpret", target: "Broken topic" })]);
  });
});

describe("collecting candidates", () => {
  it("uses only the sources of enabled topics", async () => {
    const h = pipelineHarness();
    h.addTopic("Enabled", { feeds: ["https://example.org/on.xml"] });
    h.addTopic("Disabled", { feeds: ["https://example.org/off.xml"], enabled: false });
    h.feed("https://example.org/on.xml", [{ title: "On", link: "https://example.org/on" }]);
    h.feed("https://example.org/off.xml", [{ title: "Off", link: "https://example.org/off" }]);

    await h.run();

    expect(h.urls()).toContain("https://example.org/on.xml");
    expect(h.urls()).not.toContain("https://example.org/off.xml");
  });

  it("searches with queries the user edited", async () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["generated query"] });
    updateTopic(h.db, topic.id, { queries: ["edited query"] });
    h.news({});

    await h.run();

    const queries = h.urls().filter((url) => url.includes("/news/search")).map((url) => new URL(url).searchParams.get("q"));
    expect(queries).toEqual(["edited query"]);
  });

  it("makes one candidate of a page that two queries of a topic both find", async () => {
    const h = pipelineHarness();
    h.addTopic("Rust", { newsSearch: true, queries: ["rust release", "rust compiler"] });
    const story = { title: "Rust 2.0 [skip]", link: "https://example.org/rust-2" };
    h.news({ "rust release": [story], "rust compiler": [story, { title: "Compiler notes [skip]", link: "https://example.org/notes" }] });

    const run = await h.run();

    expect(h.candidates(run.id).map((candidate) => candidate.url).sort()).toEqual(["https://example.org/notes", "https://example.org/rust-2"]);
  });

  it("searches a topic's own language and region and leaves the other topics on the defaults", async () => {
    const h = pipelineHarness({ search: { language: "ja", region: "JP" } });
    h.addTopic("Local", { newsSearch: true, queries: ["local"] });
    h.addTopic("Abroad", { newsSearch: true, queries: ["abroad"], search: { language: "en", region: "US" } });
    h.news({});

    await h.run();

    const markets = Object.fromEntries(
      h.urls().filter((url) => url.includes("/news/search")).map((url) => {
        const params = new URL(url).searchParams;
        return [params.get("q"), `${params.get("setlang")}-${params.get("cc")}`];
      }),
    );
    expect(markets).toEqual({ local: "ja-JP", abroad: "en-US" });
  });

  it("makes one candidate of a page found for two topics and records both", async () => {
    const h = pipelineHarness();
    const first = h.addTopic("First", { feeds: ["https://example.org/one.xml"] });
    const second = h.addTopic("Second", { feeds: ["https://example.org/two.xml"] });
    h.feed("https://example.org/one.xml", [{ title: "Shared [skip]", link: "https://example.org/shared?utm_source=one" }]);
    h.feed("https://example.org/two.xml", [{ title: "Shared [skip]", link: "https://example.org/shared?utm_source=two" }]);

    const run = await h.run();

    const candidates = h.candidates(run.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.url).toBe("https://example.org/shared");
    expect(candidates[0]!.topics.map((topic) => topic.id).sort()).toEqual([first.id, second.id].sort());
    expect(run.collected).toBe(1);
  });

  it("does not judge a page again in a later run and then calls no model at all", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Story [skip]", link: "https://example.org/a" }]);
    await h.run();
    const callsAfterFirst = h.requests.judge.length;

    const second = await h.run();

    expect(h.requests.judge).toHaveLength(callsAfterFirst);
    expect(second).toMatchObject({ collected: 0, llmCalls: 0, status: "succeeded" });
  });

  it("keeps going when one feed fails and records which one", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: ["https://example.org/a.xml", "https://example.org/down.xml", "https://example.org/b.xml"] });
    h.feed("https://example.org/a.xml", [{ title: "A", link: "https://example.org/a" }]);
    h.feed("https://example.org/b.xml", [{ title: "B", link: "https://example.org/b" }]);
    h.routes["https://example.org/down.xml"] = () => new Response("oops", { status: 500 });

    const run = await h.run();

    expect(h.articles().map((article) => article.title).sort()).toEqual(["A", "B"]);
    expect(run.status).toBe("partial");
    expect(run.failures).toEqual([
      { stage: "feed", target: "https://example.org/down.xml", message: expect.stringContaining("500") },
    ]);
  });

  it("does not ask a feed on the own network, keeps going, and records why", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: ["http://192.168.0.1/feed.xml", FEED] });
    h.feed(FEED, [{ title: "A", link: "https://example.org/a" }]);

    const run = await h.run();

    expect(h.urls().some((url) => url.includes("192.168.0.1"))).toBe(false);
    expect(h.articles().map((article) => article.title)).toEqual(["A"]);
    expect(run.status).toBe("partial");
    expect(run.failures).toEqual([
      { stage: "feed", target: "http://192.168.0.1/feed.xml", message: expect.stringContaining("destination not allowed") },
    ]);
  });

  it("marks the run as failed when every source fails", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: ["https://example.org/down.xml"] });

    const run = await h.run();

    expect(run.status).toBe("failed");
    expect(run.collected).toBe(0);
  });

  it("skips web search by the model when the provider cannot search, and says so", async () => {
    const h = pipelineHarness({ webSearch: false });
    h.addTopic("Topic", { feeds: [FEED], llmSearch: true });
    h.feed(FEED, [{ title: "From the feed", link: "https://example.org/a" }]);

    const run = await h.run();

    expect(h.requests.search).toHaveLength(0);
    expect(h.articles().map((article) => article.title)).toEqual(["From the feed"]);
    expect(run.failures).toEqual([expect.objectContaining({ stage: "llm-search", message: expect.stringContaining("cannot search") })]);
  });

  it("collects pages proposed by the model's web search", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { llmSearch: true });
    h.handlers.search = () => ({ results: [{ url: "https://example.org/found", title: "Found by search", snippet: "s" }] });
    h.page("https://example.org/found", "The page text.", "2026-03-01T10:00:00Z");

    await h.run();

    expect(h.articles()).toMatchObject([{ title: "Found by search", refs: [{ url: "https://example.org/found" }] }]);
  });
});

describe("judging", () => {
  it("rejects a news item without a publication time before any model sees it", async () => {
    const h = pipelineHarness({ outputLanguage: "ja" });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "Dated", link: "https://example.org/dated" },
      { title: "Undated", link: "https://example.org/undated", published: null },
    ]);

    const run = await h.run();

    expect(h.candidates(run.id, "rejected")).toMatchObject([{ title: "Undated", reason: "公開日時が不明" }]);
    expect(materialLines(h.requests.judge[0]!.prompt).map((candidate) => candidate.title)).toEqual(["Dated"]);
  });

  it("judges 45 new candidates in two calls of at most 30", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, Array.from({ length: 45 }, (_unused, index) => ({ title: `Item ${index} [skip]`, link: `https://example.org/${index}` })));

    const run = await h.run();

    expect(h.requests.judge.map((request) => materialLines(request.prompt).length)).toEqual([30, 15]);
    expect(h.candidates(run.id, "rejected")).toHaveLength(45);
    expect(run).toMatchObject({ collected: 45, rejected: 45 });
  });

  it("gives the judge the title, snippet, site, time, topic criteria and reader information", async () => {
    const h = pipelineHarness({ readerInfo: "Runs the product in production." });
    h.addTopic("Topic", { feeds: [FEED], criteria: "confirmed incidents only" });
    h.feed(FEED, [{ title: "Incident", link: "https://example.org/i", published: "2026-03-01T10:00:00Z", description: "What happened." }], "Example Site");

    await h.run();

    const prompt = h.requests.judge[0]!.prompt;
    expect(prompt).toContain("Runs the product in production.");
    expect(prompt).toContain("confirmed incidents only");
    expect(materialLines(prompt)[0]).toMatchObject({
      title: "Incident",
      snippet: "What happened.",
      siteName: "Example Site",
      publishedAt: "2026-03-01T10:00:00.000Z",
    });
  });

  it("stores a rejected candidate with the judge's reason", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Buy now [skip]", link: "https://example.org/ad" }]);

    const run = await h.run();

    expect(h.candidates(run.id, "rejected")).toMatchObject([
      { title: "Buy now [skip]", url: "https://example.org/ad", reason: "advertising without new information", status: "rejected" },
    ]);
    expect(h.articles()).toEqual([]);
  });

  it("drops candidates whose judgement fails so that a later run sees them again", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Story", link: "https://example.org/a" }]);
    const judge = h.handlers.judge!;
    h.handlers.judge = () => {
      throw new Error("model unavailable");
    };
    const first = await h.run();
    expect(first.status).toBe("partial");
    expect(h.articles()).toEqual([]);

    h.handlers.judge = judge;
    await h.run();

    expect(h.articles().map((article) => article.title)).toEqual(["Story"]);
  });
});

describe("run history", () => {
  it("records what the run did and when", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "{a} one", link: "https://example.org/1" },
      { title: "{a} two", link: "https://example.org/2" },
      { title: "Other", link: "https://example.org/3" },
      { title: "Ad [skip]", link: "https://example.org/4" },
      { title: "Undated", link: "https://example.org/5", published: null },
    ]);

    const run = await h.run();

    expect(run).toMatchObject({
      categoryId: h.category.id,
      trigger: "manual",
      status: "succeeded",
      startedAt: "2026-03-01T12:00:00.000Z",
      finishedAt: "2026-03-01T12:00:00.000Z",
      collected: 5,
      rejected: 2,
      articlesCreated: 2,
      articlesUpdated: 0,
      llmCalls: 4, // judge, cluster, two writes
      failures: [],
    });
  });

  it("lets the calls of a run be read back per task", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "One", link: "https://example.org/1" },
      { title: "Two", link: "https://example.org/2" },
    ]);

    const run = await h.run();

    const perTask = h.db
      .prepare("SELECT task, count(*) AS calls, min(ok) AS ok FROM llm_calls WHERE run_id = ? GROUP BY task ORDER BY task")
      .all(run.id);
    expect(perTask).toEqual([
      { task: "cluster", calls: 1, ok: 1 },
      { task: "judge", calls: 1, ok: 1 },
      { task: "write", calls: 2, ok: 1 },
    ]);
  });
});

describe("news search with several engines", () => {
  const BOTH = { engines: ["google-news" as const, "bing-news" as const] };
  const searchHosts = (urls: string[]) => urls.filter((url) => url.includes("/news/search") || url.includes("/rss/search")).map((url) => new URL(url).host);

  it("asks every engine with each query and takes the results of both", async () => {
    const h = pipelineHarness({ newsSearch: BOTH });
    h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    h.googleNews({ rust: [{ title: "From Google [skip]", link: "https://example.org/google" }] });
    h.news({ rust: [{ title: "From Bing [skip]", link: "https://example.org/bing" }] });

    const run = await h.run();

    expect(searchHosts(h.urls())).toEqual(["news.google.com", "www.bing.com"]);
    expect(h.candidates(run.id).map((candidate) => candidate.url).sort()).toEqual(["https://example.org/bing", "https://example.org/google"]);
  });

  it("makes one candidate of a page that both engines find", async () => {
    const h = pipelineHarness({ newsSearch: BOTH });
    h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    h.googleNews({ rust: [{ title: "Rust 2.0 [skip]", link: "https://example.org/rust-2?utm_source=gn" }] });
    h.news({ rust: [{ title: "Rust 2.0 [skip]", link: "https://example.org/rust-2" }] });

    const run = await h.run();

    expect(h.candidates(run.id).map((candidate) => candidate.url)).toEqual(["https://example.org/rust-2"]);
  });

  it("takes the newest results up to the limit from each engine", async () => {
    const h = pipelineHarness({ newsSearch: { ...BOTH, maxResultsPerQuery: 2 } });
    h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    const results = (engine: string) =>
      [1, 2, 3].map((hour) => ({ title: `${engine} ${hour} [skip]`, link: `https://example.org/${engine}-${hour}`, published: `2026-03-01T0${hour}:00:00Z` }));
    h.googleNews({ rust: results("google") });
    h.news({ rust: results("bing") });

    const run = await h.run();

    expect(h.candidates(run.id).map((candidate) => candidate.url).sort()).toEqual([
      "https://example.org/bing-2",
      "https://example.org/bing-3",
      "https://example.org/google-2",
      "https://example.org/google-3",
    ]);
  });

  it("asks Google News alone when the configuration names no engine", async () => {
    const h = pipelineHarness({ newsSearch: parseConfig(null).newsSearch });
    h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    h.googleNews({});
    h.news({});

    await h.run();

    expect(searchHosts(h.urls())).toEqual(["news.google.com"]);
  });

  it("asks the one engine that the older setting names", async () => {
    const h = pipelineHarness({ newsSearch: parseConfig("newsSearch:\n  engine: bing-news\n").newsSearch });
    h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    h.googleNews({});
    h.news({});

    await h.run();

    expect(searchHosts(h.urls())).toEqual(["www.bing.com"]);
  });

  it("takes the results of the other engine when one does not answer in time", async () => {
    const h = pipelineHarness({ newsSearch: BOTH });
    h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    h.routes["https://news.google.com/rss/search"] = () => "hang";
    h.news({ rust: [{ title: "From Bing", link: "https://example.org/bing" }] });

    const run = await h.run();

    expect(h.articles().map((article) => article.title)).toEqual(["From Bing"]);
    expect(run.status).toBe("partial");
  });

  it("records which engine failed with the query, and counts each engine as a source of its own", async () => {
    const h = pipelineHarness({ newsSearch: BOTH });
    h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    h.googleNews({});
    h.routes["https://www.bing.com/news/search"] = () => new Response("oops", { status: 500 });

    const run = await h.run();

    expect(run.failures).toEqual([{ stage: "news-search", target: "bing-news: rust", message: expect.stringContaining("500") }]);
    expect(run.status).not.toBe("failed");
  });
});
