import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProviders,
  CATCH_UP_MS,
  defaultUserAgent,
  executeRun,
  FeedPoller,
  Fetcher,
  getSettings,
  GoogleTranslator,
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
  type Paths,
} from "@smarternews/core";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import { ensureToken } from "./tokens.ts";

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
  app: Hono;
  /** Token files this call created, to be announced once. */
  newTokenFiles: string[];
  /**
   * Settles what an earlier stop left behind, before anything is started: a run that was in progress is closed
   * as failed, and the runs that were waiting are put back in line. Says how many of each there were.
   */
  recover(): { closed: number; resumed: number };
  /** Starts the scheduler, the fetching of feeds and the summaries. */
  start(): void;
  close(): void;
}

export function productVersion(): string {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8")) as { version: string };
  return manifest.version;
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
  const fetcher = new Fetcher({
    userAgent: config.fetch.userAgent ?? defaultUserAgent(version),
    hostIntervalMs: config.fetch.hostIntervalMs,
    timeoutMs: config.fetch.timeoutMs,
    maxBytes: config.fetch.maxBytes,
    allowPrivateHosts: config.fetch.allowPrivateHosts,
  });
  const queue = new RunQueue({
    db,
    clock,
    execute: (runId) => executeRun({ db, clock, runner, fetcher, config }, runId),
    retries: config.limits.runRetries,
  });
  const scheduler = new Scheduler({ db, clock, queue });
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
  const summarizer = new SummaryWorker({ db, clock, fetcher, runner });

  const api = ensureToken(paths.apiTokenFile);
  const feed = ensureToken(paths.feedTokenFile);
  const app = createApp({
    db,
    clock,
    queue,
    runner,
    fetcher,
    poller,
    translation,
    summarizer,
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
    app,
    newTokenFiles: [...(api.created ? [paths.apiTokenFile] : []), ...(feed.created ? [paths.feedTokenFile] : [])],
    recover() {
      // A waiting run older than the time a missed schedule is made up for is not started any more.
      const { closed, waiting } = recoverInterruptedRuns(db, clock, { retries: config.limits.runRetries, staleAfterMs: CATCH_UP_MS });
      for (const runId of waiting) queue.resume(runId);
      return { closed, resumed: waiting.length };
    },
    start() {
      scheduler.start();
      poller.start();
      summarizer.start();
    },
    close() {
      scheduler.stop();
      poller.stop();
      summarizer.stop();
      db.close();
    },
  };
}
