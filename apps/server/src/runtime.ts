import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProviders,
  defaultUserAgent,
  executeRun,
  FeedPoller,
  Fetcher,
  getSettings,
  migrate,
  openDatabase,
  parseConfig,
  resolveAssignment,
  resolvePaths,
  RunQueue,
  Scheduler,
  systemClock,
  TaskRunner,
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
  app: Hono;
  /** Token files this call created, to be announced once. */
  newTokenFiles: string[];
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

  const version = productVersion();
  const runner = new TaskRunner({
    db,
    clock,
    providers,
    assignment,
    limits: { llmCallsPerRun: config.limits.llmCallsPerRun, llmCallsPerDay: config.limits.llmCallsPerDay },
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
  });
  const scheduler = new Scheduler({ db, clock, queue });
  const poller = new FeedPoller({ db, clock, fetcher });

  const api = ensureToken(paths.apiTokenFile);
  const feed = ensureToken(paths.feedTokenFile);
  const app = createApp({
    db,
    clock,
    queue,
    runner,
    fetcher,
    poller,
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
    app,
    newTokenFiles: [...(api.created ? [paths.apiTokenFile] : []), ...(feed.created ? [paths.feedTokenFile] : [])],
    close() {
      scheduler.stop();
      poller.stop();
      db.close();
    },
  };
}
