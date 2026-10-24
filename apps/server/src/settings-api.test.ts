import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { API_TOKEN, FEED_TOKEN, testServer } from "./testing.ts";

describe("categories", () => {
  it("creates a category with defaults and lists it", async () => {
    const s = testServer();
    const created = await s.post("/api/v1/categories", { name: "Security", kind: "news" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ slug: "security", schedule: ["05:00"], minImportance: 3, maxArticlesPerRun: 5, windowHours: 24 });
    expect(await (await s.get("/api/v1/categories")).json()).toHaveLength(1);
  });

  it("answers 400 with the field and the reason for a value out of range, and changes nothing", async () => {
    const s = testServer();
    const category = s.category();
    const response = await s.patch(`/api/v1/categories/${category.id}`, { minImportance: 9, name: "Renamed" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_input");
    expect(body.error.fields).toEqual([{ path: "minImportance", message: expect.stringMatching(/5/) }]);
    expect((await (await s.get(`/api/v1/categories/${category.id}`)).json()).name).toBe("Security");
  });

  it("answers 409 for a slug that is taken", async () => {
    const s = testServer();
    await s.post("/api/v1/categories", { name: "Security", slug: "security", kind: "news" });
    const response = await s.post("/api/v1/categories", { name: "Other", slug: "security", kind: "news" });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("conflict");
  });

  it("answers 400 for the reserved kind and says it is not available yet", async () => {
    const s = testServer();
    const response = await s.post("/api/v1/categories", { name: "Weather", kind: "status" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("not available yet");
  });

  it("deletes a category together with its articles", async () => {
    const s = testServer();
    const category = s.category();
    for (let index = 0; index < 3; index += 1) s.article(category.id);

    expect((await s.delete(`/api/v1/categories/${category.id}`)).status).toBe(204);

    expect((await (await s.get("/api/v1/articles")).json()).items).toEqual([]);
    expect((await s.get(`/api/v1/categories/${category.id}`)).status).toBe(404);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const s = testServer();
    const response = await s.app.request("/api/v1/categories", {
      method: "POST",
      headers: { authorization: `Bearer ${API_TOKEN}`, "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("topics", () => {
  it("adds a topic and lists it with its interpretation state and sources", async () => {
    const s = testServer();
    const category = s.category();
    const created = await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Exploited vulnerabilities" });
    expect(created.status).toBe(201);

    const topics = await (await s.get(`/api/v1/categories/${category.id}/topics`)).json();

    expect(topics).toMatchObject([
      { text: "Exploited vulnerabilities", enabled: true, interpreted: false, sources: { feeds: [], newsSearch: false, llmSearch: false } },
    ]);
  });

  it("changes a topic's sources and search queries", async () => {
    const s = testServer();
    const category = s.category();
    const topic = await (await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Rust" })).json();

    const updated = await (
      await s.patch(`/api/v1/topics/${topic.id}`, { sources: { feeds: ["https://example.org/feed.xml"], llmSearch: true }, queries: ["rust release"] })
    ).json();

    expect(updated).toMatchObject({
      queries: ["rust release"],
      sources: { feeds: ["https://example.org/feed.xml"], newsSearch: false, llmSearch: true },
      sourcesSetByUser: true,
    });
  });

  it("asks for a new interpretation on request", async () => {
    const s = testServer();
    const category = s.category();
    const topic = await (
      await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Rust", interpretation: { queries: ["rust"], criteria: "c" } })
    ).json();
    expect(topic.interpreted).toBe(true);

    const response = await s.post(`/api/v1/topics/${topic.id}/interpret`);

    expect((await response.json()).interpreted).toBe(false);
  });

  it("refuses a feed address that is not a web address", async () => {
    const s = testServer();
    const category = s.category();
    const response = await s.post(`/api/v1/categories/${category.id}/topics`, { text: "x", sources: { feeds: ["file:///etc/passwd"] } });
    expect(response.status).toBe(400);
  });

  it("answers 404 for a topic or category that does not exist", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/topics/77")).status).toBe(404);
    expect((await s.post("/api/v1/categories/77/topics", { text: "x" })).status).toBe(404);
    expect((await s.delete("/api/v1/topics/77")).status).toBe(404);
  });

  it("deletes a topic", async () => {
    const s = testServer();
    const category = s.category();
    const topic = await (await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Rust" })).json();
    expect((await s.delete(`/api/v1/topics/${topic.id}`)).status).toBe(204);
    expect(await (await s.get(`/api/v1/categories/${category.id}/topics`)).json()).toEqual([]);
  });
});

describe("settings", () => {
  it("reads and changes the reader information and the global settings", async () => {
    const s = testServer();
    const changed = await s.patch("/api/v1/settings", { readerInfo: "Maintains web services.", outputLanguage: "en" });
    expect(changed.status).toBe(200);
    expect(await (await s.get("/api/v1/settings")).json()).toMatchObject({
      readerInfo: "Maintains web services.",
      outputLanguage: "en",
      search: { language: "ja", region: "JP" },
    });
  });

  it("reads and changes duplicate removal, on by default", async () => {
    const s = testServer();
    expect((await (await s.get("/api/v1/settings")).json()).removeDuplicates).toBe(true);
    expect((await (await s.patch("/api/v1/settings", { removeDuplicates: false })).json()).removeDuplicates).toBe(false);
    expect((await (await s.get("/api/v1/settings")).json()).removeDuplicates).toBe(false);
  });

  it("answers 400 for an unknown time zone and keeps the stored settings", async () => {
    const s = testServer();
    await s.patch("/api/v1/settings", { timeZone: "Asia/Tokyo" });
    const response = await s.patch("/api/v1/settings", { timeZone: "Mars/Olympus" });
    expect(response.status).toBe(400);
    expect((await (await s.get("/api/v1/settings")).json()).timeZone).toBe("Asia/Tokyo");
  });
});

describe("settings file", () => {
  it("exports the settings as YAML without any token", async () => {
    const s = testServer();
    const category = s.category();
    await s.post(`/api/v1/categories/${category.id}/topics`, { text: "Exploited vulnerabilities" });

    const response = await s.get("/api/v1/settings/export");

    expect(response.headers.get("content-type")).toContain("yaml");
    const text = await response.text();
    expect(parse(text)).toMatchObject({ version: 1, categories: [{ slug: "security", topics: [{ text: "Exploited vulnerabilities" }] }] });
    expect(text).not.toContain(API_TOKEN);
    expect(text).not.toContain(FEED_TOKEN);
  });

  it("imports a settings file and reports what changed", async () => {
    const s = testServer();
    const response = await s.post(
      "/api/v1/settings/import",
      "version: 1\ncategories:\n  - slug: cars\n    name: Cars\n    kind: news\n    topics:\n      - text: New models\n",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ categoriesCreated: 1, categoriesUpdated: 0, topicsCreated: 1, topicsUpdated: 0, feedsCreated: 0, feedsUpdated: 0, filtersCreated: 0 });
    expect((await (await s.get("/api/v1/categories")).json())[0].slug).toBe("cars");
  });

  it("answers 400 and names the bad entry of an invalid settings file", async () => {
    const s = testServer();
    const response = await s.post("/api/v1/settings/import", "version: 1\ncategories:\n  - slug: a\n    name: A\n    kind: weather\n");
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields[0].path).toBe("categories.0.kind");
    expect(await (await s.get("/api/v1/categories")).json()).toEqual([]);
  });
});

describe("providers", () => {
  it("shows which provider runs each of the tasks, and no credentials", async () => {
    const s = testServer();
    const body = await (await s.get("/api/v1/providers")).json();
    expect(Object.keys(body.tasks).sort()).toEqual(["cluster", "interpret", "judge", "search", "summarize", "translate", "write"]);
    expect(body.providers[0]).toEqual({ name: "interpret", adapter: "fake", model: "fake", webSearch: true });
    expect(body).toMatchObject({ llmCallsToday: 0, summariesToday: 0, limits: { llmCallsPerRun: 40, llmCallsPerDay: 300, summariesPerDay: 100 } });
    expect(JSON.stringify(body)).not.toMatch(/key|token|secret/i);
  });
});
