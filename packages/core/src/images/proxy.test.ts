import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeClock } from "../testing/db.ts";
import { fakeFetch, type Route } from "../testing/http.ts";
import { imageResponse, jpegBytes, pngBytes } from "../testing/images.ts";
import { ImageCache } from "./cache.ts";
import { IMAGE_MAX_BYTES, ImageFetchError, ImageProxy } from "./proxy.ts";

function setup(routes: Record<string, Route | string>, options: { maxBytes?: number } = {}) {
  const clock = fakeClock("2026-03-01T00:00:00.000Z");
  const site = fakeFetch(routes, clock);
  const fetcher = new Fetcher({ userAgent: "test", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 1000, fetchImpl: site.fetchImpl, clock, sleep: async () => {} });
  const dir = join(mkdtempSync(join(tmpdir(), "sn-proxy-")), "image-cache");
  const cache = new ImageCache({ dir, maxBytes: options.maxBytes ?? 100_000_000, maxAgeMs: 7 * 86_400_000, clock });
  const proxy = new ImageProxy({ fetcher, cache, log: () => {} });
  return { clock, site, dir, cache, proxy };
}

/** A route that answers once the test lets it, and counts how many of its requests are open at once. */
function gated() {
  const opened: string[] = [];
  const waiting = new Map<string, () => void>();
  let open = 0;
  let most = 0;
  const route: Route = (request) => {
    open += 1;
    most = Math.max(most, open);
    opened.push(request.url);
    return new Promise<Response>((resolve) =>
      waiting.set(request.url, () => {
        open -= 1;
        resolve(imageResponse(pngBytes(64)));
      }),
    ) as unknown as Response;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return {
    route,
    opened,
    get most() {
      return most;
    },
    async release(url: string) {
      waiting.get(url)?.();
      waiting.delete(url);
      await settle();
    },
    async releaseAll() {
      while (waiting.size > 0) await this.release([...waiting.keys()][0]!);
    },
    settle,
  };
}

describe("ImageProxy", () => {
  it("fetches an image, keeps it, and gives it back with the format of its bytes", async () => {
    const { proxy, site, dir } = setup({ "http://img.example.org/a.png": () => imageResponse(pngBytes(100), "text/html") });
    const image = await proxy.get("http://img.example.org/a.png");
    expect(image.type).toBe("image/png");
    expect([...image.bytes]).toEqual([...pngBytes(100)]);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(site.urls()).toEqual(["http://img.example.org/a.png"]);
  });

  it("asks only for the formats it accepts, and never for robots.txt", async () => {
    const { proxy, site } = setup({ "https://img.example.org/a.png": () => imageResponse(pngBytes()) });
    await proxy.get("https://img.example.org/a.png");
    expect(site.requests[0]!.headers.accept).toMatch(/image\/avif/);
    expect(site.requests[0]!.headers.accept).not.toMatch(/svg|\*\/\*/);
    expect(site.urls().some((url) => url.includes("robots.txt"))).toBe(false);
  });

  it("answers from disk a second time, without asking the other site", async () => {
    const { proxy, site } = setup({ "https://img.example.org/a.png": () => imageResponse(pngBytes()) });
    await proxy.get("https://img.example.org/a.png");
    const again = await proxy.get("https://img.example.org/a.png");
    expect(again.type).toBe("image/png");
    expect(site.requests).toHaveLength(1);
  });

  it("shares one fetch among requests for the same image that arrive together", async () => {
    const gate = gated();
    const { proxy, site } = setup({ "https://img.example.org/a.png": gate.route });
    const all = Promise.all([1, 2, 3].map(() => proxy.get("https://img.example.org/a.png")));
    await gate.settle();
    await gate.releaseAll();
    expect((await all).map((image) => image.type)).toEqual(["image/png", "image/png", "image/png"]);
    expect(site.requests).toHaveLength(1);
  });

  it("refuses an answer that is not a success, and keeps nothing", async () => {
    const { proxy, dir } = setup({ "https://img.example.org/gone.png": () => new Response("gone", { status: 410 }) });
    await expect(proxy.get("https://img.example.org/gone.png")).rejects.toThrow(ImageFetchError);
    await expect(proxy.get("https://img.example.org/gone.png")).rejects.toThrow(/410/);
    await expect(proxy.get("https://img.example.org/missing.png")).rejects.toThrow(/404/);
    expect(() => readdirSync(dir)).toThrow();
  });

  it("gives up on an image larger than 10 MB, and keeps nothing", async () => {
    expect(IMAGE_MAX_BYTES).toBe(10_000_000);
    const { proxy, dir } = setup({ "https://img.example.org/big.png": () => imageResponse(pngBytes(11_000_000)) });
    await expect(proxy.get("https://img.example.org/big.png")).rejects.toThrow(/larger than 10000000 bytes/);
    expect(() => readdirSync(dir)).toThrow();
  });

  it("refuses a page that claims to be an image", async () => {
    const page = new TextEncoder().encode("<!doctype html><title>x</title>");
    const { proxy } = setup({ "https://img.example.org/a.png": () => imageResponse(page, "image/png") });
    await expect(proxy.get("https://img.example.org/a.png")).rejects.toThrow(/not an image/);
  });

  it("refuses an SVG image by its media type", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { proxy } = setup({ "https://img.example.org/a.svg": () => imageResponse(svg, "image/svg+xml; charset=utf-8") });
    await expect(proxy.get("https://img.example.org/a.svg")).rejects.toThrow(/SVG/);
  });

  it("refuses a destination the crawler does not fetch", async () => {
    const { proxy, site } = setup({});
    await expect(proxy.get("http://127.0.0.1/a.png")).rejects.toThrow(ImageFetchError);
    await expect(proxy.get("not a url")).rejects.toThrow(ImageFetchError);
    expect(site.requests).toHaveLength(0);
  });

  it("fetches an image again when the kept one is past its period", async () => {
    const { proxy, site, clock } = setup({ "https://img.example.org/a.png": () => imageResponse(jpegBytes()) });
    await proxy.get("https://img.example.org/a.png");
    clock.advance(8 * 86_400_000);
    expect((await proxy.get("https://img.example.org/a.png")).type).toBe("image/jpeg");
    expect(site.requests).toHaveLength(2);
  });
});

describe("ImageProxy fetches to one host", () => {
  const urls = (host: string, count: number) => Array.from({ length: count }, (_, index) => `https://${host}/${index}.png`);

  it("keeps at most four open to one host, and answers all six images", async () => {
    const gate = gated();
    const { proxy } = setup({ "https://img.example.org/": gate.route });
    const all = Promise.all(urls("img.example.org", 6).map((url) => proxy.get(url)));
    await gate.settle();
    expect(gate.opened).toHaveLength(4);
    await gate.releaseAll();
    expect(await all).toHaveLength(6);
    expect(gate.most).toBe(4);
    expect(gate.opened).toHaveLength(6);
  });

  it("starts the waiting fetches in the order they arrived", async () => {
    const gate = gated();
    const { proxy } = setup({ "https://img.example.org/": gate.route });
    const list = urls("img.example.org", 6);
    const all = Promise.all(list.map((url) => proxy.get(url)));
    await gate.settle();
    await gate.release(list[2]!);
    expect(gate.opened).toEqual(list.slice(0, 5));
    await gate.release(list[0]!);
    expect(gate.opened).toEqual(list);
    await gate.releaseAll();
    await all;
  });

  it("does not hold back a fetch to another host", async () => {
    const gate = gated();
    const { proxy } = setup({ "https://img.example.org/": gate.route, "https://other.example.net/": () => imageResponse(pngBytes()) });
    const busy = Promise.all(urls("img.example.org", 4).map((url) => proxy.get(url)));
    await gate.settle();
    await expect(proxy.get("https://other.example.net/a.png")).resolves.toMatchObject({ type: "image/png" });
    await gate.releaseAll();
    await busy;
  });

  it("counts neither an answer from disk nor a request that shares a fetch", async () => {
    const gate = gated();
    const { proxy, cache } = setup({ "https://img.example.org/": gate.route });
    await cache.write("https://img.example.org/kept.png", pngBytes());
    const busy = Promise.all(urls("img.example.org", 4).map((url) => proxy.get(url)));
    await gate.settle();
    // All four places are taken, yet the kept image comes back, and a fifth request for a busy image joins its fetch.
    await expect(proxy.get("https://img.example.org/kept.png")).resolves.toMatchObject({ type: "image/png" });
    const shared = proxy.get("https://img.example.org/0.png");
    await gate.settle();
    expect(gate.opened).toHaveLength(4);
    await gate.releaseAll();
    await expect(shared).resolves.toMatchObject({ type: "image/png" });
    await busy;
  });
});
