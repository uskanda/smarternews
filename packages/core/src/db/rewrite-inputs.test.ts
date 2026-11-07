import { describe, expect, it } from "vitest";
import { reasonText } from "../pipeline/reasons.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { insertArticle, recordArticleOpened, setArticleFlags } from "./articles.ts";
import { insertCandidate } from "./candidates.ts";
import { createCategory } from "./categories.ts";
import { MISS_LIMIT } from "./misses.ts";
import { REWRITE_OPENED_LIMIT, REWRITE_REJECTED_LIMIT, REWRITE_STARRED_LIMIT, rewriteInputs } from "./rewrite-inputs.ts";
import { createRun } from "./runs.ts";
import { createTopic } from "./topics.ts";

const NOW = "2026-03-31T12:00:00.000Z";
const DAY = 86_400_000;
const daysAgo = (days: number, minutes = 0) => new Date(Date.parse(NOW) - days * DAY + minutes * 60_000).toISOString();

function setup() {
  const clock = fakeClock(NOW);
  const db = createTestDb();
  const categoryId = createCategory(db, { name: "Databases", kind: "news" }, clock).id;
  const topic = createTopic(db, categoryId, { text: "Releases" }, clock);
  const other = createTopic(db, categoryId, { text: "Benchmarks" }, clock);
  const run = createRun(db, { categoryId, trigger: "manual", slot: null }, clock);
  const article = (title: string, at: string, topicIds = [topic.id]) =>
    insertArticle(db, {
      categoryId,
      kind: "news",
      title,
      summary: `Summary of ${title}`,
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: at,
      previousArticleId: null,
      refs: [],
      topicIds,
    });
  let n = 0;
  const candidate = (title: string, reason: string, at: string, topicIds = [topic.id], status: "pending" | "rejected" = "rejected") => {
    n += 1;
    return insertCandidate(db, {
      categoryId,
      runId: run.id,
      url: `https://example.org/${n}`,
      fetchable: true,
      title,
      snippet: "s",
      siteName: "Example",
      publishedAt: at,
      sourceKind: "feed",
      status,
      reason,
      importance: 1,
      topicIds,
      now: at,
    });
  };
  return { db, topic, other, article, candidate };
}

describe("rewriteInputs", () => {
  it("takes the topic's articles opened in the last 30 days, the last opened first, with their summaries", () => {
    const s = setup();
    const old = s.article("Opened long ago", daysAgo(50));
    const recent = s.article("Opened lately", daysAgo(40));
    const newer = s.article("Opened today", daysAgo(5));
    const elsewhere = s.article("Of another topic", daysAgo(2), [s.other.id]);
    s.article("Never opened", daysAgo(1));
    recordArticleOpened(s.db, old, daysAgo(40));
    recordArticleOpened(s.db, recent, daysAgo(10));
    recordArticleOpened(s.db, newer, daysAgo(0, -60));
    recordArticleOpened(s.db, elsewhere, daysAgo(1));

    expect(rewriteInputs(s.db, s.topic.id, NOW).opened).toEqual([
      { title: "Opened today", summary: "Summary of Opened today" },
      { title: "Opened lately", summary: "Summary of Opened lately" },
    ]);
  });

  it("takes the topic's starred articles made in the last 30 days, newest first", () => {
    const s = setup();
    for (const [title, at] of [
      ["Starred long ago", daysAgo(31)],
      ["Starred lately", daysAgo(3)],
      ["Starred today", daysAgo(0, -5)],
    ] as const) {
      setArticleFlags(s.db, s.article(title, at), { starred: true }, NOW);
    }
    setArticleFlags(s.db, s.article("Starred elsewhere", daysAgo(1), [s.other.id]), { starred: true }, NOW);
    s.article("Not starred", daysAgo(1));

    expect(rewriteInputs(s.db, s.topic.id, NOW).starred.map((article) => article.title)).toEqual(["Starred today", "Starred lately"]);
  });

  it("keeps to the limits of each list", () => {
    const s = setup();
    for (let i = 0; i < REWRITE_OPENED_LIMIT + 3; i += 1) {
      const id = s.article(`Article ${i}`, daysAgo(10, i));
      recordArticleOpened(s.db, id, daysAgo(5, i));
      setArticleFlags(s.db, id, { starred: true }, NOW);
    }
    for (let i = 0; i < REWRITE_REJECTED_LIMIT + 3; i += 1) s.candidate(`Page ${i}`, "Not relevant.", daysAgo(10, i));

    const inputs = rewriteInputs(s.db, s.topic.id, NOW);
    expect(inputs.opened).toHaveLength(REWRITE_OPENED_LIMIT);
    expect(inputs.opened[0]!.title).toBe(`Article ${REWRITE_OPENED_LIMIT + 2}`);
    expect(inputs.starred).toHaveLength(REWRITE_STARRED_LIMIT);
    expect(inputs.rejected).toHaveLength(REWRITE_REJECTED_LIMIT);
    expect(inputs.rejected[0]!.title).toBe(`Page ${REWRITE_REJECTED_LIMIT + 2}`);
  });

  it("takes only the candidates the judge found not relevant, with the judge's reason", () => {
    const s = setup();
    s.candidate("Off topic", "A tutorial, not a release.", daysAgo(2));
    s.candidate("Below the minimum", reasonText("below-minimum", "ja"), daysAgo(2));
    s.candidate("Over the cap", reasonText("over-limit", "en"), daysAgo(2));
    s.candidate("No date", reasonText("no-date", "ja"), daysAgo(2));
    s.candidate("Waiting", "Relevant.", daysAgo(2), [s.topic.id], "pending");
    s.candidate("Another topic's", "Not relevant.", daysAgo(2), [s.other.id]);
    s.candidate("Too old", "Not relevant.", daysAgo(31));

    expect(rewriteInputs(s.db, s.topic.id, NOW).rejected).toEqual([{ title: "Off topic", reason: "A tutorial, not a release." }]);
  });

  it("takes the misses as the interpretation reads them: 90 days back, newest first, 20 at most", () => {
    const s = setup();
    const missed = (title: string, at: string) => setArticleFlags(s.db, s.article(title, at), { missed: true }, at);
    missed("Missed long ago", daysAgo(91));
    for (let i = 0; i < MISS_LIMIT + 1; i += 1) missed(`Missed ${i}`, daysAgo(80, i));

    const misses = rewriteInputs(s.db, s.topic.id, NOW).misses;
    expect(misses).toHaveLength(MISS_LIMIT);
    expect(misses[0]).toBe(`Missed ${MISS_LIMIT}`);
    expect(misses).not.toContain("Missed long ago");
  });

  it("gives empty lists for a topic with nothing", () => {
    const s = setup();
    expect(rewriteInputs(s.db, s.topic.id, NOW)).toEqual({ opened: [], starred: [], misses: [], rejected: [] });
  });
});
