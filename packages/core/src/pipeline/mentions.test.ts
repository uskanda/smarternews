import { describe, expect, it } from "vitest";
import { listMentionArticles } from "../db/mentions.ts";
import type { LlmRequest } from "../llm/adapter.ts";
import { defaultHandlers, pipelineHarness, type Harness } from "../testing/pipeline.ts";

const FEED = "https://example.org/feed.xml";
const HOUR = 3_600_000;

const BOJ = { name: "日本銀行", kind: "organization" };
const UEDA = { name: "植田和男", kind: "person" };
const TOKYO = { name: "東京", kind: "place" };
const MOF = { name: "財務省", kind: "organization" };

/** A write handler that answers with the default article and the given mentions, as the model would. */
function writesWith(mentions: unknown, title?: string) {
  return (request: LlmRequest) => {
    const base = defaultHandlers.write(request) as Record<string, unknown>;
    return { ...base, ...(title === undefined ? {} : { title }), mentions };
  };
}

async function publishedWith(mentions: unknown): Promise<{ h: Harness; id: number }> {
  const h = pipelineHarness();
  h.addTopic("Topic", { feeds: [FEED] });
  h.feed(FEED, [{ title: "Rate decision {boj}", link: "https://example.org/decision" }]);
  h.handlers.write = writesWith(mentions);
  await h.run();
  return { h, id: h.articles()[0]!.id };
}

async function followUp(h: Harness, mentions: unknown): Promise<void> {
  h.clock.advance(24 * HOUR);
  h.feed(FEED, [{ title: "Rate decision explained {boj}", link: "https://example.org/explained" }]);
  h.handlers.write = writesWith(mentions, "Rate decision, explained {boj}");
  await h.run();
}

const namesOf = (h: Harness) => h.articles().map((article) => article.mentions);
const writeCalls = (h: Harness) => Number(h.db.prepare("SELECT count(*) AS n FROM llm_calls WHERE task = 'write'").get()!.n);

describe("mentions of generated articles", () => {
  it("stores the names of the write output with the new article, in their order", async () => {
    const { h } = await publishedWith([BOJ, UEDA, TOKYO]);
    expect(namesOf(h)).toEqual([[BOJ, UEDA, TOKYO]]);
  });

  it("stores the article without names when only the names are not valid", async () => {
    const { h } = await publishedWith("日本銀行");
    const [article] = h.articles();
    expect(article!.title).toBe("Rate decision {boj}");
    expect(article!.mentions).toEqual([]);
    expect(writeCalls(h)).toBe(1);
  });

  it("replaces the names when a follow-up rewrites the article", async () => {
    const { h, id } = await publishedWith([BOJ, UEDA]);
    await followUp(h, [UEDA, MOF]);

    expect(h.articles()).toMatchObject([{ id, title: "Rate decision, explained {boj}", revision: 1 }]);
    expect(namesOf(h)).toEqual([[UEDA, MOF]]);
    expect(listMentionArticles(h.db, { name: "日本銀行" }, h.clock().toISOString()).items).toEqual([]);
  });

  it("gives names to an article stored without them when a follow-up rewrites it", async () => {
    const { h } = await publishedWith(undefined);
    expect(namesOf(h)).toEqual([[]]);
    await followUp(h, [BOJ]);
    expect(namesOf(h)).toEqual([[BOJ]]);
  });

  it("keeps the earlier names when the names of the rewrite are not valid, and stores the rewritten body", async () => {
    const { h } = await publishedWith([BOJ, UEDA]);
    await followUp(h, { name: "財務省" });

    expect(h.articles()).toMatchObject([{ title: "Rate decision, explained {boj}", revision: 1 }]);
    expect(namesOf(h)).toEqual([[BOJ, UEDA]]);
  });

  it("removes every name when the rewrite finds none", async () => {
    const { h } = await publishedWith([BOJ]);
    await followUp(h, []);
    expect(namesOf(h)).toEqual([[]]);
  });

  it("makes two write calls and nothing else for names, for two new articles", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [
      { title: "First story", link: "https://example.org/first" },
      { title: "Second story", link: "https://example.org/second" },
    ]);
    h.handlers.write = writesWith([BOJ]);

    await h.run();

    expect(namesOf(h)).toEqual([[BOJ], [BOJ]]);
    const calls = h.db.prepare("SELECT task, count(*) AS n FROM llm_calls GROUP BY task ORDER BY task").all();
    expect(calls).toEqual([
      { task: "cluster", n: 1 },
      { task: "judge", n: 1 },
      { task: "write", n: 2 },
    ]);
  });
});

describe("mentions of event articles", () => {
  function eventHarness(names: Record<string, unknown>) {
    const h = pipelineHarness({ kind: "event", now: "2026-03-01T12:00:00.000Z" });
    h.addTopic("Fairs", { feeds: [FEED] });
    h.handlers.write = (request) => {
      const base = defaultHandlers.write(request) as Record<string, unknown> & { title: string };
      const event = { name: "Spring Maker Fair", startsAt: "2026-03-07", endsAt: null, venue: null, fee: null, registration: "unknown" };
      return { ...base, event, mentions: names[base.title] };
    };
    return h;
  }

  it("stores the names of an event article", async () => {
    const h = eventHarness({ "Spring Maker Fair": [{ name: "Maker Faire", kind: "organization" }, TOKYO] });
    h.feed(FEED, [{ title: "Spring Maker Fair", link: "https://example.org/fair" }]);

    await h.run();

    expect(namesOf(h)).toEqual([[{ name: "Maker Faire", kind: "organization" }, TOKYO]]);
  });

  it("replaces the names when the same event is found again under another headline, and keeps them when the new ones are not valid", async () => {
    const h = eventHarness({
      "Spring Maker Fair": [TOKYO],
      "Maker fair this weekend": [{ name: "Maker Faire", kind: "organization" }],
      "Maker fair tickets": [{ name: "Maker Faire" }],
    });
    h.feed(FEED, [{ title: "Spring Maker Fair", link: "https://example.org/fair" }]);
    await h.run();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Maker fair this weekend", link: "https://example.net/weekend" }]);
    await h.run();
    expect(namesOf(h)).toEqual([[{ name: "Maker Faire", kind: "organization" }]]);

    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Maker fair tickets", link: "https://example.net/tickets" }]);
    await h.run();
    expect(h.articles()).toHaveLength(1);
    expect(h.articles()[0]!.refs).toHaveLength(3);
    expect(namesOf(h)).toEqual([[{ name: "Maker Faire", kind: "organization" }]]);
  });
});
