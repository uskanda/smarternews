// Test servers over HTTP, for clients whose tests cannot load the server into their own process: the Android
// app's tests run in a React Native flavour of Jest, where the server's modules do not resolve.
// A test runner starts this file with Node, reads the control port from the first line of output, and then
// creates one server per test. Each server listens on a port of its own, so a client addresses it exactly like
// a real one. Everything listens on the loopback address only, and the product never starts this file.
//
//   POST /__control   {"op": "create", "start"?, "webSearch"?}    -> {"id", "url", "apiToken", "feedToken"}
//   POST /__control   {"op": "category" | "article" | "advance" | "core" | "sql" | "dispose", "id", ...}
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as core from "@smarternews/core";
import * as coreTesting from "@smarternews/core/testing";
import { API_TOKEN, FEED_TOKEN, testServer } from "./testing.ts";

type Instance = ReturnType<typeof testServer>;

const instances = new Map<string, Instance>();
const listeners = new Map<string, Server>();
let serial = 0;

interface Command {
  op: string;
  id?: string;
  start?: string;
  webSearch?: boolean;
  name?: string;
  args?: unknown[];
  query?: string;
}

function instance(id: string | undefined): Instance {
  const found = id === undefined ? undefined : instances.get(id);
  if (!found) throw new Error(`no test server with the id ${id}`);
  return found;
}

async function run(command: Command): Promise<unknown> {
  const args = command.args ?? [];
  if (command.op === "create") {
    serial += 1;
    const id = `s${serial}`;
    const server = testServer(command.start, { webSearch: command.webSearch });
    const listener = createServer((request, response) => serve(server, request, response));
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    instances.set(id, server);
    listeners.set(id, listener);
    return { id, url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}`, apiToken: API_TOKEN, feedToken: FEED_TOKEN };
  }
  const server = instance(command.id);
  switch (command.op) {
    case "dispose":
      listeners.get(command.id!)?.close();
      listeners.delete(command.id!);
      instances.delete(command.id!);
      return null;
    case "category":
      return server.category(...(args as Parameters<Instance["category"]>));
    case "article":
      return server.article(...(args as Parameters<Instance["article"]>));
    case "advance":
      server.clock.advance(args[0] as number);
      return server.clock().toISOString();
    case "core": {
      // Any function of the core package, or of its test helpers, that takes the database first. "$clock"
      // stands for the server's clock.
      const name = command.name ?? "";
      const fn = (core as unknown as Record<string, unknown>)[name] ?? (coreTesting as unknown as Record<string, unknown>)[name];
      if (typeof fn !== "function") throw new Error(`the core package has no function ${command.name}`);
      return (fn as (...all: unknown[]) => unknown)(server.db, ...args.map((arg) => (arg === "$clock" ? server.clock : arg))) ?? null;
    }
    case "sql": {
      const statement = server.db.prepare(command.query ?? "");
      return /^\s*select/i.test(command.query ?? "") ? statement.all(...(args as never[])) : statement.run(...(args as never[]));
    }
    default:
      throw new Error(`unknown op ${command.op}`);
  }
}

function read(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/** Hands one HTTP request to a test server's app and writes its answer back. */
function serve(server: Instance, request: IncomingMessage, response: ServerResponse): void {
  void (async () => {
    const body = await read(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const method = request.method ?? "GET";
    const answer = await server.app.request(request.url ?? "/", {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(body),
    });
    const answerHeaders: Record<string, string> = {};
    answer.headers.forEach((value, name) => {
      if (name !== "content-encoding" && name !== "content-length") answerHeaders[name] = value;
    });
    response.writeHead(answer.status, answerHeaders).end(Buffer.from(await answer.arrayBuffer()));
  })().catch((error: unknown) => {
    response.writeHead(500).end(String(error));
  });
}

const control = createServer((request, response) => {
  void (async () => {
    const body = await read(request);
    if (request.url !== "/__control") {
      response.writeHead(404).end("only /__control is served here");
      return;
    }
    try {
      const result = await run(JSON.parse(body.toString("utf8")) as Command);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: (error as Error).message }));
    }
  })();
});

control.listen(0, "127.0.0.1", () => {
  process.stdout.write(`LISTENING ${(control.address() as AddressInfo).port}\n`);
});
