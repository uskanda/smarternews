import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageProxyPath, parseConfig } from "@smarternews/core";
import { fakeClock, fakeFetch, imageResponse, pngBytes } from "@smarternews/core/testing";
import { describe, expect, it, vi } from "vitest";
import { announceNewFiles } from "./cli.ts";
import { buildFetchers, createRuntime } from "./runtime.ts";

describe("the runtime", () => {
  it("summarises feed articles and fetches their full content from its start until it is closed, with the limit of the configuration", async () => {
    const root = mkdtempSync(join(tmpdir(), "sn-runtime-"));
    const runtime = createRuntime({ env: { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") }, home: root });
    expect(runtime.summarizer.running).toBe(false);
    expect(runtime.fullContent.running).toBe(false);

    runtime.start();
    expect(runtime.summarizer.running).toBe(true);
    expect(runtime.fullContent.running).toBe(true);
    // Nothing is subscribed, so the first look of each part ends without a request.
    await Promise.all([runtime.poller.idle(), runtime.summarizer.idle(), runtime.fullContent.idle()]);

    runtime.close();
    expect(runtime.summarizer.running).toBe(false);
    expect(runtime.fullContent.running).toBe(false);
  });
});

describe("the fetchers of the runtime", () => {
  function fetchers(hostIntervalMs: number) {
    const config = parseConfig(`fetch:\n  hostIntervalMs: ${hostIntervalMs}\n  timeoutMs: 2000\n  userAgent: my-crawler/1\n  allowPrivateHosts: [192.168.0.10]\n`);
    const clock = fakeClock("2026-03-01T00:00:00.000Z");
    const site = fakeFetch({ "https://site.example.org/": () => imageResponse(pngBytes()), "http://192.168.0.10/": () => imageResponse(pngBytes()) }, clock);
    const waits: number[] = [];
    const built = buildFetchers(config, "1.0.0", {
      fetchImpl: site.fetchImpl,
      clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock.advance(ms);
      },
    });
    return { ...built, site, waits };
  }

  it("fetch images without the interval per host, even while the crawl waits it", async () => {
    const { crawl, images, site, waits } = fetchers(1000);
    await crawl.get("https://site.example.org/page");
    await images.getBytes("https://site.example.org/a.png", { maxBytes: 1000 });
    await images.getBytes("https://site.example.org/b.png", { maxBytes: 1000 });
    expect(waits).toEqual([]);
    expect(new Set(site.requests.map((request) => request.at)).size).toBe(1);
    // The crawl still keeps its interval.
    await crawl.get("https://site.example.org/next");
    expect(waits).toEqual([1000]);
  });

  it("give the images the crawl's User-Agent, time limit and allowed hosts", async () => {
    const { images, site } = fetchers(1000);
    await images.getBytes("http://192.168.0.10/a.png", { maxBytes: 1000 });
    expect(site.requests[0]!.headers["user-agent"]).toBe("my-crawler/1");
  });
});

describe("the key that signs image URLs", () => {
  it("is made once in the data directory for its owner only, and used again after a restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "sn-runtime-"));
    const env = { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") };
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" "))),
    );
    const first = createRuntime({ env, home: root });
    const path = join(root, "data", "image-proxy.key");
    expect(first.newKeyFiles).toEqual([path]);
    announceNewFiles(first, { stdout: (text) => void logged.push(text) });
    for (const spy of spies) spy.mockRestore();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const key = readFileSync(path, "utf8").trim();
    expect(Buffer.from(key, "base64url")).toHaveLength(32);
    // The start-up says where the key is, and never what it is.
    expect(logged.join("")).toContain(`created the key that signs image URLs: ${path}`);
    for (const form of [key, Buffer.from(key, "base64url").toString("hex"), Buffer.from(key, "base64url").toString("base64")]) {
      expect(logged.join("\n")).not.toContain(form);
    }
    // Nothing of the key is in the configuration directory or the configuration.
    expect(existsSync(join(root, "config", "image-proxy.key"))).toBe(false);
    first.close();

    const second = createRuntime({ env, home: root });
    expect(second.newKeyFiles).toEqual([]);
    expect(readFileSync(path, "utf8").trim()).toBe(key);
    // An image URL the first run answered is still accepted: its signature passes, and only the fetch fails here.
    const path1 = imageProxyPath(Buffer.from(key, "base64url"), "http://127.0.0.1/a.png");
    expect((await second.app.request(path1)).status).toBe(502);
    expect((await second.app.request(imageProxyPath(new Uint8Array(32), "http://127.0.0.1/a.png"))).status).toBe(403);
    second.close();
  });
});
