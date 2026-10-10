import { describe, expect, it } from "vitest";
import { setArticleFlags } from "../db/articles.ts";
import { pipelineHarness, sourcesIn } from "../testing/pipeline.ts";

const FEED = "https://example.org/feed.xml";
const HOUR = 3_600_000;

async function published() {
  const h = pipelineHarness();
  h.addTopic("Topic", { feeds: [FEED] });
  h.feed(FEED, [{ title: "Flaw disclosed {flaw} [i4]", link: "https://example.org/disclosed" }]);
  await h.run();
  const [article] = h.articles();
  setArticleFlags(h.db, article!.id, { isRead: true });
  return { h, article: article! };
}

describe("follow-up within 72 hours", () => {
  it("updates the published article instead of adding a new one", async () => {
    const { h, article } = await published();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);
    h.handlers.write = (request) => ({
      title: "Flaw disclosed and patched {flaw}",
      summary: "Now with a patch.",
      body: `Rewritten from ${sourcesIn(request).length} new source(s).`,
      unconfirmed: false,
      impact: null,
      event: null,
    });

    const run = await h.run();

    const articles = h.articles();
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      id: article.id,
      title: "Flaw disclosed and patched {flaw}",
      body: "Rewritten from 1 new source(s).",
      firstPublishedAt: "2026-03-01T12:00:00.000Z",
      updatedAt: "2026-03-02T12:00:00.000Z",
      importance: 4,
    });
    expect(articles[0]!.refs.map((ref) => ref.url)).toEqual(["https://example.org/disclosed", "https://example.org/patch"]);
    expect(run).toMatchObject({ articlesCreated: 0, articlesUpdated: 1 });
  });

  it("makes the updated article unread again and counts the update", async () => {
    const { h } = await published();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    await h.run();

    expect(h.articles()).toMatchObject([{ isRead: false, revision: 1 }]);
  });

  it("gives the writer the published article together with the new pages", async () => {
    const { h } = await published();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    await h.run();

    const prompt = h.requests.write[1]!.prompt;
    expect(prompt).toContain("This story already has an article");
    expect(prompt).toContain("Flaw disclosed {flaw} [i4]");
    expect(sourcesIn(h.requests.write[1]!).map((source) => source.url)).toEqual(["https://example.org/patch"]);
  });

  it("does not count an update against the limit of new articles", async () => {
    const h = pipelineHarness({ category: { maxArticlesPerRun: 1 } });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Old {old} [i5]", link: "https://example.org/old" }]);
    await h.run();
    h.clock.advance(HOUR);
    h.feed(FEED, [
      { title: "Old follow-up {old} [i3]", link: "https://example.org/old-2" },
      { title: "New {new} [i3]", link: "https://example.org/new" },
    ]);

    const run = await h.run();

    expect(run).toMatchObject({ articlesCreated: 1, articlesUpdated: 1 });
  });

  it("ignores a follow-up below the minimum importance", async () => {
    const { h } = await published();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Minor note {flaw} [i1]", link: "https://example.org/minor" }]);

    const run = await h.run();

    expect(h.articles()).toMatchObject([{ revision: 0 }]);
    expect(run.articlesUpdated).toBe(0);
  });
});

describe("follow-up after 72 hours", () => {
  it("writes a new article that points back to the earlier one", async () => {
    const { h, article } = await published();
    h.clock.advance(7 * 24 * HOUR);
    h.feed(FEED, [{ title: "Lawsuit filed {flaw}", link: "https://example.org/lawsuit" }]);

    const run = await h.run();

    const articles = h.articles();
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({ id: article.id, revision: 0, isRead: true });
    expect(articles[1]).toMatchObject({ title: "Lawsuit filed {flaw}", previousArticleId: article.id, revision: 0 });
    expect(run).toMatchObject({ articlesCreated: 1, articlesUpdated: 0 });
  });
});
