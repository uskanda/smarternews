import { applyInterpretation, categoryVersionSchema, topicSchema, topicStatsSchema, topicVersionSchema } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const versions = (body: unknown) => topicVersionSchema.array().parse(body);

async function editedTopic() {
  const s = testServer();
  const category = s.category();
  const topic = topicSchema.parse(await (await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Rust" })).json());
  applyInterpretation(s.db, topic.id, { queries: ["rust"], criteria: "A", suggestedSources: { newsSearch: true, llmSearch: false } }, s.clock().toISOString());
  s.clock.advance(86_400_000);
  await s.patch(`/api/v1/topics/${topic.id}`, { text: "Rust compiler" });
  return { s, category, topic };
}

describe("the topic versions API", () => {
  it("lists the versions of a topic, newest first", async () => {
    const { s, topic } = await editedTopic();

    const response = await s.get(`/api/v1/topics/${topic.id}/versions`);

    expect(response.status).toBe(200);
    const body = versions(await response.json());
    expect(body.map((version) => [version.trigger, version.text, version.interpreted])).toEqual([
      ["edited", "Rust compiler", false],
      ["interpreted", "Rust", true],
      ["created", "Rust", false],
    ]);
    expect(body[0]!.createdAt).toBe(s.clock().toISOString());
  });

  it("goes back to a version, answering the topic, without calling a model", async () => {
    const { s, category, topic } = await editedTopic();
    const target = versions(await (await s.get(`/api/v1/topics/${topic.id}/versions`)).json()).find((version) => version.trigger === "interpreted")!;

    const response = await s.post(`/api/v1/topics/${topic.id}/versions/${target.id}/restore`);

    expect(response.status).toBe(200);
    expect(topicSchema.parse(await response.json())).toMatchObject({ text: "Rust", interpreted: true, criteria: "A", sourcesSetByUser: true });
    const after = versions(await (await s.get(`/api/v1/topics/${topic.id}/versions`)).json());
    expect(after[0]).toMatchObject({ trigger: "restored", restoredFrom: target.id });
    const stats = topicStatsSchema.parse(await (await s.get(`/api/v1/categories/${category.id}/topic-stats`)).json());
    expect(stats.topics[0]!.boundary).toEqual({ at: s.clock().toISOString(), trigger: "restored" });
    expect(Object.values(s.llmRequests).flat()).toHaveLength(0);
  });

  it("answers 404 for a version of another topic, one that does not exist, and a topic that does not exist", async () => {
    const { s, category, topic } = await editedTopic();
    const other = topicSchema.parse(await (await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Go" })).json());
    const [own] = versions(await (await s.get(`/api/v1/topics/${topic.id}/versions`)).json());

    expect((await s.post(`/api/v1/topics/${other.id}/versions/${own!.id}/restore`)).status).toBe(404);
    expect((await s.post(`/api/v1/topics/${topic.id}/versions/99999/restore`)).status).toBe(404);
    expect((await s.get("/api/v1/topics/99999/versions")).status).toBe(404);
    expect(topicSchema.parse(await (await s.get(`/api/v1/topics/${other.id}`)).json()).text).toBe("Go");
  });
});

describe("the category versions API", () => {
  it("lists the minimum importance and the limit of articles each time they changed, newest first", async () => {
    const s = testServer();
    const category = s.category();
    s.clock.advance(60_000);
    await s.patch(`/api/v1/categories/${category.id}`, { minImportance: 4 });
    await s.patch(`/api/v1/categories/${category.id}`, { name: "Renamed" });

    const response = await s.get(`/api/v1/categories/${category.id}/versions`);

    expect(response.status).toBe(200);
    const body = categoryVersionSchema.array().parse(await response.json());
    expect(body.map((version) => [version.trigger, version.minImportance, version.maxArticlesPerRun, version.createdAt])).toEqual([
      ["edited", 4, 5, s.clock().toISOString()],
      ["created", 3, 5, category.createdAt],
    ]);
  });

  it("answers 404 for a category that does not exist", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/categories/999/versions")).status).toBe(404);
  });
});
