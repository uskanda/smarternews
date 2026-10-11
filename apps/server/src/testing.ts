import {
  createCategory,
  FeedPoller,
  Fetcher,
  insertArticle,
  RunQueue,
  startRun,
  SummaryWorker,
  type ArticleContent,
  type Category,
  type Kind,
} from "@smarternews/core";
import { createTestDb, fakeClock, fakeFetch, fakeLlm, type FakeHandler } from "@smarternews/core/testing";
import { createApp } from "./app.ts";

export const API_TOKEN = "test-api-token-0123456789";
export const FEED_TOKEN = "test-feed-token-0123456789";

/** A response whose JSON body the tests read without declaring its shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };

/** The app wired to an in-memory database. Runs are started but never finish, so tests can observe them. */
export function testServer(start = "2026-03-01T12:00:00.000Z", options: { webSearch?: boolean; summarize?: FakeHandler } = {}) {
  const db = createTestDb();
  const clock = fakeClock(start);
  const llm = fakeLlm(db, clock, options.summarize ? { summarize: options.summarize } : {}, { webSearch: options.webSearch });
  const queue = new RunQueue({
    db,
    clock,
    execute: async (runId) => {
      startRun(db, runId, clock().toISOString());
      await new Promise(() => {});
    },
  });
  // Other sites, as the tests define them: `site.set(url, answer)`. Anything else answers 404.
  const routes: Record<string, () => Response> = {};
  const site = fakeFetch(routes, clock);
  const fetcher = new Fetcher({ userAgent: "test", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: site.fetchImpl, clock, sleep: async () => {} });
  const poller = new FeedPoller({ db, clock, fetcher });
  // Summaries are made when a test tells the worker to look: `summarizer.tick()`, then `summarizer.idle()`.
  const summarizer = new SummaryWorker({ db, clock, fetcher, runner: llm.runner });
  const app = createApp({
    db,
    clock,
    queue,
    runner: llm.runner,
    fetcher,
    poller,
    tokens: { api: API_TOKEN, feed: FEED_TOKEN },
    version: "9.9.9",
  });

  const request = (method: string, path: string, body?: unknown, token: string | null = API_TOKEN): Promise<TestResponse> =>
    app.request(path, {
      method,
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "content-type": typeof body === "string" ? "application/yaml" : "application/json" }),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }) as Promise<TestResponse>;

  let serial = 0;
  return {
    app,
    db,
    clock,
    queue,
    poller,
    summarizer,
    llmRequests: llm.requests,
    site: {
      requests: site.requests,
      set(url: string, answer: string | (() => Response)) {
        routes[url] = typeof answer === "string" ? () => new Response(answer, { headers: { "content-type": "application/xml; charset=utf-8" } }) : answer;
      },
    },
    get: (path: string, token?: string | null) => request("GET", path, undefined, token),
    post: (path: string, body?: unknown, token?: string | null) => request("POST", path, body, token),
    patch: (path: string, body: unknown, token?: string | null) => request("PATCH", path, body, token),
    delete: (path: string, token?: string | null) => request("DELETE", path, undefined, token),
    category(name = "Security", kind: Kind = "news"): Category {
      return createCategory(db, { name, kind }, clock);
    },
    /** Stores an article at the current clock time. */
    article(categoryId: number, overrides: Partial<ArticleContent> & { kind?: Kind; refs?: string[] } = {}): number {
      serial += 1;
      const { kind, refs, ...content } = overrides;
      return insertArticle(db, {
        categoryId,
        kind: kind ?? "news",
        title: `Article ${serial}`,
        summary: `Summary ${serial}`,
        body: `Body ${serial}`,
        impact: null,
        importance: 3,
        unconfirmed: false,
        snippetOnly: false,
        event: null,
        ...content,
        now: clock().toISOString(),
        previousArticleId: null,
        refs: (refs ?? [`https://example.org/${serial}`]).map((url) => ({ url, siteName: "Example", title: `Ref ${serial}`, publishedAt: null })),
        topicIds: [],
      });
    },
  };
}
