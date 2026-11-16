import { describe, expect, it } from "vitest";
import { getArticle } from "../db/articles.ts";
import { updateFeed } from "../db/feeds.ts";
import { pipelineHarness, sourcesIn } from "../testing/pipeline.ts";

const FEED = "https://example.org/feed.xml";
const HOUR = 3_600_000;

function setup(options: Parameters<typeof pipelineHarness>[0] = {}) {
  const h = pipelineHarness(options);
  const ago = (hours: number) => new Date(h.clock().getTime() - hours * HOUR).toISOString();
  return { h, ago };
}

describe("feed articles of topic sources in a run", () => {
  it("are judged as candidates of every enabled topic of the category, from a source of their own", async () => {
    const { h } = setup();
    const rust = h.addTopic("Rust releases");
    const go = h.addTopic("Go releases");
    h.addTopic("Switched off", { enabled: false });
    const feed = h.subscribe({ title: "Lang News" });
    h.deliver(feed, { title: "Rust 2.0 is out", link: "https://news.example.org/rust-2?utm_source=rss" });

    const run = await h.run();

    expect(h.requests.judge).toHaveLength(1);
    expect(h.candidates(run.id)).toEqual([
      expect.objectContaining({
        url: "https://news.example.org/rust-2",
        title: "Rust 2.0 is out",
        siteName: "Lang News",
        sourceKind: "subscription",
        status: "accepted",
        topics: [
          { id: rust.id, text: "Rust releases" },
          { id: go.id, text: "Go releases" },
        ],
      }),
    ]);
    expect(h.articles().map((article) => article.title)).toEqual(["Rust 2.0 is out"]);
  });

  it("take nothing from a feed that is no topic source: the run is the same as before", async () => {
    const { h } = setup();
    h.addTopic("Rust releases", { feeds: [FEED] });
    h.feed(FEED, [{ title: "From the topic's feed", link: "https://example.org/a" }]);
    const feed = h.subscribe({ topicSource: false });
    h.deliver(feed, { title: "Only subscribed", link: "https://news.example.org/b" });

    const run = await h.run();

    expect(h.candidates(run.id).map((candidate) => [candidate.title, candidate.sourceKind])).toEqual([["From the topic's feed", "feed"]]);
  });

  it("take nothing when no topic of the category is ready: there is nothing to judge against", async () => {
    const { h } = setup();
    h.addTopic("Switched off", { enabled: false });
    const feed = h.subscribe();
    h.deliver(feed, { title: "Rust 2.0 is out", link: "https://news.example.org/rust-2" });

    const run = await h.run();

    expect(h.candidates(run.id)).toEqual([]);
    expect(h.requests.judge).toHaveLength(0);
  });

  it("take only articles stored within the window, and not again once judged", async () => {
    const { h, ago } = setup({ category: { windowHours: 24 } });
    h.addTopic("Rust releases");
    const feed = h.subscribe();
    h.deliver(feed, { title: "Fresh", link: "https://news.example.org/fresh", storedAt: ago(3) });
    h.deliver(feed, { title: "Stale", link: "https://news.example.org/stale", storedAt: ago(72) });

    const first = await h.run();
    expect(h.candidates(first.id).map((candidate) => candidate.title)).toEqual(["Fresh"]);

    const second = await h.run();
    expect(h.candidates(second.id)).toEqual([]);
  });

  it("make one candidate with the topic's feed for the same page, keeping the topics of both", async () => {
    const { h } = setup();
    const rust = h.addTopic("Rust releases", { feeds: [FEED] });
    const go = h.addTopic("Go releases");
    h.feed(FEED, [{ title: "Rust 2.0 is out", link: "https://news.example.org/rust-2" }]);
    const feed = h.subscribe();
    const delivered = h.deliver(feed, { title: "Rust 2.0 is out", link: "https://news.example.org/rust-2" });

    const run = await h.run();

    const candidates = h.candidates(run.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ sourceKind: "feed", topics: [{ id: rust.id }, { id: go.id }] });
    // The feed article is still told which article it went into.
    expect(getArticle(h.db, delivered).summarizedIn).toEqual({ id: h.articles()[0]!.id, title: "Rust 2.0 is out" });
  });

  it("take the newest within the limit, leaving the rest to the next run", async () => {
    const { h, ago } = setup({ config: { subscriptionCandidatesPerRun: 2 } });
    h.addTopic("Rust releases");
    const feed = h.subscribe();
    h.deliver(feed, { title: "Oldest", link: "https://news.example.org/1", storedAt: ago(3) });
    h.deliver(feed, { title: "Middle", link: "https://news.example.org/2", storedAt: ago(2) });
    h.deliver(feed, { title: "Newest", link: "https://news.example.org/3", storedAt: ago(1) });

    const first = await h.run();
    expect(h.candidates(first.id).map((candidate) => candidate.title).sort()).toEqual(["Middle", "Newest"]);
    const second = await h.run();
    expect(h.candidates(second.id).map((candidate) => candidate.title)).toEqual(["Oldest"]);
  });

  it("stop when the feed stops being a topic source", async () => {
    const { h } = setup();
    h.addTopic("Rust releases");
    const feed = h.subscribe();
    h.deliver(feed, { title: "Rust 2.0 is out", link: "https://news.example.org/rust-2" });
    updateFeed(h.db, feed, { topicSource: false });

    const run = await h.run();

    expect(h.candidates(run.id)).toEqual([]);
  });
});

describe("writing a feed article into a generated article", () => {
  it("records the generated article on the feed article, which stays unread in its lists", async () => {
    const { h } = setup();
    h.addTopic("Rust releases");
    const feed = h.subscribe({ title: "Lang News" });
    const delivered = h.deliver(feed, { title: "Rust 2.0 is out {rust}", link: "https://news.example.org/rust-2" });
    const other = h.deliver(feed, { title: "Rust 2.0 benchmarks {rust}", link: "https://news.example.org/rust-2-bench" });
    h.page("https://news.example.org/rust-2", "Rust 2.0 was released today with a new edition.");

    await h.run();

    const generated = h.articles()[0]!;
    expect(getArticle(h.db, delivered)).toMatchObject({ summarizedIn: { id: generated.id, title: generated.title }, isRead: false });
    expect(getArticle(h.db, other).summarizedIn).toEqual({ id: generated.id, title: generated.title });
    expect(getArticle(h.db, generated.id).feedArticles.map((entry) => [entry.articleId, entry.feedTitle])).toEqual([
      [delivered, "Lang News"],
      [other, "Lang News"],
    ]);
  });

  it("hands the writer the content the feed delivered when the page cannot be fetched", async () => {
    const { h } = setup();
    h.addTopic("Rust releases");
    const feed = h.subscribe();
    h.deliver(feed, { title: "Rust 2.0 is out", link: "https://news.example.org/gone", content: "Rust 2.0 brings a new edition and faster builds." });

    await h.run();

    expect(sourcesIn(h.requests.write[0]!)[0]!.text).toBe("Rust 2.0 brings a new edition and faster builds.");
    expect(h.articles()[0]!.snippetOnly).toBe(false);
  });

  it("hands the writer the page when it can be fetched", async () => {
    const { h } = setup();
    h.addTopic("Rust releases");
    const feed = h.subscribe();
    h.deliver(feed, { title: "Rust 2.0 is out", link: "https://news.example.org/rust-2", content: "Short teaser." });
    h.page("https://news.example.org/rust-2", "Rust 2.0 was released today with a new edition.");

    await h.run();

    expect(sourcesIn(h.requests.write[0]!)[0]!.text).toContain("Rust 2.0 was released today");
  });

  it("lets the record go with the generated article", async () => {
    const { h } = setup();
    h.addTopic("Rust releases");
    const feed = h.subscribe();
    const delivered = h.deliver(feed, { title: "Rust 2.0 is out", link: "https://news.example.org/rust-2" });
    await h.run();

    h.db.prepare("DELETE FROM articles WHERE id = ?").run(h.articles()[0]!.id);

    expect(getArticle(h.db, delivered).summarizedIn).toBeNull();
  });
});
