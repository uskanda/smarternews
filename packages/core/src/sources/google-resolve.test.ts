import { describe, expect, it } from "vitest";
import { Fetcher } from "../fetch/http.ts";
import { fakeFetch, html } from "../testing/http.ts";
import { resolveGoogleNewsUrl } from "./google-resolve.ts";

const ARTICLE = "https://news.google.com/rss/articles/AAA111";
const BATCH = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 100000, fetchImpl: fake.fetchImpl });
  return { fetcher, ...fake };
}

const page = () => html('<div data-n-a-sg="SIG-A" data-n-a-ts="1700000000"></div>');

describe("resolveGoogleNewsUrl", () => {
  it("asks for the original URL with the article's signature and returns it", async () => {
    const { fetcher, requests } = setup({
      [ARTICLE]: page,
      [BATCH]: () => new Response(`)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://example.org/story\\",1]"]]`),
    });
    await expect(resolveGoogleNewsUrl(fetcher, `${ARTICLE}?oc=5`)).resolves.toBe("https://example.org/story");
    const body = decodeURIComponent(requests[1]!.body ?? "");
    expect(requests[1]!.method).toBe("POST");
    expect(body).toContain("AAA111");
    expect(body).toContain("SIG-A");
    expect(body).toContain("1700000000");
  });

  it("gives null when the article page carries no signature", async () => {
    const { fetcher, urls } = setup({ [ARTICLE]: () => html("<p>consent</p>") });
    await expect(resolveGoogleNewsUrl(fetcher, ARTICLE)).resolves.toBeNull();
    expect(urls()).toEqual([ARTICLE]);
  });

  it("gives null when the answer holds no URL", async () => {
    const { fetcher } = setup({ [ARTICLE]: page, [BATCH]: () => new Response(")]}'\n\n[]") });
    await expect(resolveGoogleNewsUrl(fetcher, ARTICLE)).resolves.toBeNull();
  });

  it("gives null when a request fails", async () => {
    const { fetcher } = setup({ [ARTICLE]: page, [BATCH]: () => new Response("no", { status: 429 }) });
    await expect(resolveGoogleNewsUrl(fetcher, ARTICLE)).resolves.toBeNull();
  });

  it("gives null for a link that is not a Google News article", async () => {
    const { fetcher, urls } = setup({});
    await expect(resolveGoogleNewsUrl(fetcher, "https://example.org/x")).resolves.toBeNull();
    expect(urls()).toEqual([]);
  });
});
