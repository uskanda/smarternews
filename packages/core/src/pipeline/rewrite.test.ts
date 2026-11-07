import { describe, expect, it } from "vitest";
import { insertArticle, recordArticleOpened, setArticleFlags } from "../db/articles.ts";
import { createCategory } from "../db/categories.ts";
import { updateSettings } from "../db/settings.ts";
import { applyInterpretation, createTopic, getTopic } from "../db/topics.ts";
import { DomainError } from "../errors.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { fakeLlm, type FakeHandler } from "../testing/llm.ts";
import { proposeTopicRewrite } from "./rewrite.ts";

const NOW = "2026-03-20T00:00:00.000Z";
const answer = {
  proposals: [
    { text: "Releases of the Rust compiler, without tutorials", explanation: "チュートリアルを除きます。" },
    { text: "Rust compiler releases and security advisories", explanation: "セキュリティの告知を足します。" },
  ],
};

function setup(options: { handler?: FakeHandler; limits?: { topicRewritesPerDay?: number; llmCallsPerDay?: number }; interpreted?: boolean } = {}) {
  const db = createTestDb();
  const clock = fakeClock(NOW);
  updateSettings(db, { outputLanguage: "ja", readerInfo: "Maintains a Rust library." });
  const category = createCategory(db, { name: "Rust", kind: "news" }, clock);
  const created = createTopic(db, category.id, { text: "Rust releases" }, clock);
  const topic =
    options.interpreted === false
      ? created
      : applyInterpretation(db, created.id, { queries: ["rust"], criteria: "Only releases of the Rust compiler.", suggestedSources: { newsSearch: true, llmSearch: false } });
  const id = insertArticle(db, {
    categoryId: category.id,
    kind: "news",
    title: "Rust 2.0 ships",
    summary: "The compiler reaches 2.0.",
    body: "b",
    impact: null,
    importance: 4,
    unconfirmed: false,
    snippetOnly: false,
    event: null,
    now: "2026-03-18T00:00:00.000Z",
    previousArticleId: null,
    refs: [],
    topicIds: [topic.id],
  });
  recordArticleOpened(db, id, "2026-03-19T00:00:00.000Z");
  setArticleFlags(db, id, { starred: true }, NOW);
  const llm = fakeLlm(db, clock, { proposeTopicRewrite: options.handler ?? (() => answer) }, {
    limits: { llmCallsPerRun: 40, llmCallsPerDay: options.limits?.llmCallsPerDay ?? 300, topicRewritesPerDay: options.limits?.topicRewritesPerDay },
  });
  const calls = () => db.prepare("SELECT task, run_id FROM llm_calls ORDER BY id").all();
  return { db, clock, topic, llm, calls, deps: { db, clock, runner: llm.runner } };
}

describe("proposeTopicRewrite", () => {
  it("asks the model once with the topic, its criteria, the reader and the articles, and gives the proposals", async () => {
    const s = setup();

    await expect(proposeTopicRewrite(s.deps, s.topic.id)).resolves.toEqual({ status: "proposed", proposals: answer.proposals });

    const [request] = s.llm.requests.proposeTopicRewrite;
    expect(s.llm.requests.proposeTopicRewrite).toHaveLength(1);
    expect(request!.prompt).toContain("Rust releases");
    expect(request!.prompt).toContain("Only releases of the Rust compiler.");
    expect(request!.prompt).toContain("Maintains a Rust library.");
    expect(request!.prompt).toContain("Output language: ja");
    expect(request!.prompt).toContain("Rust 2.0 ships");
    expect(s.calls()).toEqual([{ task: "proposeTopicRewrite", run_id: null }]);
  });

  it("stores nothing: the topic stays as it was", async () => {
    const s = setup();
    const before = getTopic(s.db, s.topic.id);

    await proposeTopicRewrite(s.deps, s.topic.id);

    expect(getTopic(s.db, s.topic.id)).toEqual(before);
  });

  it("does not ask the model for a topic that is not interpreted", async () => {
    const s = setup({ interpreted: false });

    await expect(proposeTopicRewrite(s.deps, s.topic.id)).resolves.toEqual({ status: "uninterpreted", proposals: [] });
    expect(s.calls()).toEqual([]);
  });

  it("does not ask the model when its allowance or the day's is used up", async () => {
    const off = setup({ limits: { topicRewritesPerDay: 0 } });
    await expect(proposeTopicRewrite(off.deps, off.topic.id)).resolves.toEqual({ status: "limit", proposals: [] });
    expect(off.calls()).toEqual([]);

    const day = setup({ limits: { llmCallsPerDay: 1 } });
    day.db.prepare("INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, created_at) VALUES (NULL, 'judge', 'judge', 1, 1, ?)").run(NOW);
    await expect(proposeTopicRewrite(day.deps, day.topic.id)).resolves.toEqual({ status: "day", proposals: [] });
  });

  it("says the allowance stopped it when it runs out before the second attempt", async () => {
    const s = setup({ handler: () => ({ proposals: [{ text: "Rust releases", explanation: "Same." }] }), limits: { topicRewritesPerDay: 1 } });

    await expect(proposeTopicRewrite(s.deps, s.topic.id)).resolves.toEqual({ status: "limit", proposals: [] });
    expect(s.calls()).toHaveLength(1);
  });

  it("turns a failed task into an error that says the proposals cannot be had now", async () => {
    const s = setup({ handler: () => ({ proposals: [] }) });

    const error = await proposeTopicRewrite(s.deps, s.topic.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(s.calls()).toHaveLength(2);
  });

  it("refuses a topic that does not exist", async () => {
    const s = setup();
    await expect(proposeTopicRewrite(s.deps, 999)).rejects.toMatchObject({ code: "not_found" });
  });
});
