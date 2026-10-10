import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { fakeFetch, html } from "../testing/http.ts";
import { fakeLlm } from "../testing/llm.ts";
import { collectLlmSearch } from "./llm-search.ts";

const dated = (date: string, title = "Page") =>
  html(`<html><head><title>${title}</title><meta property="article:published_time" content="${date}"></head><body><p>text</p></body></html>`);
const undated = (title = "Page") => html(`<html><head><title>${title}</title></head><body><p>text</p></body></html>`);

const now = new Date("2026-03-01T12:00:00Z");
const newsInput = {
  topicText: "Maker fairs",
  criteria: "c",
  kind: "news" as const,
  windowHours: 24,
  windowDays: null,
  now,
  since: new Date("2026-02-28T12:00:00Z"),
};

function setup(results: Array<{ url: string; title: string; snippet: string }>, routes: Parameters<typeof fakeFetch>[0]) {
  const db = createTestDb();
  const clock = fakeClock(now.toISOString());
  const llm = fakeLlm(db, clock, { search: () => ({ results }) });
  const fake = fakeFetch(routes);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 100000, fetchImpl: fake.fetchImpl });
  const pages = new PageFetcher(fetcher, { pagesPerRun: 20 });
  return { deps: { runner: llm.runner, budget: { runId: null, calls: 0 }, pages }, llm, ...fake };
}

const result = (path: string) => ({ url: `https://example.org/${path}`, title: `Result ${path}`, snippet: `About ${path}` });

describe("collectLlmSearch", () => {
  it("turns the pages it could fetch into candidates", async () => {
    const { deps } = setup([result("a"), result("b"), result("gone")], {
      "https://example.org/a": () => dated("2026-03-01T06:00:00Z"),
      "https://example.org/b": () => dated("2026-03-01T07:00:00Z"),
    });
    const candidates = await collectLlmSearch(deps, newsInput);
    expect(candidates.map((candidate) => candidate.url)).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(candidates[0]).toEqual({
      url: "https://example.org/a",
      aliases: [],
      fetchable: true,
      title: "Result a",
      snippet: "About a",
      siteName: "example.org",
      publishedAt: new Date("2026-03-01T06:00:00Z"),
      sourceKind: "llm-search",
    });
  });

  it("drops a news page whose publication time cannot be read from the page", async () => {
    const { deps } = setup([result("a"), result("undated")], {
      "https://example.org/a": () => dated("2026-03-01T06:00:00Z"),
      "https://example.org/undated": () => undated(),
    });
    const candidates = await collectLlmSearch(deps, newsInput);
    expect(candidates.map((candidate) => candidate.url)).toEqual(["https://example.org/a"]);
  });

  it("drops a news page published before the window", async () => {
    const { deps } = setup([result("old")], { "https://example.org/old": () => dated("2026-02-20T06:00:00Z") });
    await expect(collectLlmSearch(deps, newsInput)).resolves.toEqual([]);
  });

  it("keeps an event page that states no publication time", async () => {
    const { deps } = setup([result("fair")], { "https://example.org/fair": () => undated() });
    const candidates = await collectLlmSearch(deps, { ...newsInput, kind: "event", windowHours: null, windowDays: 7, since: null });
    expect(candidates).toMatchObject([{ url: "https://example.org/fair", publishedAt: null }]);
  });

  it("hands the topic, the criteria and the window to the search task", async () => {
    const { deps, llm } = setup([], {});
    await collectLlmSearch(deps, newsInput);
    const prompt = llm.requests.search[0]!.prompt;
    expect(prompt).toContain("Maker fairs");
    expect(prompt).toContain("last 24 hours");
    expect(llm.requests.search[0]!.webSearch).toBe(true);
  });

  it("lists a page once when the task returns it twice", async () => {
    const { deps } = setup([result("a"), { ...result("a"), url: "https://example.org/a?utm_source=x" }], {
      "https://example.org/a": () => dated("2026-03-01T06:00:00Z"),
    });
    await expect(collectLlmSearch(deps, newsInput)).resolves.toHaveLength(1);
  });
});
