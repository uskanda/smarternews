import { describe, expect, it } from "vitest";
import type { RunFailure, RunStatus, Topic } from "../api.ts";
import { updateCategory } from "../db/categories.ts";
import { createRun, finishRun, setRetry } from "../db/runs.ts";
import { recordSearchAttempt } from "../db/search-attempts.ts";
import { updateTopic } from "../db/topics.ts";
import { pipelineHarness, type Harness } from "../testing/pipeline.ts";
import { dismissAttention, listAttention } from "./attention.ts";

const DAY = 86_400_000;
const FEED = "https://example.org/feed.xml";

/** A run of the harness's category that ended as `status`. Scheduled runs get a slot of their own. */
function finished(
  h: Harness,
  status: Exclude<RunStatus, "queued" | "running">,
  options: { trigger?: "schedule" | "manual"; retryAt?: string; failures?: RunFailure[] } = {},
) {
  const trigger = options.trigger ?? "schedule";
  const run = createRun(h.db, { categoryId: h.category.id, trigger, slot: trigger === "schedule" ? `slot-${h.clock().toISOString()}` : null }, h.clock);
  h.clock.advance(60_000);
  const done = finishRun(h.db, run.id, {
    status,
    finishedAt: h.clock().toISOString(),
    collected: 0,
    rejected: 0,
    articlesCreated: 0,
    articlesUpdated: 0,
    llmCalls: 0,
    failures: options.failures ?? [],
    stoppedBy: status === "stopped_by_limit" ? "run" : null,
  });
  if (options.retryAt) setRetry(h.db, run.id, { at: options.retryAt });
  return done;
}

/** A search of `topic` in a run of its own, that returned `returned` results, or failed when `returned` is null. */
function searched(
  h: Harness,
  topic: Topic,
  returned: number | null,
  options: { kind?: "news-search" | "llm-search"; engine?: string | null; query?: string; google?: { attempted: number; unresolved: number } } = {},
) {
  const run = finished(h, "succeeded", { trigger: "manual" });
  const kind = options.kind ?? "news-search";
  recordSearchAttempt(h.db, {
    runId: run.id,
    topicId: topic.id,
    kind,
    engine: kind === "llm-search" ? null : (options.engine ?? "bing-news"),
    query: options.query ?? (kind === "llm-search" ? topic.text : topic.queries[0]!),
    ok: returned !== null,
    returned: returned ?? 0,
    googleAttempted: options.google?.attempted ?? 0,
    googleUnresolved: options.google?.unresolved ?? 0,
    createdAt: h.clock().toISOString(),
  });
  return run;
}

const items = (h: Harness, kind?: string) => listAttention(h.db, h.clock()).items.filter((item) => kind === undefined || item.kind === kind);

describe("a category whose scheduled run failed", () => {
  it("is pointed out once its retries are used up", () => {
    const h = pipelineHarness();
    h.addTopic("Topic");
    const run = finished(h, "failed");

    expect(items(h, "run-failed")).toEqual([
      expect.objectContaining({ kind: "run-failed", key: `run:${run.id}`, categoryId: h.category.id, categoryName: "Test", runId: run.id, runStatus: "failed" }),
    ]);
  });

  it("is pointed out when the run stopped at a limit", () => {
    const h = pipelineHarness();
    const run = finished(h, "stopped_by_limit");

    expect(items(h, "run-failed")).toEqual([expect.objectContaining({ runId: run.id, runStatus: "stopped_by_limit" })]);
  });

  it("is not pointed out while a retry is planned", () => {
    const h = pipelineHarness();
    finished(h, "failed", { retryAt: "2026-03-01T13:00:00.000Z" });

    expect(items(h, "run-failed")).toEqual([]);
  });

  it("is not pointed out for a run that partly failed, or for a manual run that failed", () => {
    const h = pipelineHarness();
    finished(h, "partial");
    finished(h, "failed", { trigger: "manual" });

    expect(items(h, "run-failed")).toEqual([]);
  });

  it("is not pointed out once a later run, even a manual one, succeeded or partly failed", () => {
    const h = pipelineHarness();
    finished(h, "stopped_by_limit");
    finished(h, "partial", { trigger: "manual" });

    expect(items(h, "run-failed")).toEqual([]);
  });

  it("is not pointed out when the latest scheduled run is waiting", () => {
    const h = pipelineHarness();
    finished(h, "failed");
    createRun(h.db, { categoryId: h.category.id, trigger: "schedule", slot: "later" }, h.clock);

    expect(items(h, "run-failed")).toEqual([]);
  });

  it("is not pointed out for a disabled category", () => {
    const h = pipelineHarness();
    finished(h, "failed");
    updateCategory(h.db, h.category.id, { enabled: false });

    expect(items(h, "run-failed")).toEqual([]);
  });

  it("comes back after it was dismissed when another scheduled run fails", () => {
    const h = pipelineHarness();
    const first = finished(h, "failed");
    dismissAttention(h.db, `run:${first.id}`, h.clock);
    expect(items(h, "run-failed")).toEqual([]);

    const second = finished(h, "failed");

    expect(items(h, "run-failed")).toEqual([expect.objectContaining({ key: `run:${second.id}` })]);
  });
});

describe("a topic left uninterpreted", () => {
  it("is pointed out when the latest run failed to interpret it", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Broken topic", { interpreted: false });
    const run = finished(h, "partial", { failures: [{ stage: "interpret", target: "Broken topic", message: "model unavailable" }] });

    expect(items(h, "uninterpreted")).toEqual([
      expect.objectContaining({ key: `interpret:${topic.id}:${run.id}`, topicId: topic.id, topicText: "Broken topic", runId: run.id, categoryId: h.category.id }),
    ]);
  });

  it("is not pointed out before any run tried it", () => {
    const h = pipelineHarness();
    finished(h, "succeeded");
    h.addTopic("New topic", { interpreted: false });

    expect(items(h, "uninterpreted")).toEqual([]);
  });

  it("is not pointed out once it is interpreted, or when it is disabled", () => {
    const h = pipelineHarness();
    const disabled = h.addTopic("Disabled topic", { interpreted: false });
    h.addTopic("Fine topic");
    updateTopic(h.db, disabled.id, { enabled: false });
    finished(h, "partial", {
      failures: [
        { stage: "interpret", target: "Disabled topic", message: "x" },
        { stage: "interpret", target: "Fine topic", message: "x" },
      ],
    });

    expect(items(h, "uninterpreted")).toEqual([]);
  });
});

describe("a search that keeps finding nothing", () => {
  it("is pointed out after three searches in a row found nothing", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    searched(h, topic, 4);
    searched(h, topic, 0);
    searched(h, topic, 0);
    searched(h, topic, 0);

    const found = items(h, "empty-search");
    expect(found).toEqual([
      expect.objectContaining({ topicId: topic.id, topicText: "Rust", source: "news-search", engine: "bing-news", query: "rust", categoryId: h.category.id }),
    ]);
    expect(found[0]!.key).toMatch(new RegExp(`^empty:news-search:${topic.id}:bing-news:rust:\\d+$`));
  });

  it("leaves searches that failed out of the count", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    searched(h, topic, 0);
    searched(h, topic, null);
    searched(h, topic, 0);
    searched(h, topic, 0);

    expect(items(h, "empty-search")).toHaveLength(1);
  });

  it("is not pointed out when one of the last three found something, or before three searches", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["rust", "cargo"] });
    searched(h, topic, 0, { query: "rust" });
    searched(h, topic, 2, { query: "rust" });
    searched(h, topic, 0, { query: "rust" });
    searched(h, topic, 0, { query: "cargo" });
    searched(h, topic, 0, { query: "cargo" });

    expect(items(h, "empty-search")).toEqual([]);
  });

  it("counts each engine apart", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    for (let i = 0; i < 3; i++) {
      searched(h, topic, 0, { engine: "bing-news" });
      searched(h, topic, 1, { engine: "google-news" });
    }

    expect(items(h, "empty-search")).toEqual([expect.objectContaining({ engine: "bing-news" })]);
  });

  it("is not pointed out once the query left the topic, or for an engine the server no longer asks", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["old query"] });
    for (let i = 0; i < 3; i++) searched(h, topic, 0, { query: "old query", engine: "google-news" });
    expect(listAttention(h.db, h.clock(), { engines: ["bing-news"] }).items).toEqual([]);

    updateTopic(h.db, topic.id, { queries: ["new query"] });

    expect(items(h, "empty-search")).toEqual([]);
  });

  it("is pointed out for web search by the model, until the topic stops using it", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Topic", { llmSearch: true });
    for (let i = 0; i < 3; i++) searched(h, topic, 0, { kind: "llm-search" });

    expect(items(h, "empty-search")).toEqual([
      expect.objectContaining({ key: expect.stringMatching(new RegExp(`^empty:llm-search:${topic.id}:\\d+$`)), source: "llm-search", engine: null }),
    ]);

    updateTopic(h.db, topic.id, { sources: { llmSearch: false } });

    expect(items(h, "empty-search")).toEqual([]);
  });

  it("stays dismissed while nothing is found, and comes back when nothing is found again after a find", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    for (let i = 0; i < 3; i++) searched(h, topic, 0);
    dismissAttention(h.db, items(h, "empty-search")[0]!.key, h.clock);
    searched(h, topic, 0);
    expect(items(h, "empty-search")).toEqual([]);

    searched(h, topic, 3);
    for (let i = 0; i < 3; i++) searched(h, topic, 0);

    expect(items(h, "empty-search")).toHaveLength(1);
  });
});

describe("a topic without an article for 14 days", () => {
  it("is pointed out when its last article was written more than 14 days ago", async () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "A story", link: "https://example.org/a" }]);
    h.clock.advance(4 * DAY);
    await h.run();
    const last = h.articles()[0]!.updatedAt;
    h.feed(FEED, []);
    h.clock.advance(16 * DAY);

    expect(items(h, "no-adoption")).toEqual([
      expect.objectContaining({ key: `idle:${topic.id}:${last}`, topicId: topic.id, topicText: "Topic", since: last, categoryId: h.category.id }),
    ]);
  });

  it("is pointed out for a topic that never had an article, 14 days after it was made", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Topic");
    h.clock.advance(15 * DAY);

    expect(items(h, "no-adoption")).toEqual([expect.objectContaining({ key: `idle:${topic.id}:${topic.createdAt}`, since: null })]);
  });

  it("is not pointed out for a topic made less than 14 days ago, or one with a recent article", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.clock.advance(5 * DAY);
    expect(items(h, "no-adoption")).toEqual([]);

    h.clock.advance(5 * DAY);
    h.feed(FEED, [{ title: "A story", link: "https://example.org/a" }]);
    await h.run();
    h.clock.advance(10 * DAY);

    expect(items(h, "no-adoption")).toEqual([]);
  });

  it("is not pointed out for a disabled topic or a topic of a disabled category", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Topic");
    h.clock.advance(15 * DAY);
    updateTopic(h.db, topic.id, { enabled: false });
    expect(items(h, "no-adoption")).toEqual([]);

    updateTopic(h.db, topic.id, { enabled: true });
    updateCategory(h.db, h.category.id, { enabled: false });

    expect(items(h, "no-adoption")).toEqual([]);
  });
});

describe("redirect links of Google News that cannot be resolved", () => {
  const google = (attempted: number, unresolved: number) => ({ engine: "google-news", google: { attempted, unresolved } });

  it("are pointed out when three runs in a row with Google News results resolved none", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    searched(h, topic, 3, google(3, 0));
    const start = searched(h, topic, 2, google(2, 2));
    searched(h, topic, 0, google(0, 0));
    searched(h, topic, 1, google(1, 1));
    searched(h, topic, 4, google(4, 4));

    expect(items(h, "google-unresolved")).toEqual([expect.objectContaining({ key: `google:${start.id}`, categoryId: null })]);
  });

  it("are not pointed out when one of the three runs resolved a link", () => {
    const h = pipelineHarness();
    const topic = h.addTopic("Rust", { newsSearch: true, queries: ["rust"] });
    searched(h, topic, 2, google(2, 2));
    searched(h, topic, 3, google(3, 2));
    searched(h, topic, 1, google(1, 1));

    expect(items(h, "google-unresolved")).toEqual([]);
  });
});

describe("the list", () => {
  it("counts the items that were not dismissed", () => {
    const h = pipelineHarness();
    h.addTopic("Topic");
    const run = finished(h, "failed");
    h.clock.advance(15 * DAY);
    expect(listAttention(h.db, h.clock()).count).toBe(2);

    dismissAttention(h.db, `run:${run.id}`, h.clock);
    dismissAttention(h.db, `run:${run.id}`, h.clock);

    expect(listAttention(h.db, h.clock())).toEqual({ items: [expect.objectContaining({ kind: "no-adoption" })], count: 1 });
  });
});
