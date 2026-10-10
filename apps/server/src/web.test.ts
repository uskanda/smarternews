import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunQueue } from "@smarternews/core";
import { createTestDb, fakeClock, fakeLlm } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { API_TOKEN, FEED_TOKEN } from "./testing.ts";

function server(build: "built" | "not-built") {
  const dir = join(mkdtempSync(join(tmpdir(), "sn-web-")), "dist");
  if (build === "built") {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>smarternews</title><div id=root></div>");
    writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log('app')");
    writeFileSync(join(dir, "assets", "app-abc123.css"), "body{}");
    writeFileSync(join(dir, "..", "secret.txt"), "outside the web directory");
  }
  const db = createTestDb();
  const clock = fakeClock("2026-03-01T12:00:00.000Z");
  const queue = new RunQueue({ db, clock, execute: async () => {} });
  const app = createApp({
    db,
    clock,
    queue,
    runner: fakeLlm(db, clock, {}).runner,
    tokens: { api: API_TOKEN, feed: FEED_TOKEN },
    version: "9.9.9",
    webDir: dir,
  });
  return app;
}

describe("serving the web app", () => {
  it("returns the page at the root without a token", async () => {
    const response = await server("built").request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<title>smarternews</title>");
  });

  it("returns the same page for a path inside the app, so a reload or a shared link works", async () => {
    const app = server("built");
    for (const path of ["/unread", "/c/security/12", "/settings/categories/3", "/runs/7"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toContain("<title>smarternews</title>");
    }
  });

  it("serves the built assets with their content type and a long cache lifetime", async () => {
    const app = server("built");
    const script = await app.request("/assets/app-abc123.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(script.headers.get("cache-control")).toContain("immutable");
    expect((await app.request("/assets/app-abc123.css")).headers.get("content-type")).toContain("text/css");
  });

  it("compresses scripts, styles and the page for a browser that accepts gzip", async () => {
    const app = server("built");
    for (const path of ["/assets/app-abc123.js", "/assets/app-abc123.css", "/"]) {
      const response = await app.request(path, { headers: { "accept-encoding": "gzip, deflate, br" } });
      expect(response.headers.get("content-encoding"), path).toBe("gzip");
      expect(response.headers.get("vary"), path).toBe("Accept-Encoding");
      const { gunzipSync } = await import("node:zlib");
      const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
      expect(text.length, path).toBeGreaterThan(0);
    }
  });

  it("sends files as they are to a client that does not accept gzip", async () => {
    const response = await server("built").request("/assets/app-abc123.js");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("console.log('app')");
  });

  it("does not cache the page itself, so a new build is picked up", async () => {
    const response = await server("built").request("/");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("answers 404 for an asset that does not exist instead of the page", async () => {
    const response = await server("built").request("/assets/missing.js");
    expect(response.status).toBe(404);
  });

  it("does not serve files outside the web directory", async () => {
    const app = server("built");
    for (const path of ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt"]) {
      const response = await app.request(path);
      expect(await response.text(), path).not.toContain("outside the web directory");
    }
  });

  it("keeps answering unknown API and feed paths with their own errors", async () => {
    const app = server("built");
    const api = await app.request("/api/v1/nothing", { headers: { authorization: `Bearer ${API_TOKEN}` } });
    expect(api.status).toBe(404);
    expect(await api.json()).toMatchObject({ error: { code: "not_found" } });
    const unversioned = await app.request("/api/articles");
    expect(unversioned.status).toBe(404);
    expect(unversioned.headers.get("content-type")).toContain("application/json");
    expect((await app.request(`/rss/nothing.xml?token=${FEED_TOKEN}`)).status).toBe(404);
  });

  it("only answers GET for the page", async () => {
    const response = await server("built").request("/unread", { method: "POST" });
    expect(response.status).toBe(404);
  });
});

describe("before the web app is built", () => {
  it("says how to build it", async () => {
    const response = await server("not-built").request("/");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("pnpm build");
  });

  it("still serves the API and the feeds", async () => {
    const app = server("not-built");
    expect((await app.request("/api/v1/health")).status).toBe(200);
    expect((await app.request(`/rss/all.xml?token=${FEED_TOKEN}`)).status).toBe(200);
  });
});

describe("response headers of the page", () => {
  it("allows scripts from the same origin only and forbids framing", async () => {
    const policy = (await server("built").request("/")).headers.get("content-security-policy") ?? "";
    const directives = Object.fromEntries(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values.join(" ")]));
    expect(directives["script-src"]).toBe("'self'");
    expect(directives["default-src"]).toBe("'self'");
    expect(directives["frame-ancestors"]).toBe("'none'");
    expect(directives["object-src"]).toBe("'none'");
    expect(directives["connect-src"]).toBe("'self'");
  });

  it("tells the browser not to send the referrer and not to guess content types", async () => {
    const response = await server("built").request("/settings");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
