import { describe, expect, it } from "vitest";
import { rankTopicStats, type SourceKind, type TopicStatsEntry } from "../api.ts";
import type { ReasonCode } from "../pipeline/reasons.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { insertArticle, recordArticleOpened, reviseArticle, setArticleFlags } from "./articles.ts";
import { insertCandidate } from "./candidates.ts";
import { createCategory } from "./categories.ts";
import { createRun } from "./runs.ts";
import { topicStats } from "./topicStats.ts";
import { createTopic } from "./topics.ts";

const NOW = new Date("2026-03-31T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function setup() {
  const clock = fakeClock(NOW.toISOString());
  const db = createTestDb();
  const categoryId = createCategory(db, { name: "Security", kind: "news" }, clock).id;
  const otherCategoryId = createCategory(db, { name: "Other", kind: "news" }, clock).id;
  const topic = createTopic(db, categoryId, { text: "Vulnerabilities" }, clock);
  const quiet = createTopic(db, categoryId, { text: "Quiet topic" }, clock);
  const elsewhere = createTopic(db, otherCategoryId, { text: "Elsewhere" }, clock);
  const run = createRun(db, { categoryId, trigger: "manual", slot: null }, clock);
  let serial = 0;
  const candidate = (
    options: {
      status?: "rejected" | "pending" | "accepted";
      reasonCode?: ReasonCode | null;
      sourceKind?: SourceKind;
      siteName?: string;
      at?: string;
      topicIds?: number[];
      category?: number;
    } = {},
  ) => {
    serial += 1;
    const id = insertCandidate(db, {
      categoryId: options.category ?? categoryId,
      runId: run.id,
      url: `https://example.org/${serial}`,
      fetchable: true,
      title: `Story ${serial}`,
      snippet: "",
      siteName: options.siteName ?? "",
      publishedAt: null,
      sourceKind: options.sourceKind ?? "feed",
      status: options.status === "accepted" ? "pending" : (options.status ?? "rejected"),
      reason: "why",
      reasonCode: options.reasonCode ?? null,
      importance: 3,
      topicIds: options.topicIds ?? [topic.id],
      now: options.at ?? daysAgo(1),
    });
    if (options.status === "accepted") db.prepare("UPDATE candidates SET status = 'accepted' WHERE id = ?").run(id);
    return id;
  };
  const article = (options: { at?: string; topicIds?: number[] } = {}) =>
    insertArticle(db, {
      categoryId,
      kind: "news",
      title: "Story",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: options.at ?? daysAgo(1),
      previousArticleId: null,
      refs: [],
      topicIds: options.topicIds ?? [topic.id],
    });
  const stats = () => topicStats(db, categoryId, NOW);
  const of = (topicId: number) => stats().topics.find((entry) => entry.topicId === topicId)!;
  return { db, categoryId, otherCategoryId, topic, quiet, elsewhere, candidate, article, stats, of };
}

describe("topicStats", () => {
  it("lists every topic of the category in the order of their ids, those without anything with zeros", () => {
    const s = setup();
    const result = s.stats();
    expect(result.since).toBe(daysAgo(30));
    expect(result.topics.map((entry) => entry.text)).toEqual(["Vulnerabilities", "Quiet topic"]);
    expect(result.topics[1]).toEqual({
      topicId: s.quiet.id,
      text: "Quiet topic",
      collected: { total: 0, bySource: { feed: 0, "news-search": 0, "llm-search": 0 } },
      rejectedByJudge: 0,
      belowMinimum: 0,
      overLimit: 0,
      rejectedByDate: 0,
      created: 0,
      updated: 0,
      opened: 0,
      starred: 0,
      missed: 0,
      topRejectedSites: [],
    });
  });

  it("counts the candidates collected by each kind of source", () => {
    const s = setup();
    s.candidate({ sourceKind: "feed" });
    s.candidate({ sourceKind: "feed", status: "pending" });
    s.candidate({ sourceKind: "news-search", status: "accepted" });
    s.candidate({ sourceKind: "llm-search" });
    s.candidate({ sourceKind: "llm-search", topicIds: [s.topic.id, s.quiet.id] });

    expect(s.of(s.topic.id).collected).toEqual({ total: 5, bySource: { feed: 2, "news-search": 1, "llm-search": 2 } });
    expect(s.of(s.quiet.id).collected).toEqual({ total: 1, bySource: { feed: 0, "news-search": 0, "llm-search": 1 } });
  });

  it("counts the rejections by the kind of their reason, the three kinds about dates together", () => {
    const s = setup();
    s.candidate({ reasonCode: null });
    s.candidate({ reasonCode: null });
    s.candidate({ reasonCode: "below-minimum" });
    s.candidate({ reasonCode: "over-limit" });
    s.candidate({ reasonCode: "over-limit" });
    s.candidate({ reasonCode: "no-date" });
    s.candidate({ reasonCode: "event-outside-window" });
    s.candidate({ reasonCode: "event-no-date" });
    s.candidate({ status: "pending" });

    expect(s.of(s.topic.id)).toMatchObject({ rejectedByJudge: 2, belowMinimum: 1, overLimit: 2, rejectedByDate: 3 });
  });

  it("counts the candidates of the last 30 days only, and those of the category only", () => {
    const s = setup();
    s.candidate({ at: daysAgo(30) });
    s.candidate({ at: new Date(NOW.getTime() - 30 * DAY - 1).toISOString() });
    s.candidate({ category: s.otherCategoryId, topicIds: [s.elsewhere.id] });

    expect(s.of(s.topic.id).collected.total).toBe(1);
    expect(s.of(s.topic.id).rejectedByJudge).toBe(1);
  });

  it("counts the articles made and rewritten within the period, and what became of the ones made", () => {
    const s = setup();
    const opened = s.article();
    recordArticleOpened(s.db, opened, NOW.toISOString());
    const starred = s.article();
    setArticleFlags(s.db, starred, { starred: true }, NOW.toISOString());
    s.article();
    s.article({ at: daysAgo(31) });
    const revised = s.article({ at: daysAgo(40) });
    reviseArticle(s.db, revised, {
      title: "Story, updated",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: daysAgo(2),
      refs: [],
      topicIds: [s.topic.id],
    });
    // A revision before the period does not count.
    const old = s.article({ at: daysAgo(50) });
    reviseArticle(s.db, old, {
      title: "Old, updated",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: daysAgo(45),
      refs: [],
      topicIds: [s.topic.id],
    });

    expect(s.of(s.topic.id)).toMatchObject({ created: 3, updated: 1, opened: 1, starred: 1 });
  });

  it("leaves feed articles out, even one linked to the topic", () => {
    const s = setup();
    const feed = seedFeed(s.db, { categoryId: s.categoryId });
    const id = seedFeedArticle(s.db, feed, { at: daysAgo(1), starred: true });
    s.db.prepare("INSERT INTO article_topics (article_id, topic_id) VALUES (?, ?)").run(id, s.topic.id);

    expect(s.of(s.topic.id)).toMatchObject({ created: 0, starred: 0 });
  });

  it("counts the articles made within the period that carry a miss for the topic, and drops one whose mark is taken away", () => {
    const s = setup();
    const both = s.article({ topicIds: [s.topic.id, s.quiet.id] });
    const taken = s.article();
    s.article();
    const old = s.article({ at: daysAgo(31) });
    for (const id of [both, taken, old]) setArticleFlags(s.db, id, { missed: true }, NOW.toISOString());
    setArticleFlags(s.db, taken, { missed: false }, NOW.toISOString());

    expect(s.of(s.topic.id)).toMatchObject({ created: 3, missed: 1 });
    expect(s.of(s.quiet.id)).toMatchObject({ created: 1, missed: 1 });
  });

  it("names the three sites with the most rejected candidates, without the candidates that have no site", () => {
    const s = setup();
    for (const [site, count] of [["a.example", 1], ["b.example", 3], ["c.example", 2], ["d.example", 2], ["", 5]] as const) {
      for (let i = 0; i < count; i += 1) s.candidate({ siteName: site, reasonCode: i % 2 === 0 ? null : "below-minimum" });
    }
    s.candidate({ siteName: "a.example", status: "pending" });
    s.candidate({ siteName: "a.example", status: "accepted" });

    expect(s.of(s.topic.id).topRejectedSites).toEqual([
      { siteName: "b.example", count: 3 },
      { siteName: "c.example", count: 2 },
      { siteName: "d.example", count: 2 },
    ]);
  });

  it("refuses a category that does not exist", () => {
    const s = setup();
    expect(() => topicStats(s.db, 999, NOW)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

function entry(topicId: number, values: { collected?: number; rejected?: number; created?: number; missed?: number }): TopicStatsEntry {
  return {
    topicId,
    text: `Topic ${topicId}`,
    collected: { total: values.collected ?? 0, bySource: { feed: values.collected ?? 0, "news-search": 0, "llm-search": 0 } },
    rejectedByJudge: values.rejected ?? 0,
    belowMinimum: 0,
    overLimit: 0,
    rejectedByDate: 0,
    created: values.created ?? 0,
    updated: 0,
    opened: 0,
    starred: 0,
    missed: values.missed ?? 0,
    topRejectedSites: [],
  };
}

describe("rankTopicStats", () => {
  it("puts the topics that collected nothing first, then the higher shares of misses, then the higher shares of rejections", () => {
    const ranked = rankTopicStats([
      entry(1, { collected: 10, rejected: 9, created: 1, missed: 0 }),
      entry(2, { collected: 10, rejected: 5, created: 5, missed: 1 }),
      entry(3, {}),
      entry(4, { collected: 10, rejected: 8, created: 2, missed: 1 }),
      entry(5, { collected: 10, rejected: 6, created: 4, missed: 2 }),
      entry(6, {}),
      entry(7, { collected: 10, rejected: 2, created: 0 }),
    ]);
    // 4 and 5 miss half of their articles; 4 rejects more. 2 misses a fifth. 1, 7 miss none; 1 rejects more.
    expect(ranked.map((item) => item.topicId)).toEqual([3, 6, 4, 5, 2, 1, 7]);
  });

  it("leaves the entries it was given in their order", () => {
    const entries = [entry(2, {}), entry(1, {})];
    rankTopicStats(entries);
    expect(entries.map((item) => item.topicId)).toEqual([2, 1]);
  });
});
