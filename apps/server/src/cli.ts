import { readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import {
  ConfigError,
  DomainError,
  exportOpml,
  exportSettings,
  findCategoryBySlug,
  getRun,
  importOpml,
  importSettings,
  resolvePaths,
  systemClock,
} from "@smarternews/core";
import { createRuntime, type Runtime } from "./runtime.ts";
import { ensureToken } from "./tokens.ts";

export interface CliIo {
  env: Record<string, string | undefined>;
  home: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: smarternews <command>

  serve                 start the API, the feeds and the scheduler
  run <category-slug>   run one category now and wait for it to finish
  import <file>         load categories, topics and settings from a settings file
  export [file]         write the settings file to standard output or to a file
  opml-import <file>    subscribe to the feeds of an OPML file that are not subscribed yet
  opml-export [file]    write the subscribed feeds as OPML to standard output or to a file
  token [api|feed]      print a token, creating it when there is none
`;

export function parseListen(listen: string): { hostname: string; port: number } {
  const separator = listen.lastIndexOf(":");
  return { hostname: listen.slice(0, separator).replace(/^\[|\]$/g, ""), port: Number(listen.slice(separator + 1)) };
}

/** Binds the HTTP server. Port 0 picks a free port, which the result reports. */
export function startServer(
  runtime: Runtime,
  listen: { hostname: string; port: number },
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: runtime.app.fetch, hostname: listen.hostname, port: listen.port }, (info: AddressInfo) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
    server.on("error", reject);
  });
}

/** Names the files of tokens and keys that the runtime created. Their content is never written out. */
export function announceNewFiles(runtime: Pick<Runtime, "newTokenFiles" | "newKeyFiles">, io: Pick<CliIo, "stdout">): void {
  for (const file of runtime.newTokenFiles) io.stdout(`created a token file: ${file}\n`);
  for (const file of runtime.newKeyFiles) io.stdout(`created the key that signs image URLs: ${file}\n`);
}

async function serveCommand(io: CliIo): Promise<number> {
  const runtime = createRuntime(io);
  announceNewFiles(runtime, io);
  const { closed, resumed } = runtime.recover();
  if (closed > 0) io.stdout(`closed ${closed} run(s) that an earlier stop interrupted\n`);
  if (resumed > 0) io.stdout(`resumed ${resumed} run(s) that were waiting when the server stopped\n`);
  const listen = parseListen(runtime.config.listen);
  const server = await startServer(runtime, listen);
  runtime.start();
  io.stdout(`listening on http://${runtime.config.listen} (API token: ${runtime.paths.apiTokenFile})\n`);
  return new Promise((resolve) => {
    const stop = () => {
      io.stdout("stopping\n");
      void server.close().then(() => {
        runtime.close();
        resolve(0);
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runCommand(io: CliIo, slug: string | undefined): Promise<number> {
  if (!slug) {
    io.stderr("run: name the category by its slug\n");
    return 2;
  }
  const runtime = createRuntime(io);
  try {
    const category = findCategoryBySlug(runtime.db, slug);
    if (!category) {
      io.stderr(`run: there is no category with the slug "${slug}"\n`);
      return 1;
    }
    const queued = runtime.queue.enqueue(category.id, "manual", null);
    await runtime.queue.idle();
    const run = getRun(runtime.db, queued.id);
    io.stdout(
      `run ${run.id} ${run.status}: ${run.collected} candidate(s) collected, ${run.rejected} rejected, ` +
        `${run.articlesCreated} article(s) created, ${run.articlesUpdated} updated, ${run.llmCalls} model call(s)\n`,
    );
    for (const failure of run.failures) io.stdout(`  ${failure.stage}${failure.target ? ` (${failure.target})` : ""}: ${failure.message}\n`);
    return run.status === "succeeded" || run.status === "partial" ? 0 : 1;
  } finally {
    runtime.close();
  }
}

function importCommand(io: CliIo, file: string | undefined): number {
  if (!file) {
    io.stderr("import: name the settings file\n");
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    io.stderr(`import: cannot read ${file}: ${(error as Error).message}\n`);
    return 1;
  }
  const runtime = createRuntime(io);
  try {
    const result = importSettings(runtime.db, text, systemClock);
    io.stdout(
      `${result.categoriesCreated} categories created, ${result.categoriesUpdated} updated; ` +
        `${result.topicsCreated} topics created, ${result.topicsUpdated} updated\n`,
    );
    return 0;
  } finally {
    runtime.close();
  }
}

function exportCommand(io: CliIo, file: string | undefined): number {
  const runtime = createRuntime(io);
  try {
    const text = exportSettings(runtime.db);
    if (file) writeFileSync(file, text);
    else io.stdout(text);
    return 0;
  } finally {
    runtime.close();
  }
}

function opmlImportCommand(io: CliIo, file: string | undefined): number {
  if (!file) {
    io.stderr("opml-import: name the OPML file\n");
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    io.stderr(`opml-import: cannot read ${file}: ${(error as Error).message}\n`);
    return 1;
  }
  const runtime = createRuntime(io);
  try {
    const result = importOpml(runtime.db, text, systemClock);
    io.stdout(`${result.feedsCreated} feeds registered, ${result.feedsSkipped} skipped; ${result.categoriesCreated} categories created\n`);
    return 0;
  } finally {
    runtime.close();
  }
}

function opmlExportCommand(io: CliIo, file: string | undefined): number {
  const runtime = createRuntime(io);
  try {
    const text = exportOpml(runtime.db);
    if (file) writeFileSync(file, text);
    else io.stdout(text);
    return 0;
  } finally {
    runtime.close();
  }
}

function tokenCommand(io: CliIo, which: string | undefined): number {
  if (which !== undefined && which !== "api" && which !== "feed") {
    io.stderr("token: choose api or feed\n");
    return 2;
  }
  const paths = resolvePaths(io.env, io.home);
  io.stdout(`${ensureToken(which === "feed" ? paths.feedTokenFile : paths.apiTokenFile).token}\n`);
  return 0;
}

/** Runs one command and returns the exit status. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, argument] = argv;
  try {
    switch (command) {
      case "serve":
        return await serveCommand(io);
      case "run":
        return await runCommand(io, argument);
      case "import":
        return importCommand(io, argument);
      case "export":
        return exportCommand(io, argument);
      case "opml-import":
        return opmlImportCommand(io, argument);
      case "opml-export":
        return opmlExportCommand(io, argument);
      case "token":
        return tokenCommand(io, argument);
      case "help":
      case "--help":
      case "-h":
        io.stdout(USAGE);
        return 0;
      default:
        io.stderr(USAGE);
        return 2;
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      io.stderr(`${error.message}\n`);
      return 1;
    }
    if (error instanceof DomainError) {
      const fields = error.fields.map((field) => `\n  ${field.path}: ${field.message}`).join("");
      io.stderr(`${error.message}${fields}\n`);
      return 1;
    }
    throw error;
  }
}
