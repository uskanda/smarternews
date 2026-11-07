import { createRun, insertCandidate, topicStatsSchema } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

describe("the topic stats API", () => {
  it("answers with the stats of every topic of the category, without calling a model", async () => {
    const s = testServer();
    const category = s.category();
    const topic = await (await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Exploited bugs" })).json();
    const quiet = await (await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Quiet" })).json();
    const run = createRun(s.db, { categoryId: category.id, trigger: "manual", slot: null }, s.clock);
    insertCandidate(s.db, {
      categoryId: category.id,
      runId: run.id,
      url: "https://example.org/ad",
      fetchable: true,
      title: "Buy now",
      snippet: "",
      siteName: "Ads",
      publishedAt: null,
      sourceKind: "news-search",
      status: "rejected",
      reason: "advertising",
      reasonCode: null,
      importance: 1,
      topicIds: [topic.id],
      now: s.clock().toISOString(),
    });
    s.article(category.id, { topicIds: [topic.id] });

    const response = await s.get(`/api/v1/categories/${category.id}/topic-stats`);

    expect(response.status).toBe(200);
    const body = topicStatsSchema.parse(await response.json());
    expect(body.topics.map((entry) => entry.topicId)).toEqual([topic.id, quiet.id]);
    expect(body.topics[0]).toMatchObject({
      collected: { total: 1, bySource: { feed: 0, "news-search": 1, "llm-search": 0 } },
      rejectedByJudge: 1,
      created: 1,
      topRejectedSites: [{ siteName: "Ads", count: 1 }],
    });
    expect(Object.values(s.llmRequests).flat()).toHaveLength(0);
  });

  it("answers 404 for a category that does not exist", async () => {
    const s = testServer();
    const response = await s.get("/api/v1/categories/999/topic-stats");
    expect(response.status).toBe(404);
  });
});
