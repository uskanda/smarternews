import { blockedSiteSchema, createRun, insertCandidate, siteStatsSchema } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

describe("the site stats API", () => {
  it("answers with the sites of the category's candidates and its blocked sites, without calling a model", async () => {
    const s = testServer();
    const category = s.category();
    const run = createRun(s.db, { categoryId: category.id, trigger: "manual", slot: null }, s.clock);
    for (const url of ["https://www.example.org/a", "https://example.org/b", "https://news.example.net/c"]) {
      insertCandidate(s.db, {
        categoryId: category.id,
        runId: run.id,
        url,
        fetchable: true,
        title: "Story",
        snippet: "",
        siteName: "Example",
        publishedAt: null,
        sourceKind: "feed",
        status: "rejected",
        reason: "why",
        reasonCode: null,
        importance: 1,
        topicIds: [],
        now: s.clock().toISOString(),
      });
    }
    await s.put(`/api/v1/categories/${category.id}/blocked-sites/news.example.net`, {});

    const response = await s.get(`/api/v1/categories/${category.id}/site-stats`);

    expect(response.status).toBe(200);
    const body = siteStatsSchema.parse(await response.json());
    expect(body.sites.map((site) => [site.host, site.candidates, site.blocked])).toEqual([
      ["example.org", 2, false],
      ["news.example.net", 1, true],
    ]);
    expect(body.blocked.map((site) => site.host)).toEqual(["news.example.net"]);
    expect(Object.values(s.llmRequests).flat()).toHaveLength(0);
  });

  it("blocks a site by its host in the form of a candidate's, and stops blocking it", async () => {
    const s = testServer();
    const category = s.category();

    const blocked = await s.put(`/api/v1/categories/${category.id}/blocked-sites/WWW.Example.org`, {});
    expect(blocked.status).toBe(200);
    expect(blockedSiteSchema.parse(await blocked.json())).toEqual({ host: "example.org", blockedAt: s.clock().toISOString() });

    const removed = await s.delete(`/api/v1/categories/${category.id}/blocked-sites/example.org`);
    expect(removed.status).toBe(204);
    const stats = siteStatsSchema.parse(await (await s.get(`/api/v1/categories/${category.id}/site-stats`)).json());
    expect(stats.blocked).toEqual([]);
  });

  it("answers 400 for what is not a host, and 404 for a category or a blocked site that does not exist", async () => {
    const s = testServer();
    const category = s.category();

    expect((await s.put(`/api/v1/categories/${category.id}/blocked-sites/a%20b`, {})).status).toBe(400);
    expect((await s.put("/api/v1/categories/999/blocked-sites/example.org", {})).status).toBe(404);
    expect((await s.delete(`/api/v1/categories/${category.id}/blocked-sites/example.org`)).status).toBe(404);
    expect((await s.get("/api/v1/categories/999/site-stats")).status).toBe(404);
  });
});
