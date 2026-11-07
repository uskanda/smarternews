import {
  createCategory,
  FeedPoller,
  Fetcher,
  FullContentWorker,
  imageProxyPath,
  ImageCache,
  ImageProxy,
  insertArticle,
  RunQueue,
  LlmTranslator,
  startRun,
  SummaryWorker,
  DigestWorker,
  TranslationService,
  type ArticleContent,
  type Category,
  type Kind,
  type ModelPricing,
  type Translator,
} from "@smarternews/core";
import { createTestDb, fakeClock, fakeFetch, fakeLlm, fakeTranslator, type FakeHandler } from "@smarternews/core/testing";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { TopicTrials } from "./topic-trials.ts";

export const API_TOKEN = "test-api-token-0123456789";
export const FEED_TOKEN = "test-feed-token-0123456789";
/** The key that signs the image URLs of every test server. */
export const IMAGE_KEY = new Uint8Array(32).fill(0x5a);

/** The path under which a test server relays the image at `url`. */
export function relayPath(url: string): string {
  return imageProxyPath(IMAGE_KEY, url);
}

/** A response whose JSON body the tests read without declaring its shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };

/** The app wired to an in-memory database. Runs are started but never finish, so tests can observe them. */
export function testServer(
  start = "2026-03-01T12:00:00.000Z",
  options: {
    webSearch?: boolean;
    summarize?: FakeHandler;
    /** Answers the translate task. Without it, a call of the task fails the test. */
    translate?: FakeHandler;
    /** Stands in for the translation API. Null is a server without a key; left out, every text comes back with a mark in front. */
    google?: (Translator & { calls: Array<{ items: Array<{ text: string; plain?: boolean }>; target: string }> }) | null;
    monthlyChars?: number;
    llmCallsPerDay?: number;
    summariesPerDay?: number;
    /** Answers the task that proposes selectors for a web feed. Without it, a call of the task fails the test. */
    proposeSelectors?: FakeHandler;
    selectorProposalsPerDay?: number;
    /** Answers the digest task. Without it, a call of the task fails the test. */
    digest?: FakeHandler;
    digestsPerDay?: number;
    /** Answer the interpret and judge tasks, which topic trials call. Without them, a call of the task fails the test. */
    interpret?: FakeHandler;
    judge?: FakeHandler;
    topicTrialsPerDay?: number;
    /** Makes every provider one that costs money, at these prices. */
    pricing?: ModelPricing;
    budget?: { monthlyBudgetUsd: number; warnRatio: number; resetDay: number };
  } = {},
) {
  const db = createTestDb();
  const clock = fakeClock(start);
  const llm = fakeLlm(
    db,
    clock,
    {
      ...(options.summarize ? { summarize: options.summarize } : {}),
      ...(options.translate ? { translate: options.translate } : {}),
      ...(options.proposeSelectors ? { proposeSelectors: options.proposeSelectors } : {}),
      ...(options.digest ? { digest: options.digest } : {}),
      ...(options.interpret ? { interpret: options.interpret } : {}),
      ...(options.judge ? { judge: options.judge } : {}),
    },
    {
      webSearch: options.webSearch,
      pricing: options.pricing,
      budget: options.budget,
      ...(options.llmCallsPerDay === undefined &&
      options.summariesPerDay === undefined &&
      options.selectorProposalsPerDay === undefined &&
      options.digestsPerDay === undefined &&
      options.topicTrialsPerDay === undefined
        ? {}
        : {
            limits: {
              llmCallsPerRun: 40,
              llmCallsPerDay: options.llmCallsPerDay ?? 300,
              ...(options.summariesPerDay === undefined ? {} : { summariesPerDay: options.summariesPerDay }),
              ...(options.selectorProposalsPerDay === undefined ? {} : { selectorProposalsPerDay: options.selectorProposalsPerDay }),
              ...(options.digestsPerDay === undefined ? {} : { digestsPerDay: options.digestsPerDay }),
              ...(options.topicTrialsPerDay === undefined ? {} : { topicTrialsPerDay: options.topicTrialsPerDay }),
            },
          }),
    },
  );
  const google = options.google === undefined ? fakeTranslator() : options.google;
  const translation = new TranslationService({
    db,
    clock,
    google,
    llm: new LlmTranslator(llm.runner),
    monthlyChars: options.monthlyChars ?? 450_000,
    maxCharsPerArticle: 20_000,
    log: () => {},
  });
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
  const poller = new FeedPoller({ db, clock, fetcher, translation });
  // Summaries are made when a test tells the worker to look: `summarizer.tick()`, then `summarizer.idle()`.
  // Likewise full content: `fullContent.tick()`, then `fullContent.idle()`. A request through the API waits for it.
  const fullContent = new FullContentWorker({ db, clock, fetcher });
  const summarizer = new SummaryWorker({ db, clock, fetcher, runner: llm.runner, fullContent });
  // Digests are made when a test asks for one: `digests.buildNow()` or `digests.tick()`, then `digests.idle()`.
  const digests = new DigestWorker({ db, clock, runner: llm.runner, log: () => {} });
  // A trial runs on its own once started through the API: `trials.idle()` waits for it.
  const trials = new TopicTrials({ db, clock, runner: llm.runner, judgeBatchSize: 30, log: () => {} });
  // Images come from the same stand-in sites, through a fetcher of their own. Their directory is made only
  // when a test relays an image.
  const imageFetcher = new Fetcher({ userAgent: "test", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 5_000_000, fetchImpl: site.fetchImpl, clock, sleep: async () => {} });
  const imageCache = new ImageCache({ dir: join(tmpdir(), `sn-test-images-${randomUUID()}`), maxBytes: 100_000_000, maxAgeMs: 7 * 86_400_000, clock });
  const images = { key: IMAGE_KEY, proxy: new ImageProxy({ fetcher: imageFetcher, cache: imageCache, log: () => {} }) };
  const app = createApp({
    db,
    clock,
    queue,
    runner: llm.runner,
    fetcher,
    poller,
    translation,
    summarizer,
    fullContent,
    digests,
    trials,
    images,
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
    fullContent,
    digests,
    trials,
    imageKey: IMAGE_KEY,
    /** What the stand-in for the translation API was asked. Null on a server without a key. */
    google,
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
    put: (path: string, body: unknown, token?: string | null) => request("PUT", path, body, token),
    delete: (path: string, token?: string | null) => request("DELETE", path, undefined, token),
    category(name = "Security", kind: Kind = "news"): Category {
      return createCategory(db, { name, kind }, clock);
    },
    /** Stores an article at the current clock time. */
    article(categoryId: number, overrides: Partial<ArticleContent> & { kind?: Kind; refs?: string[]; topicIds?: number[] } = {}): number {
      serial += 1;
      const { kind, refs, topicIds, ...content } = overrides;
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
        topicIds: topicIds ?? [],
      });
    },
  };
}
