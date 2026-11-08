import { describe, expect, it } from "vitest";
import { insertArticle } from "../db/articles.ts";
import { createCategory } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import { getDigest, listDigests } from "../db/digests.ts";
import { updateSettings } from "../db/settings.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { fakeLlm, materialLines, type FakeHandler } from "../testing/llm.ts";
import { DigestWorker, makeDigest } from "./worker.ts";

const HOUR = 3_600_000;

function generated(db: Database, categoryId: number, at: string, importance = 3): number {
  return insertArticle(db, {
    categoryId,
    kind: "news",
    title: `Generated ${importance}`,
    summary: "The summary.",
    body: "b",
    impact: null,
    importance,
    unconfirmed: false,
    snippetOnly: false,
    event: null,
    now: at,
    previousArticleId: null,
    refs: [],
    topicIds: [],
  });
}

/** Answers with one line for each listed category, drawn from every article of it and from id 9999. */
const answerAll: FakeHandler = (request) => {
  const categories = materialLines<{ id: number }>(request.prompt, 0);
  const articles = materialLines<{ id: number; categoryId: number | null }>(request.prompt, 1);
  return {
    executiveSummary: "What happened.",
    // Written in the reverse order, to see the server put the sections in the order of the categories.
    sections: [...categories].reverse().map((category) => ({
      categoryId: category.id,
      lines: [{ text: `On ${category.id}.`, articleIds: [...articles.filter((a) => a.categoryId === category.id).map((a) => a.id), 9999] }],
    })),
  };
};

function setup(options: { start?: string; handler?: FakeHandler; digestsPerDay?: number; timeZone?: string } = {}) {
  const db = createTestDb();
  const clock = fakeClock(options.start ?? "2026-03-01T06:00:00.000Z");
  updateSettings(db, { timeZone: options.timeZone ?? "UTC" });
  const llm = fakeLlm(db, clock, { digest: options.handler ?? answerAll }, {
    limits: { llmCallsPerRun: 40, llmCallsPerDay: 300, digestsPerDay: options.digestsPerDay ?? 4 },
  });
  const logged: unknown[] = [];
  const deps = { db, clock, runner: llm.runner, log: (_: string, error: unknown) => logged.push(error) };
  const worker = new DigestWorker(deps);
  const first = createCategory(db, { slug: "first", name: "First", kind: "news" }, clock).id;
  const second = createCategory(db, { slug: "second", name: "Second", kind: "news" }, clock).id;
  const calls = () => db.prepare("SELECT task, ok FROM llm_calls ORDER BY id").all();
  return { db, clock, worker, deps, llm, first, second, calls, logged };
}

describe("makeDigest", () => {
  it("makes one call for every category, keeps the ids it was given, and orders the sections as the categories", async () => {
    const s = setup();
    const third = createCategory(s.db, { slug: "third", name: "Third", kind: "news" }, s.clock).id;
    const a = generated(s.db, s.first, "2026-03-01T05:00:00.000Z", 5);
    const b = generated(s.db, s.second, "2026-03-01T05:00:00.000Z");
    const c = generated(s.db, third, "2026-03-01T05:00:00.000Z");

    const outcome = await makeDigest(s.deps, { trigger: "manual", slot: null });

    expect(s.llm.requests.digest).toHaveLength(1);
    expect(outcome).toMatchObject({ status: "created" });
    const digest = getDigest(s.db, (outcome as { id: number }).id);
    expect(digest.sections.map((section) => section.categoryName)).toEqual(["First", "Second", "Third"]);
    expect(digest.sections.map((section) => section.lines[0]!.articleIds)).toEqual([[a], [b], [c]]);
    expect(digest).toMatchObject({ trigger: "manual", articleCount: 3, executiveSummary: "What happened." });
  });

  it("gives feed articles of a feed without a category to the executive summary only", async () => {
    const s = setup();
    const loose = seedFeedArticle(s.db, seedFeed(s.db), { at: "2026-03-01T05:00:00.000Z", storedAt: "2026-03-01T05:00:00.000Z" });

    const outcome = await makeDigest(s.deps, { trigger: "manual", slot: null });

    const prompt = s.llm.requests.digest[0]!.prompt;
    expect(materialLines(prompt, 0)).toEqual([]);
    expect(materialLines(prompt, 1)).toMatchObject([{ id: loose, categoryId: null }]);
    expect(getDigest(s.db, (outcome as { id: number }).id).sections).toEqual([]);
  });

  it("does not call the model for a period without articles", async () => {
    const s = setup();
    expect(await makeDigest(s.deps, { trigger: "manual", slot: null })).toEqual({ status: "empty" });
    expect(s.llm.requests.digest).toHaveLength(0);
    expect(listDigests(s.db)).toEqual([]);
  });

  it("records a failed digest with its calls, stores nothing, and counts the next period from the last success", async () => {
    const s = setup({ handler: () => ({ nonsense: true }) });
    generated(s.db, s.first, "2026-03-01T05:00:00.000Z");

    expect(await makeDigest(s.deps, { trigger: "manual", slot: null })).toEqual({ status: "failed" });
    expect(s.calls()).toEqual([
      { task: "digest", ok: 0 },
      { task: "digest", ok: 0 },
    ]);
    expect(listDigests(s.db)).toEqual([]);
  });

  it("does not call the model once the day used its digests", async () => {
    const s = setup({ digestsPerDay: 1 });
    generated(s.db, s.first, "2026-03-01T05:00:00.000Z");
    await makeDigest(s.deps, { trigger: "manual", slot: null });
    s.clock.advance(HOUR);
    generated(s.db, s.first, "2026-03-01T06:30:00.000Z");

    expect(await makeDigest(s.deps, { trigger: "manual", slot: null })).toEqual({ status: "limit" });
    expect(s.llm.requests.digest).toHaveLength(1);
  });
});

describe("DigestWorker at the scheduled times", () => {
  it("makes one digest when 7:00 comes, for that time, and none again at the next check", async () => {
    const s = setup({ start: "2026-03-01T06:59:00.000Z" });
    generated(s.db, s.first, "2026-03-01T06:00:00.000Z");
    s.worker.begin({ catchUp: false });
    s.clock.set("2026-03-01T07:00:10.000Z");
    s.worker.tick();
    await s.worker.idle();
    s.clock.set("2026-03-01T07:00:40.000Z");
    s.worker.tick();
    await s.worker.idle();

    const digests = listDigests(s.db);
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({ trigger: "schedule" });
    expect(s.db.prepare("SELECT slot FROM digests").get()).toEqual({ slot: "2026-03-01T07:00" });
  });

  it("reads the times in the time zone of the settings", async () => {
    const s = setup({ start: "2026-02-28T21:59:00.000Z", timeZone: "Asia/Tokyo" });
    generated(s.db, s.first, "2026-02-28T21:00:00.000Z");
    s.worker.begin({ catchUp: false });
    s.clock.set("2026-02-28T22:00:10.000Z");
    s.worker.tick();
    await s.worker.idle();

    expect(s.db.prepare("SELECT slot FROM digests").get()).toEqual({ slot: "2026-03-01T07:00" });
  });

  it("makes none in a day when the list is empty", async () => {
    const s = setup({ start: "2026-03-01T00:00:00.000Z" });
    updateSettings(s.db, { digestSchedule: [] });
    generated(s.db, s.first, "2026-03-01T00:00:00.000Z");
    s.worker.begin({ catchUp: false });
    for (let hour = 1; hour <= 24; hour += 1) {
      s.clock.advance(HOUR);
      s.worker.tick();
    }
    await s.worker.idle();
    expect(s.llm.requests.digest).toHaveLength(0);
  });
});

describe("DigestWorker at start-up", () => {
  const startAt = async (now: string, schedule: string[]) => {
    const s = setup({ start: now });
    updateSettings(s.db, { digestSchedule: schedule });
    generated(s.db, s.first, new Date(new Date(now).getTime() - HOUR).toISOString());
    s.worker.begin({ catchUp: true });
    s.worker.tick();
    await s.worker.idle();
    return s;
  };

  it("makes up for a time missed two hours ago, as a catch-up", async () => {
    const s = await startAt("2026-03-01T08:30:00.000Z", ["07:00"]);
    expect(listDigests(s.db)).toMatchObject([{ trigger: "catch-up" }]);
  });

  it("makes up for the latest missed time only after a long stop", async () => {
    const s = await startAt("2026-03-01T12:00:00.000Z", ["07:00", "19:00"]);
    expect(s.llm.requests.digest).toHaveLength(1);
    expect(s.db.prepare("SELECT slot FROM digests").all()).toEqual([{ slot: "2026-03-01T07:00" }]);
  });

  it("does not make up for a time more than six hours ago", async () => {
    const s = await startAt("2026-03-01T14:00:00.000Z", ["07:00"]);
    expect(s.llm.requests.digest).toHaveLength(0);
  });
});

describe("DigestWorker.buildNow", () => {
  it("starts a digest even when the list of times is empty, and says busy while it is made", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const s = setup({
      handler: async (request) => {
        await gate;
        return answerAll(request);
      },
    });
    updateSettings(s.db, { digestSchedule: [] });
    generated(s.db, s.first, "2026-03-01T05:00:00.000Z");

    expect(s.worker.buildNow()).toBe("queued");
    expect(s.worker.building).toBe(true);
    expect(s.worker.buildNow()).toBe("busy");
    release();
    await s.worker.idle();
    expect(s.worker.building).toBe(false);
    expect(listDigests(s.db)).toMatchObject([{ trigger: "manual" }]);
  });

  it("says empty without a call when the period holds no article, and limit once the day used its digests", () => {
    const s = setup({ digestsPerDay: 0 });
    expect(s.worker.buildNow()).toBe("empty");
    generated(s.db, s.first, "2026-03-01T05:00:00.000Z");
    expect(s.worker.buildNow()).toBe("limit");
    expect(s.llm.requests.digest).toHaveLength(0);
  });
});
