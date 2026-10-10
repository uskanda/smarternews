import { describe, expect, it } from "vitest";
import { fakeClock } from "../testing/db.ts";
import { fakeFetch } from "../testing/http.ts";
import { defaultUserAgent, FetchError, Fetcher } from "./http.ts";

function setup(routes: Parameters<typeof fakeFetch>[0], overrides: Partial<ConstructorParameters<typeof Fetcher>[0]> = {}) {
  const clock = fakeClock("2026-03-01T00:00:00.000Z");
  const fake = fakeFetch(routes, clock);
  const fetcher = new Fetcher({
    userAgent: defaultUserAgent("1.2.3"),
    hostIntervalMs: 1000,
    timeoutMs: 1000,
    maxBytes: 1000,
    fetchImpl: fake.fetchImpl,
    clock,
    sleep: async (ms) => clock.advance(ms),
    ...overrides,
  });
  return { clock, fetcher, ...fake };
}

describe("Fetcher", () => {
  it("identifies itself with the product name, version and repository URL by default", async () => {
    const { fetcher, requests } = setup({ "https://example.org/a": "ok" });
    await fetcher.get("https://example.org/a");
    expect(requests[0]!.headers["user-agent"]).toBe("smarternews/1.2.3 (+https://github.com/uskanda/smarternews)");
  });

  it("uses the configured User-Agent when there is one", async () => {
    const { fetcher, requests } = setup({ "https://example.org/a": "ok" }, { userAgent: "my-crawler/9" });
    await fetcher.get("https://example.org/a");
    expect(requests[0]!.headers["user-agent"]).toBe("my-crawler/9");
  });

  it("leaves at least the configured interval between requests to one host", async () => {
    const { fetcher, requests } = setup({ "https://example.org/": "ok" });
    await fetcher.get("https://example.org/1");
    await fetcher.get("https://example.org/2");
    await fetcher.get("https://example.org/3");
    const [first, second, third] = requests.map((request) => request.at);
    expect(second! - first!).toBeGreaterThanOrEqual(1000);
    expect(third! - second!).toBeGreaterThanOrEqual(1000);
  });

  it("spaces out requests that are started at the same moment", async () => {
    // Real time here: a clock that jumps inside sleep() cannot order two overlapping requests.
    const times: number[] = [];
    const fetcher = new Fetcher({
      userAgent: "test",
      hostIntervalMs: 40,
      timeoutMs: 1000,
      maxBytes: 1000,
      fetchImpl: (async () => {
        times.push(Date.now());
        return new Response("ok");
      }) as typeof fetch,
    });
    await Promise.all([fetcher.get("https://example.org/1"), fetcher.get("https://example.org/2")]);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(35);
  });

  it("does not delay a request to another host", async () => {
    const { fetcher, requests } = setup({ "https://example.org/": "ok", "https://example.net/": "ok" });
    await fetcher.get("https://example.org/1");
    await fetcher.get("https://example.net/1");
    expect(requests[1]!.at - requests[0]!.at).toBe(0);
  });

  it("gives up on a response that does not arrive in time", async () => {
    const { fetcher } = setup({ "https://example.org/slow": () => "hang" }, { timeoutMs: 20 });
    await expect(fetcher.get("https://example.org/slow")).rejects.toThrow(FetchError);
    await expect(fetcher.get("https://example.org/slow")).rejects.toThrow(/timed out/);
  });

  it("gives up on a response larger than the limit", async () => {
    const { fetcher } = setup({ "https://example.org/big": "x".repeat(5000) });
    await expect(fetcher.get("https://example.org/big")).rejects.toThrow(/larger than 1000 bytes/);
  });

  it("hands back the status of an error response instead of throwing", async () => {
    const { fetcher } = setup({});
    await expect(fetcher.get("https://example.org/missing")).resolves.toMatchObject({ status: 404 });
  });

  it("decodes a body in the character set the response declares", async () => {
    const shiftJis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b]); // 日本
    const { fetcher } = setup({
      "https://example.org/sjis": () => new Response(shiftJis, { headers: { "content-type": "text/html; charset=Shift_JIS" } }),
    });
    await expect(fetcher.get("https://example.org/sjis")).resolves.toMatchObject({ text: "日本" });
  });

  it("decodes a body whose character set is declared only in the markup", async () => {
    const prefix = new TextEncoder().encode('<html><head><meta charset="shift_jis"></head><body>');
    const body = new Uint8Array([...prefix, 0x93, 0xfa, 0x96, 0x7b]);
    const { fetcher } = setup({
      "https://example.org/meta": () => new Response(body, { headers: { "content-type": "text/html" } }),
    });
    expect((await fetcher.get("https://example.org/meta")).text).toContain("日本");
  });
});
