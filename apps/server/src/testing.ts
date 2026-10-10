import {
  createCategory,
  insertArticle,
  RunQueue,
  startRun,
  type ArticleContent,
  type Category,
  type Kind,
} from "@smarternews/core";
import { createTestDb, fakeClock, fakeLlm } from "@smarternews/core/testing";
import { createApp } from "./app.ts";

export const API_TOKEN = "test-api-token-0123456789";
export const FEED_TOKEN = "test-feed-token-0123456789";

/** A response whose JSON body the tests read without declaring its shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };

/** The app wired to an in-memory database. Runs are started but never finish, so tests can observe them. */
export function testServer(start = "2026-03-01T12:00:00.000Z") {
  const db = createTestDb();
  const clock = fakeClock(start);
  const llm = fakeLlm(db, clock, {});
  const queue = new RunQueue({
    db,
    clock,
    execute: async (runId) => {
      startRun(db, runId, clock().toISOString());
      await new Promise(() => {});
    },
  });
  const app = createApp({ db, clock, queue, runner: llm.runner, tokens: { api: API_TOKEN, feed: FEED_TOKEN }, version: "9.9.9" });

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
