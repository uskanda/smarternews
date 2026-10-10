import { describe, expect, it } from "vitest";
import { pipelineHarness, sourcesIn } from "../testing/pipeline.ts";

const FEED = "https://example.org/feed.xml";

describe("grouping and selecting stories", () => {
  it("writes one article for pages about the same story", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "Launch {launch} report one", link: "https://example.org/1" },
      { title: "Launch {launch} report two", link: "https://example.net/2" },
      { title: "Launch {launch} report three", link: "https://example.com/3" },
      { title: "Unrelated {other}", link: "https://example.org/4" },
    ]);

    await h.run();

    const articles = h.articles();
    expect(articles.map((article) => article.refs.length).sort()).toEqual([1, 3]);
    expect(h.requests.write).toHaveLength(2);
  });

  it("gives the article the highest importance among its pages", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "{s} a [i2]", link: "https://example.org/1" },
      { title: "{s} b [i4]", link: "https://example.org/2" },
      { title: "{s} c [i3]", link: "https://example.org/3" },
    ]);

    await h.run();

    expect(h.articles()).toMatchObject([{ importance: 4 }]);
  });

  it("writes no article for a story below the category's minimum importance", async () => {
    const h = pipelineHarness({ outputLanguage: "ja", category: { minImportance: 3 } });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Minor [i2]", link: "https://example.org/minor" }]);

    const run = await h.run();

    expect(h.articles()).toEqual([]);
    expect(h.requests.write).toHaveLength(0);
    expect(h.candidates(run.id, "rejected")).toMatchObject([{ title: "Minor [i2]", reason: "重要度が基準未満" }]);
  });

  it("writes only the most important stories up to the category's limit", async () => {
    const h = pipelineHarness({ outputLanguage: "ja", category: { maxArticlesPerRun: 5 } });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "A [i3]", link: "https://example.org/a" },
      { title: "B [i5]", link: "https://example.org/b" },
      { title: "C [i4]", link: "https://example.org/c" },
      { title: "D [i3]", link: "https://example.org/d" },
      { title: "E [i5]", link: "https://example.org/e" },
      { title: "F [i4]", link: "https://example.org/f" },
      { title: "G [i4]", link: "https://example.org/g" },
    ]);

    const run = await h.run();

    expect(h.articles().map((article) => article.title).sort()).toEqual(["B [i5]", "C [i4]", "E [i5]", "F [i4]", "G [i4]"]);
    expect(h.candidates(run.id, "rejected").map((candidate) => [candidate.title, candidate.reason]).sort()).toEqual([
      ["A [i3]", "件数上限"],
      ["D [i3]", "件数上限"],
    ]);
    expect(run).toMatchObject({ articlesCreated: 5, rejected: 2 });
  });

  it("stores title, summary, body, importance, references and topics with the article", async () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Topic", { feeds: [FEED] });
    h.feed(
      FEED,
      [
        { title: "{s} first [i4]", link: "https://example.org/1", published: "2026-03-01T09:00:00Z" },
        { title: "{s} second", link: "https://example.net/2", published: "2026-03-01T10:00:00Z" },
      ],
      "Example Feed",
    );

    await h.run();

    expect(h.articles()).toMatchObject([
      {
        title: "{s} first [i4]",
        summary: "Summary of 2 source(s).",
        body: "Body paragraph.",
        importance: 4,
        kind: "news",
        revision: 0,
        isRead: false,
        firstPublishedAt: "2026-03-01T12:00:00.000Z",
        refs: [
          { url: "https://example.org/1", siteName: "Example Feed", publishedAt: "2026-03-01T09:00:00.000Z" },
          { url: "https://example.net/2", siteName: "Example Feed", publishedAt: "2026-03-01T10:00:00.000Z" },
        ],
        topics: [{ id: topic.id, text: "Topic" }],
      },
    ]);
  });

  it("ignores a group that names a candidate the run does not have and keeps its pages for later", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "One", link: "https://example.org/1" },
      { title: "Two", link: "https://example.org/2" },
    ]);
    h.handlers.cluster = () => ({ groups: [{ candidateIds: [987654], existingArticleId: null }] });

    const run = await h.run();

    // Pages the model left out of every group are written on their own.
    expect(h.articles()).toHaveLength(2);
    expect(run.failures).toEqual([expect.objectContaining({ stage: "cluster" })]);
  });

  it("skips grouping when there is one relevant page and nothing published", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Only one", link: "https://example.org/1" }]);

    const run = await h.run();

    expect(h.requests.cluster).toHaveLength(0);
    expect(run.llmCalls).toBe(2);
  });

  it("passes every page of a story to the writer", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "{s} one", link: "https://example.org/1" },
      { title: "{s} two", link: "https://example.org/2" },
    ]);

    await h.run();

    expect(sourcesIn(h.requests.write[0]!).map((source) => source.url)).toEqual(["https://example.org/1", "https://example.org/2"]);
  });
});
