import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("hands back the response headers, with their names in lower case", async () => {
    const { fetcher } = setup({ "https://example.org/feed": () => new Response("x", { headers: { ETag: '"v1"', "Last-Modified": "Sun, 01 Mar 2026 09:00:00 GMT" } }) });
    const response = await fetcher.get("https://example.org/feed");
    expect(response.headers.etag).toBe('"v1"');
    expect(response.headers["last-modified"]).toBe("Sun, 01 Mar 2026 09:00:00 GMT");
  });

  it("hands back a not-modified answer with an empty body, and sends the condition it was given", async () => {
    const { fetcher, requests } = setup({ "https://example.org/feed": () => new Response(null, { status: 304 }) });
    const response = await fetcher.get("https://example.org/feed", { headers: { "if-none-match": '"v1"' } });
    expect(response).toMatchObject({ status: 304, text: "" });
    expect(requests[0]!.headers["if-none-match"]).toBe('"v1"');
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

const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });

describe("Fetcher redirects", () => {
  it("follows a redirect to another public site and reports the final URL", async () => {
    const { fetcher, requests } = setup({ "https://example.org/old": redirect("https://example.net/new"), "https://example.net/new": "moved" });
    await expect(fetcher.get("https://example.org/old")).resolves.toMatchObject({ status: 200, url: "https://example.net/new", text: "moved" });
    expect(requests.map((request) => request.url)).toEqual(["https://example.org/old", "https://example.net/new"]);
  });

  it("keeps the caller's headers on the same site and drops them on a redirect to another one", async () => {
    const { fetcher, requests } = setup({
      "https://example.org/a": redirect("/b"),
      "https://example.org/b": redirect("https://example.net/c"),
      "https://example.net/c": "moved",
    });
    await fetcher.get("https://example.org/a", { headers: { "x-goog-api-key": "secret", "if-none-match": '"v1"' } });
    expect(requests.map((request) => request.headers["x-goog-api-key"])).toEqual(["secret", "secret", undefined]);
    expect(requests[2]!.headers["if-none-match"]).toBeUndefined();
    expect(requests[2]!.headers["user-agent"]).toBeDefined();
  });

  it("resolves a relative redirect against the URL that answered", async () => {
    const { fetcher } = setup({ "https://example.org/a/old": redirect("../new"), "https://example.org/new": "moved" });
    await expect(fetcher.get("https://example.org/a/old")).resolves.toMatchObject({ url: "https://example.org/new" });
  });

  it("does not send a request to a redirect target in a refused range", async () => {
    const { fetcher, requests } = setup({ "https://example.org/old": redirect("http://127.0.0.1:8080/admin") });
    await expect(fetcher.get("https://example.org/old")).rejects.toThrow(FetchError);
    await expect(fetcher.get("https://example.org/old")).rejects.toThrow(/destination not allowed: http:\/\/127\.0\.0\.1:8080\/admin/);
    expect(requests.every((request) => request.url === "https://example.org/old")).toBe(true);
  });

  it("does not follow a redirect to another scheme", async () => {
    const { fetcher, requests } = setup({ "https://example.org/old": redirect("file:///etc/passwd") });
    await expect(fetcher.get("https://example.org/old")).rejects.toThrow(/scheme/);
    expect(requests).toHaveLength(1);
  });

  it("gives up at the sixth redirect without sending another request", async () => {
    const { fetcher, requests } = setup({
      "https://example.org/": (request) => {
        const step = Number(new URL(request.url).searchParams.get("n") ?? 0);
        return new Response(null, { status: 302, headers: { location: `https://example.org/?n=${step + 1}` } });
      },
    });
    await expect(fetcher.get("https://example.org/?n=0")).rejects.toThrow(/more than 5 redirects/);
    expect(requests).toHaveLength(6);
  });

  it("asks again with GET and no body after a 303 answer to a POST", async () => {
    const { fetcher, requests } = setup({ "https://example.org/form": redirect("https://example.org/done", 303), "https://example.org/done": "ok" });
    await fetcher.get("https://example.org/form", { method: "POST", body: "a=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(requests[1]).toMatchObject({ method: "GET", body: null });
    expect(requests[1]!.headers["content-type"]).toBeUndefined();
  });

  it("repeats the method and body after a 307 answer", async () => {
    const { fetcher, requests } = setup({ "https://example.org/form": redirect("https://example.org/again", 307), "https://example.org/again": "ok" });
    await fetcher.get("https://example.org/form", { method: "POST", body: "a=1" });
    expect(requests[1]).toMatchObject({ method: "POST", body: "a=1" });
  });

  it("waits the host interval before a redirect back to the same host", async () => {
    const { fetcher, requests } = setup({ "https://example.org/old": redirect("https://example.org/new"), "https://example.org/new": "ok" });
    await fetcher.get("https://example.org/old");
    expect(requests[1]!.at - requests[0]!.at).toBeGreaterThanOrEqual(1000);
  });
});

describe("Fetcher destinations", () => {
  it("does not send a request to an address in a refused range", async () => {
    const { fetcher, requests } = setup({});
    await expect(fetcher.get("http://192.168.0.1/feed.xml")).rejects.toThrow(/destination not allowed.*fetch\.allowPrivateHosts/);
    expect(requests).toHaveLength(0);
  });

  it("does not send a request to a URL with another scheme", async () => {
    const { fetcher, requests } = setup({});
    await expect(fetcher.get("file:///etc/passwd")).rejects.toThrow(FetchError);
    expect(requests).toHaveLength(0);
  });

  it("sends a request to an allowed address in a refused range", async () => {
    const { fetcher } = setup({ "http://192.168.0.10/feed.xml": "feed" }, { allowPrivateHosts: ["192.168.0.10"] });
    await expect(fetcher.get("http://192.168.0.10/feed.xml")).resolves.toMatchObject({ text: "feed" });
  });
});

// No stand-in here: the check on the resolved address happens where the connection is made.
describe("Fetcher over a real connection", () => {
  let server: Server;
  let port: number;
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits.push(request.url ?? "");
      if (request.url === "/to-address") {
        response.writeHead(302, { location: `http://127.0.0.1:${port}/page` }).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" }).end("reached");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const real = (allowPrivateHosts: string[]) => new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 5000, maxBytes: 1000, allowPrivateHosts });

  it("does not connect to a name that resolves to a loopback address", async () => {
    hits.length = 0;
    await expect(real([]).get(`http://localhost:${port}/page`)).rejects.toThrow(/destination not allowed.*localhost/);
    expect(hits).toEqual([]);
  });

  it("connects to that name once it is listed as allowed", async () => {
    await expect(real(["localhost"]).get(`http://localhost:${port}/page`)).resolves.toMatchObject({ status: 200, text: "reached" });
  });

  it("stops at a redirect from an allowed name to an address that is not allowed", async () => {
    hits.length = 0;
    await expect(real(["localhost"]).get(`http://localhost:${port}/to-address`)).rejects.toThrow(/destination not allowed: http:\/\/127\.0\.0\.1/);
    expect(hits).toEqual(["/to-address"]);
  });
});
