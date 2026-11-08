import { describe, expect, it } from "vitest";
import { getArticle, setArticleFlags } from "../db/articles.ts";
import { getDigest, saveDigest } from "../db/digests.ts";
import { createCategory } from "../db/categories.ts";
import { createRun, finishRun, getRun } from "../db/runs.ts";
import { listSearchAttempts } from "../db/search-attempts.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { pipelineHarness } from "../testing/pipeline.ts";
import { dismissAttention, isAttentionDismissed } from "./attention.ts";
import { purgeExpired } from "./retention.ts";

const FEED = "https://example.org/feed.xml";
const DAY = 86_400_000;

async function seeded() {
  const h = pipelineHarness();
  h.addTopic("Topic", { feeds: [FEED] });
  h.feed(FEED, [
    { title: "Kept story", link: "https://example.org/kept" },
    { title: "Plain story", link: "https://example.org/plain" },
    { title: "Ad [skip]", link: "https://example.org/ad" },
  ]);
  const run = await h.run();
  const [kept, plain] = h.articles();
  setArticleFlags(h.db, kept!.id, { starred: true }, "2026-03-01T12:00:00.000Z");
  return { h, run, kept: kept!, plain: plain! };
}

describe("purgeExpired", () => {
  it("keeps everything that is younger than its retention period", async () => {
    const { h, run, plain } = await seeded();
    h.clock.advance(29 * DAY);

    purgeExpired(h.db, h.clock);

    expect(getRun(h.db, run.id).id).toBe(run.id);
    expect(h.candidates(run.id, "rejected")).toHaveLength(1);
    expect(getArticle(h.db, plain.id).title).toBe("Plain story");
  });

  it("removes a run and its rejected candidates after thirty days", async () => {
    const { h, run } = await seeded();
    h.clock.advance(31 * DAY);

    purgeExpired(h.db, h.clock);

    expect(() => getRun(h.db, run.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(h.candidates(run.id)).toEqual([]);
  });

  it("removes the record of searches and of dismissed attention items after thirty days", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { newsSearch: true, queries: ["q"] });
    h.news({});
    const run = await h.run();
    dismissAttention(h.db, "run:1", h.clock);
    h.clock.advance(29 * DAY);
    purgeExpired(h.db, h.clock);
    expect(listSearchAttempts(h.db, run.id)).toHaveLength(1);
    expect(isAttentionDismissed(h.db, "run:1")).toBe(true);

    h.clock.advance(2 * DAY);
    purgeExpired(h.db, h.clock);

    expect(listSearchAttempts(h.db, run.id)).toEqual([]);
    expect(isAttentionDismissed(h.db, "run:1")).toBe(false);
  });

  it("removes an article without a star 180 days after its last update", async () => {
    const { h, plain } = await seeded();
    h.clock.advance(181 * DAY);

    purgeExpired(h.db, h.clock);

    expect(() => getArticle(h.db, plain.id)).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("keeps a starred article however old it is", async () => {
    const { h, kept } = await seeded();
    h.clock.advance(365 * DAY);

    purgeExpired(h.db, h.clock);

    expect(getArticle(h.db, kept.id).title).toBe("Kept story");
  });

  it("still treats a purged candidate's URL as settled", async () => {
    const { h } = await seeded();
    h.clock.advance(40 * DAY);
    purgeExpired(h.db, h.clock);
    h.feed(FEED, [{ title: "Ad [skip]", link: "https://example.org/ad" }]);

    const run = await h.run();

    expect(run).toMatchObject({ collected: 0, llmCalls: 0 });
  });

  it("removes a digest 180 days after it was made, and keeps it when its source articles are gone", async () => {
    const { h, plain } = await seeded();
    const digest = (createdAt: string) =>
      saveDigest(h.db, {
        periodStart: createdAt,
        periodEnd: createdAt,
        createdAt,
        trigger: "manual",
        slot: null,
        executiveSummary: "Summary.",
        sections: [{ categoryId: 1, categoryName: "C", lines: [{ text: "Line.", articleIds: [plain.id] }] }],
        articleCount: 1,
      });
    const now = h.clock().getTime();
    const old = digest(new Date(now - 181 * DAY).toISOString());
    const recent = digest(new Date(now - DAY).toISOString());
    h.db.prepare("DELETE FROM articles WHERE id = ?").run(plain.id);

    purgeExpired(h.db, h.clock);

    expect(() => getDigest(h.db, old)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(getDigest(h.db, recent)).toMatchObject({ articles: [], sections: [{ lines: [{ text: "Line.", articleIds: [plain.id] }] }] });
  });
});

describe("purgeExpired and the records of model calls", () => {
  /** A run queued on 10 October with one model call, and a call on 9 October outside any run; the clock at noon on 9 November. */
  function withCalls() {
    const db = createTestDb();
    const clock = fakeClock("2026-10-10T06:00:00.000Z");
    const category = createCategory(db, { name: "C", slug: "c", kind: "news" }, clock);
    const run = createRun(db, { categoryId: category.id, trigger: "manual", slot: null }, clock);
    finishRun(db, run.id, {
      status: "succeeded",
      finishedAt: clock().toISOString(),
      collected: 0,
      rejected: 0,
      articlesCreated: 0,
      articlesUpdated: 0,
      llmCalls: 1,
      failures: [],
    });
    const insert = db.prepare(
      "INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES (?, 'write', 'smart', 1, 1, ?, 1, 1)",
    );
    insert.run(run.id, "2026-10-10T06:00:00.000Z");
    insert.run(null, "2026-10-09T06:00:00.000Z");
    clock.set("2026-11-09T12:00:00.000Z");
    const calls = () => db.prepare("SELECT run_id, created_at FROM llm_calls ORDER BY created_at").all();
    return { db, clock, run, calls };
  }

  it("keeps the calls of the budget period when it began more than thirty days ago", () => {
    const { db, clock, calls } = withCalls();

    purgeExpired(db, clock, { keepCallsSince: new Date("2026-10-10T00:00:00.000Z") });

    expect(calls()).toEqual([{ run_id: null, created_at: "2026-10-10T06:00:00.000Z" }]);
  });

  it("removes the run after thirty days all the same, and its call stays as one outside any run", () => {
    const { db, clock, run, calls } = withCalls();

    purgeExpired(db, clock, { keepCallsSince: new Date("2026-10-10T00:00:00.000Z") });

    expect(() => getRun(db, run.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(calls()).toHaveLength(1);
  });

  it("removes the calls older than thirty days when no budget period is given", () => {
    const { db, clock, calls } = withCalls();

    purgeExpired(db, clock);

    expect(calls()).toEqual([]);
  });
});
