import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProviders,
  CATCH_UP_MS,
  defaultUserAgent,
  executeRun,
  FeedPoller,
  Fetcher,
  FullContentWorker,
  getSettings,
  GoogleTranslator,
  IMAGE_MAX_BYTES,
  ImageCache,
  ImageProxy,
  LlmTranslator,
  migrate,
  openDatabase,
  buildPendingFilterMatches,
  parseConfig,
  recoverInterruptedRuns,
  resolveAssignment,
  resolvePaths,
  RunQueue,
  Scheduler,
  SummaryWorker,
  systemClock,
  TaskRunner,
  translationApiKey,
  TranslationService,
  type Clock,
  type Config,
  type Database,
  type FetcherOptions,
  type Paths,
} from "@smarternews/core";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { ensureKey, ensureToken } from "./tokens.ts";

export interface Runtime {
  paths: Paths;
  config: Config;
  db: Database;
  queue: RunQueue;
  scheduler: Scheduler;
  /** Fetches the subscribed feeds that are due. Started together with the scheduler. */
  poller: FeedPoller;
  /** Summarises the feed articles that wait, apart from the fetching of feeds. */
  summarizer: SummaryWorker;
  /** Fetches the full content of feed articles, apart from the fetching of feeds and from the summaries. */
  fullContent: FullContentWorker;
  app: Hono;
  /** Token files this call created, to be announced once. */
  newTokenFiles: string[];
  /** The key file of image URLs, when this call created it, to be announced once. Its content is never shown. */
  newKeyFiles: string[];
  /**
   * Settles what an earlier stop left behind, before anything is started: a run that was in progress is closed
   * as failed, and the runs that were waiting are put back in line. Says how many of each there were.
   */
  recover(): { closed: number; resumed: number };
  /** Starts the scheduler, the fetching of feeds, the full content and the summaries. */
  start(): void;
  close(): void;
}

export function productVersion(): string {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8")) as { version: string };
  return manifest.version;
}

const DAY = 86_400_000;

/**
 * The fetcher of the crawl, which also reads feeds and pages and talks to the translation API, and the one of
 * the image relay. They are apart so that images neither wait the interval per host nor make the crawl wait;
 * the relay keeps its own limit of fetches per host. `overrides` replace the network in tests.
 */
export function buildFetchers(
  config: Config,
  version: string,
  overrides: Pick<FetcherOptions, "fetchImpl" | "clock" | "sleep"> = {},
): { crawl: Fetcher; images: Fetcher } {
  const common = {
    userAgent: config.fetch.userAgent ?? defaultUserAgent(version),
    timeoutMs: config.fetch.timeoutMs,
    allowPrivateHosts: config.fetch.allowPrivateHosts,
    ...overrides,
  };
  return {
    crawl: new Fetcher({ ...common, hostIntervalMs: config.fetch.hostIntervalMs, maxBytes: config.fetch.maxBytes }),
    images: new Fetcher({ ...common, hostIntervalMs: 0, maxBytes: IMAGE_MAX_BYTES }),
  };
}

/** Reads the configuration, opens the database and wires every part. Nothing is started yet. */
export function createRuntime(options: { env: Record<string, string | undefined>; home: string; clock?: Clock }): Runtime {
  const clock = options.clock ?? systemClock;
  const paths = resolvePaths(options.env, options.home);
  const config = parseConfig(existsSync(paths.configFile) ? readFileSync(paths.configFile, "utf8") : null);
  const assignment = resolveAssignment(config);
  const providers = buildProviders(config, options.env);

  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  const db = openDatabase(paths.dbFile);
  migrate(db);
  // Once, after the migration from stop words: what they hid is matched again as filters.
  buildPendingFilterMatches(db);

  const version = productVersion();
  const runner = new TaskRunner({
    db,
    clock,
    providers,
    assignment,
    limits: {
      llmCallsPerRun: config.limits.llmCallsPerRun,
      llmCallsPerDay: config.limits.llmCallsPerDay,
      summariesPerDay: config.limits.summariesPerDay,
    },
    timeouts: { defaultMs: config.llm.timeoutMs, searchMs: config.llm.searchTimeoutMs },
    timeZone: () => getSettings(db).timeZone,
  });
  const { crawl: fetcher, images: imageFetcher } = buildFetchers(config, version);
  const imageCache = new ImageCache({
    dir: paths.imageCacheDir,
    maxBytes: config.images.cacheMaxBytes,
    maxAgeMs: config.images.cacheDays * DAY,
    clock,
  });
  const imageProxy = new ImageProxy({ fetcher: imageFetcher, cache: imageCache });
  const queue = new RunQueue({
    db,
    clock,
    execute: (runId) => executeRun({ db, clock, runner, fetcher, config }, runId),
    retries: config.limits.runRetries,
  });
  const scheduler = new Scheduler({ db, clock, queue, purgeImages: () => imageProxy.purgeExpired() });
  // The key comes from the environment and stays in this object: it is in no file, no table and no answer.
  const apiKey = translationApiKey(config, options.env);
  const translation = new TranslationService({
    db,
    clock,
    google: apiKey === null ? null : new GoogleTranslator({ fetcher, apiKey }),
    llm: new LlmTranslator(runner),
    monthlyChars: config.translation.monthlyChars,
    maxCharsPerArticle: config.translation.maxCharsPerArticle,
  });
  const poller = new FeedPoller({ db, clock, fetcher, translation });
  // Made before the summaries, which read a page through it when a feed fetches full content.
  const fullContent = new FullContentWorker({ db, clock, fetcher });
  const summarizer = new SummaryWorker({ db, clock, fetcher, runner, fullContent });

  const api = ensureToken(paths.apiTokenFile);
  const feed = ensureToken(paths.feedTokenFile);
  // In the data directory, apart from the tokens: it is made by the server and never written by a person.
  const imageKey = ensureKey(paths.imageKeyFile);
  const app = createApp({
    db,
    clock,
    queue,
    runner,
    fetcher,
    poller,
    translation,
    summarizer,
    fullContent,
    images: { key: imageKey.key, proxy: imageProxy },
    tokens: { api: api.token, feed: feed.token },
    version,
    webDir: join(import.meta.dirname, "../../web/dist"),
  });

  return {
    paths,
    config,
    db,
    queue,
    scheduler,
    poller,
    summarizer,
    fullContent,
    app,
    newTokenFiles: [...(api.created ? [paths.apiTokenFile] : []), ...(feed.created ? [paths.feedTokenFile] : [])],
    newKeyFiles: imageKey.created ? [paths.imageKeyFile] : [],
    recover() {
      // A waiting run older than the time a missed schedule is made up for is not started any more.
      const { closed, waiting } = recoverInterruptedRuns(db, clock, { retries: config.limits.runRetries, staleAfterMs: CATCH_UP_MS });
      for (const runId of waiting) queue.resume(runId);
      return { closed, resumed: waiting.length };
    },
    start() {
      scheduler.start();
      poller.start();
      fullContent.start();
      summarizer.start();
    },
    close() {
      scheduler.stop();
      poller.stop();
      fullContent.stop();
      summarizer.stop();
      db.close();
    },
  };
}
