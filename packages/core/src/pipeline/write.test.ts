import { describe, expect, it } from "vitest";
import { resolvePricing } from "../llm/pricing.ts";
import { html } from "../testing/http.ts";
import { defaultHandlers, pipelineHarness, sourcesIn } from "../testing/pipeline.ts";

const FEED = "https://example.org/feed.xml";

describe("fetching pages", () => {
  it("hands the extracted page text to the writer", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Story", link: "https://example.org/story", description: "Short snippet." }]);
    h.page("https://example.org/story", "The vendor confirmed the outage lasted four hours.");

    await h.run();

    expect(sourcesIn(h.requests.write[0]!)[0]!.text).toContain("The vendor confirmed the outage lasted four hours.");
    expect(h.articles()[0]!.snippetOnly).toBe(false);
  });

  it("writes from the snippet, and records that it did, when the page cannot be fetched", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Story", link: "https://example.org/missing", description: "Short snippet." }]);

    await h.run();

    expect(sourcesIn(h.requests.write[0]!)[0]!.text).toBe("Short snippet.");
    expect(h.articles()[0]!.snippetOnly).toBe(true);
  });

  it("requests no page of a candidate judged not relevant", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      ...Array.from({ length: 7 }, (_unused, index) => ({ title: `Ad ${index} [skip]`, link: `https://example.org/ad-${index}` })),
      ...Array.from({ length: 3 }, (_unused, index) => ({ title: `Story ${index}`, link: `https://example.org/story-${index}` })),
    ]);

    await h.run();

    const pages = h.urls().filter((url) => !url.endsWith(".xml") && !url.endsWith("/robots.txt"));
    expect(pages.sort()).toEqual(["https://example.org/story-0", "https://example.org/story-1", "https://example.org/story-2"]);
  });

  it("requests no page that robots.txt forbids and writes from the snippet", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Story", link: "https://example.org/private/story", description: "Short snippet." }]);
    h.routes["https://example.org/robots.txt"] = () => new Response("User-agent: *\nDisallow: /private/", { headers: { "content-type": "text/plain" } });
    h.page("https://example.org/private/story", "Secret text.");

    await h.run();

    expect(h.urls()).not.toContain("https://example.org/private/story");
    expect(sourcesIn(h.requests.write[0]!)[0]!.text).toBe("Short snippet.");
  });

  it("stops fetching pages at the run's limit and writes the rest from snippets", async () => {
    const h = pipelineHarness({ config: { pagesPerRun: 2 } });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "A [i5]", link: "https://example.org/a", description: "Snippet A." },
      { title: "B [i4]", link: "https://example.org/b", description: "Snippet B." },
      { title: "C [i3]", link: "https://example.org/c", description: "Snippet C." },
    ]);
    for (const path of ["a", "b", "c"]) h.page(`https://example.org/${path}`, `Full text of ${path}.`);

    await h.run();

    const texts = h.requests.write.map((request) => sourcesIn(request)[0]!.text);
    expect(texts[0]).toContain("Full text of a.");
    expect(texts[1]).toContain("Full text of b.");
    expect(texts[2]).toBe("Snippet C.");
    expect(h.urls()).not.toContain("https://example.org/c");
  });

  it("does not fetch a search result whose redirect link could not be resolved", async () => {
    const h = pipelineHarness({ engine: "google-news" });
    h.addTopic("Topic", { newsSearch: true, queries: ["q"] });
    h.routes["https://news.google.com/rss/search"] = () =>
      new Response(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title><item><title>Story - Example Daily</title><link>https://news.google.com/rss/articles/ZZZ999?oc=5</link><pubDate>${new Date("2026-03-01T11:00:00Z").toUTCString()}</pubDate><source url="https://daily.example.org">Example Daily</source></item></channel></rss>`,
        { headers: { "content-type": "application/xml" } },
      );
    h.routes["https://news.google.com/rss/articles/ZZZ999"] = () => html("<p>consent wall</p>");

    await h.run();

    expect(h.articles()).toMatchObject([{ title: "Story", snippetOnly: true, refs: [{ url: "https://news.google.com/rss/articles/ZZZ999" }] }]);
    expect(h.urls().filter((url) => url.includes("ZZZ999"))).toHaveLength(1);
  });
});

describe("writing articles", () => {
  it("writes in the configured output language", async () => {
    const h = pipelineHarness({ outputLanguage: "ja" });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "English source", link: "https://example.org/a" }]);

    await h.run();

    expect(h.requests.write[0]!.prompt).toContain("Output language: ja");
  });

  it("marks the article as unconfirmed when the writer says the sources are only rumours", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Leak", link: "https://example.org/leak" }]);
    h.handlers.write = (request) => ({ ...(defaultHandlers.write(request) as object), unconfirmed: true });

    await h.run();

    expect(h.articles()).toMatchObject([{ unconfirmed: true }]);
  });

  it("stores the writer's sentence on what the story means for the reader, apart from the body", async () => {
    const h = pipelineHarness({ readerInfo: "Uses the product at work." });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Flaw", link: "https://example.org/flaw" }]);
    h.handlers.write = (request) => ({ ...(defaultHandlers.write(request) as object), impact: "Update the product this week." });

    await h.run();

    expect(h.articles()).toMatchObject([{ impact: "Update the product this week.", body: "Body paragraph." }]);
  });

  it("leaves the impact empty when the writer has nothing specific to say", async () => {
    const h = pipelineHarness({ readerInfo: "Uses the product at work." });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Flaw", link: "https://example.org/flaw" }]);

    await h.run();

    expect(h.articles()).toMatchObject([{ impact: null }]);
  });

  it("stores no impact when there is no reader information, whatever the writer returns", async () => {
    const h = pipelineHarness({ readerInfo: "" });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Flaw", link: "https://example.org/flaw" }]);
    h.handlers.write = (request) => ({ ...(defaultHandlers.write(request) as object), impact: "Made-up impact." });

    await h.run();

    expect(h.articles()).toMatchObject([{ impact: null }]);
  });
});

describe("failures while writing", () => {
  const threeStories = [
    { title: "First [i5]", link: "https://example.org/1" },
    { title: "Second [i4]", link: "https://example.org/2" },
    { title: "Third [i3]", link: "https://example.org/3" },
  ];

  it("saves the other articles when one cannot be written", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, threeStories);
    h.handlers.write = (request) => {
      if (request.prompt.includes("Second [i4]")) throw new Error("model unavailable");
      return defaultHandlers.write(request);
    };

    const run = await h.run();

    expect(h.articles().map((article) => article.title)).toEqual(["First [i5]", "Third [i3]"]);
    expect(run.status).toBe("partial");
    expect(run.failures).toEqual([expect.objectContaining({ stage: "write", target: "Second [i4]" })]);
  });

  it("writes the failed story in the next run", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, threeStories);
    h.handlers.write = (request) => {
      if (request.prompt.includes("Second [i4]")) throw new Error("model unavailable");
      return defaultHandlers.write(request);
    };
    await h.run();

    h.handlers.write = defaultHandlers.write;
    const second = await h.run();

    expect(h.articles().map((article) => article.title).sort()).toEqual(["First [i5]", "Second [i4]", "Third [i3]"]);
    expect(second).toMatchObject({ collected: 0, articlesCreated: 1, status: "succeeded" });
    expect(h.requests.judge).toHaveLength(1);
  });

  it("stops at the run's limit of model calls, keeps what is finished and finishes the rest later", async () => {
    // judge = 1 call, cluster = 1 call, then one write per story: the limit of 3 allows one article.
    const h = pipelineHarness({ llmLimits: { llmCallsPerRun: 3, llmCallsPerDay: 300 } });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, threeStories);

    const run = await h.run();

    expect(run).toMatchObject({ status: "stopped_by_limit", stoppedBy: "run", llmCalls: 3, articlesCreated: 1 });
    expect(h.articles().map((article) => article.title)).toEqual(["First [i5]"]);

    await h.run();
    expect(h.articles()).toHaveLength(3);
  });

  it("calls no model in a run that starts after the day's limit is used up", async () => {
    const h = pipelineHarness({ llmLimits: { llmCallsPerRun: 40, llmCallsPerDay: 2 } });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "One", link: "https://example.org/1" }]);
    await h.run(); // judge + write = 2 calls
    h.feed(FEED, [{ title: "Two", link: "https://example.org/2" }]);

    const second = await h.run();

    expect(second).toMatchObject({ status: "stopped_by_limit", stoppedBy: "day", llmCalls: 0, articlesCreated: 0 });
  });

  it("stops when the budget period has used up its budget, keeping what is finished", async () => {
    const h = pipelineHarness({ llmPricing: resolvePricing("claude-sonnet-5-5")! });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, threeStories);
    // Another call took the period to $99.99; the judge call and the grouping take it over $100.
    h.db
      .prepare("INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES ('write', 'write', 1, 1, ?, 99.99, 1)")
      .run(h.clock().toISOString());
    h.handlers.judge = (request) => {
      h.db
        .prepare("INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES ('judge', 'judge', 1, 1, ?, 0.02, 1)")
        .run(h.clock().toISOString());
      return defaultHandlers.judge(request);
    };

    const run = await h.run();

    expect(run).toMatchObject({ status: "stopped_by_limit", stoppedBy: "budget", articlesCreated: 0 });
    expect(h.requests.write).toHaveLength(0);
  });

  it("has no limit to name when it is not stopped by one", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "One", link: "https://example.org/1" }]);

    expect(await h.run()).toMatchObject({ status: "succeeded", stoppedBy: null });
  });
});
