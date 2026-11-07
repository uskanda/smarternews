import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { insertCandidate, listTrialCandidates, rejectCandidates } from "./candidates.ts";
import { createCategory } from "./categories.ts";
import { createRun } from "./runs.ts";
import { createTopic } from "./topics.ts";

const clock = fakeClock("2026-03-10T00:00:00.000Z");

function setup() {
  const db = createTestDb();
  const category = createCategory(db, { name: "Rust", kind: "news" }, clock);
  const topic = createTopic(db, category.id, { text: "Rust releases" }, clock);
  const other = createTopic(db, category.id, { text: "Go releases" }, clock);
  const run = createRun(db, { categoryId: category.id, trigger: "manual", slot: null }, clock);
  let day = 0;
  const add = (status: "pending" | "rejected", reason: string, options: { topicIds?: number[]; publishedAt?: string | null } = {}) => {
    day += 1;
    return insertCandidate(db, {
      categoryId: category.id,
      runId: run.id,
      url: `https://example.org/${day}`,
      fetchable: true,
      title: `Story ${day}`,
      snippet: `About story ${day}`,
      siteName: "Example",
      publishedAt: options.publishedAt === undefined ? `2026-03-0${Math.min(day, 9)}T00:00:00.000Z` : options.publishedAt,
      sourceKind: "feed",
      status,
      reason,
      importance: status === "pending" ? 3 : 1,
      topicIds: options.topicIds ?? [topic.id],
      now: new Date(Date.parse("2026-03-01T00:00:00.000Z") + day * 3_600_000).toISOString(),
    });
  };
  return { db, topic, other, run, add };
}

describe("listTrialCandidates", () => {
  it("takes the newest of each side of the judge's verdict, and fills a short side from the other", () => {
    const s = setup();
    const accepted = [s.add("pending", "relevant"), s.add("pending", "relevant")];
    const rejected = [s.add("rejected", "advertising"), s.add("rejected", "old news"), s.add("rejected", "off topic"), s.add("rejected", "duplicate")];

    const two = listTrialCandidates(s.db, s.topic.id, 2);
    expect(two.map((candidate) => candidate.id).sort()).toEqual([...accepted, rejected[2]!, rejected[3]!].sort());

    const three = listTrialCandidates(s.db, s.topic.id, 3);
    // Only two accepted ones: the rejected side fills the sixth place with its next newest.
    expect(three.map((candidate) => candidate.id).sort()).toEqual([...accepted, ...rejected].sort());
    expect(three.filter((candidate) => candidate.verdict === "accepted")).toHaveLength(2);
  });

  it("leaves out candidates rejected for an unknown publication time, and those of other topics", () => {
    const s = setup();
    s.add("rejected", "公開日時が不明", { publishedAt: null });
    s.add("rejected", "publication time unknown", { publishedAt: null });
    s.add("pending", "relevant", { topicIds: [s.other.id] });
    const kept = s.add("rejected", "off topic", { topicIds: [s.topic.id, s.other.id] });

    const candidates = listTrialCandidates(s.db, s.topic.id, 30);
    expect(candidates.map((candidate) => candidate.id)).toEqual([kept]);
    expect(candidates[0]!.topicIds).toEqual([s.topic.id, s.other.id]);
  });

  it("counts a candidate the program rejected after the judge accepted it on the accepted side", () => {
    const s = setup();
    const below = s.add("pending", "relevant");
    rejectCandidates(s.db, [below], "重要度が基準未満", s.run.id);
    const over = s.add("pending", "relevant");
    rejectCandidates(s.db, [over], "over the article limit of the run", s.run.id);
    const judged = s.add("rejected", "advertising");

    const byId = new Map(listTrialCandidates(s.db, s.topic.id, 30).map((candidate) => [candidate.id, candidate]));
    expect(byId.get(below)).toMatchObject({ verdict: "accepted", programReason: "below-minimum", status: "rejected" });
    expect(byId.get(over)).toMatchObject({ verdict: "accepted", programReason: "over-limit" });
    expect(byId.get(judged)).toMatchObject({ verdict: "rejected", programReason: null, reason: "advertising" });
  });
});
