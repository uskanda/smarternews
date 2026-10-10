import { describe, expect, it } from "vitest";
import { fakeFetch, html } from "../testing/http.ts";
import { Fetcher } from "./http.ts";
import { PageFetcher } from "./pages.ts";

function setup(routes: Parameters<typeof fakeFetch>[0], pagesPerRun = 20) {
  const fake = fakeFetch(routes);
  const fetcher = new Fetcher({
    userAgent: "smarternews/0.0.0 (+https://example.org)",
    hostIntervalMs: 0,
    timeoutMs: 1000,
    maxBytes: 100000,
    fetchImpl: fake.fetchImpl,
  });
  return { pages: new PageFetcher(fetcher, { pagesPerRun }), ...fake };
}

const robots = (body: string) => () => new Response(body, { headers: { "content-type": "text/plain" } });

describe("PageFetcher", () => {
  it("fetches a page that robots.txt allows", async () => {
    const { pages } = setup({
      "https://example.org/robots.txt": robots("User-agent: *\nDisallow: /private/"),
      "https://example.org/news/1": () => html("<p>hello</p>"),
    });
    await expect(pages.fetchPage("https://example.org/news/1")).resolves.toEqual({
      ok: true,
      html: "<p>hello</p>",
      url: "https://example.org/news/1",
    });
  });

  it("sends no request for a page that robots.txt forbids", async () => {
    const { pages, urls } = setup({
      "https://example.org/robots.txt": robots("User-agent: *\nDisallow: /private/"),
      "https://example.org/private/1": () => html("<p>secret</p>"),
    });
    await expect(pages.fetchPage("https://example.org/private/1")).resolves.toEqual({ ok: false, reason: "robots" });
    expect(urls()).toEqual(["https://example.org/robots.txt"]);
  });

  it("obeys a rule addressed to this crawler by name", async () => {
    const { pages } = setup({
      "https://example.org/robots.txt": robots("User-agent: smarternews\nDisallow: /\n\nUser-agent: *\nAllow: /"),
      "https://example.org/news/1": () => html("x"),
    });
    await expect(pages.fetchPage("https://example.org/news/1")).resolves.toMatchObject({ ok: false, reason: "robots" });
  });

  it("treats a site without robots.txt as allowing everything", async () => {
    const { pages } = setup({ "https://example.org/news/1": () => html("x") });
    await expect(pages.fetchPage("https://example.org/news/1")).resolves.toMatchObject({ ok: true });
  });

  it("treats a failing robots.txt as forbidding everything", async () => {
    const { pages } = setup({
      "https://example.org/robots.txt": () => new Response("oops", { status: 503 }),
      "https://example.org/news/1": () => html("x"),
    });
    await expect(pages.fetchPage("https://example.org/news/1")).resolves.toMatchObject({ ok: false, reason: "robots" });
  });

  it("reads robots.txt once per site", async () => {
    const { pages, urls } = setup({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/": () => html("x"),
    });
    await pages.fetchPage("https://example.org/a");
    await pages.fetchPage("https://example.org/b");
    expect(urls().filter((url) => url.endsWith("/robots.txt"))).toHaveLength(1);
  });

  it("stops fetching pages once the run has reached its limit", async () => {
    const { pages, urls } = setup({ "https://example.org/": () => html("x") }, 2);
    await pages.fetchPage("https://example.org/1");
    await pages.fetchPage("https://example.org/2");
    await expect(pages.fetchPage("https://example.org/3")).resolves.toEqual({ ok: false, reason: "limit" });
    expect(urls()).not.toContain("https://example.org/3");
  });

  it("answers a repeated request from memory without spending the limit", async () => {
    const { pages, urls } = setup({ "https://example.org/": () => html("x") }, 1);
    await pages.fetchPage("https://example.org/1");
    await expect(pages.fetchPage("https://example.org/1")).resolves.toMatchObject({ ok: true });
    expect(urls().filter((url) => url === "https://example.org/1")).toHaveLength(1);
  });

  it("reports an error status as a failed page", async () => {
    const { pages } = setup({});
    await expect(pages.fetchPage("https://example.org/gone")).resolves.toEqual({ ok: false, reason: "http", detail: "HTTP status 404" });
  });

  it("reports a response that is not a document", async () => {
    const { pages } = setup({
      "https://example.org/file.pdf": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
    });
    await expect(pages.fetchPage("https://example.org/file.pdf")).resolves.toMatchObject({ ok: false, reason: "not-html" });
  });
});
