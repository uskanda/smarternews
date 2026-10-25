import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const FEED = "https://blog.example.org/feed.xml";
const HOUR = 3_600_000;
const LONG = "A sentence of the page that the full content is taken from. ".repeat(8);

function rss(items: string[]): string {
  const body = items
    .map(
      (key) =>
        `<item><title>${key}</title><guid>${key}</guid><link>https://blog.example.org/${key}</link>` +
        `<description>&lt;p&gt;About ${key}.&lt;/p&gt;</description><pubDate>${new Date("2026-03-01T11:00:00.000Z").toUTCString()}</pubDate></item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Blog</title><link>https://blog.example.org/</link>${body}</channel></rss>`;
}

const page = () =>
  new Response(`<html><head><title>a</title></head><body><article><h1>a</h1><p>${LONG}</p><p>${LONG}</p></article></body></html>`, {
    headers: { "content-type": "text/html" },
  });

/** A feed with the given settings, and one article it delivered after it was registered. */
async function delivered(s: ReturnType<typeof testServer>, settings: { fetchFullContent?: boolean; autoSummarize?: boolean } = {}) {
  s.site.set(FEED, rss([]));
  const feed = await (await s.post("/api/v1/feeds", { url: FEED, ...settings })).json();
  s.clock.advance(HOUR);
  s.site.set(FEED, rss(["a"]));
  await s.post(`/api/v1/feeds/${feed.id}/fetch`);
  const list = await (await s.get(`/api/v1/articles?feed=${feed.id}`)).json();
  return { feed, id: list.items[0].id as number };
}

const pageRequests = (s: ReturnType<typeof testServer>) =>
  s.site.requests.map((request) => request.url).filter((url) => url !== FEED && !url.endsWith("/robots.txt"));

describe("full content fetching of a subscribed feed", () => {
  it("is off for a feed registered without saying so, and can be switched on at registration and by a change", async () => {
    const s = testServer();
    s.site.set(FEED, rss(["a"]));
    const created = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    expect(created.fetchFullContent).toBe(false);

    const changed = await s.patch(`/api/v1/feeds/${created.id}`, { fetchFullContent: true });
    expect(changed.status).toBe(200);
    expect(await (await s.get("/api/v1/feeds")).json()).toEqual([expect.objectContaining({ id: created.id, fetchFullContent: true })]);

    expect((await s.patch(`/api/v1/feeds/${created.id}`, { fetchFullContent: "yes" })).status).toBe(400);
    await s.patch(`/api/v1/feeds/${created.id}`, { fetchFullContent: false });
    expect((await (await s.get(`/api/v1/feeds/${created.id}`)).json()).fetchFullContent).toBe(false);
  });

  it("can be switched on at registration", async () => {
    const s = testServer();
    s.site.set(FEED, rss(["a"]));
    const created = await s.post("/api/v1/feeds", { url: FEED, fetchFullContent: true });
    expect(created.status).toBe(201);
    expect((await created.json()).fetchFullContent).toBe(true);
  });
});

describe("the full content in the detail of an article", () => {
  it("says that a feed article just delivered by a feed that fetches full content waits for it", async () => {
    const s = testServer();
    const { id } = await delivered(s, { fetchFullContent: true });
    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({ fullContent: null, fullContentStatus: "waiting", fullContentError: null });
  });

  it("gives the full content apart from the delivered content once it is fetched", async () => {
    const s = testServer();
    s.site.set("https://blog.example.org/a", page);
    const { id } = await delivered(s, { fetchFullContent: true });
    s.fullContent.tick();
    await s.fullContent.idle();

    const article = await (await s.get(`/api/v1/articles/${id}`)).json();
    expect(article.body).toBe("About a.");
    expect(article.fullContentStatus).toBe("fetched");
    expect(article.fullContent).toEqual({
      body: expect.stringContaining("A sentence of the page"),
      bodyHtml: expect.stringContaining("<p>A sentence of the page"),
      fetchedAt: s.clock().toISOString(),
    });
    expect(article.fullContentError).toBeNull();
  });

  it("says why it failed for a page that is not there", async () => {
    const s = testServer();
    const { id } = await delivered(s, { fetchFullContent: true });
    s.fullContent.tick();
    await s.fullContent.idle();

    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({
      body: "About a.",
      fullContent: null,
      fullContentStatus: "failed",
      fullContentError: { reason: "http", detail: "404" },
    });
  });

  it("has none on a feed article of a feed without the setting, and on a generated article", async () => {
    const s = testServer();
    const { id } = await delivered(s);
    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({ fullContent: null, fullContentStatus: "none", fullContentError: null });
    const generated = s.article(s.category().id);
    expect(await (await s.get(`/api/v1/articles/${generated}`)).json()).toMatchObject({ fullContent: null, fullContentStatus: "none", fullContentError: null });
  });
});

describe("POST /api/v1/articles/:id/full-content", () => {
  it("fetches the full content of an article of a feed without the setting, and answers with it", async () => {
    const s = testServer();
    s.site.set("https://blog.example.org/a", page);
    const { id } = await delivered(s);

    const response = await s.post(`/api/v1/articles/${id}/full-content`);

    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(answer).toEqual({
      status: "fetched",
      fullContent: { body: expect.stringContaining("A sentence"), bodyHtml: expect.stringContaining("<p>"), fetchedAt: s.clock().toISOString() },
    });
    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({ fullContentStatus: "fetched", fullContent: answer.fullContent });
  });

  it("answers with what is stored, without fetching the page again", async () => {
    const s = testServer();
    s.site.set("https://blog.example.org/a", page);
    const { id } = await delivered(s);
    const first = await (await s.post(`/api/v1/articles/${id}/full-content`)).json();
    const requests = pageRequests(s).length;

    expect(await (await s.post(`/api/v1/articles/${id}/full-content`)).json()).toEqual(first);
    expect(pageRequests(s)).toHaveLength(requests);
  });

  it("answers with the failure and its reason, and leaves the content as it was", async () => {
    const s = testServer();
    s.site.set("https://blog.example.org/robots.txt", () => new Response("User-agent: *\nDisallow: /", { headers: { "content-type": "text/plain" } }));
    const { id } = await delivered(s);

    const response = await s.post(`/api/v1/articles/${id}/full-content`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "failed", error: { reason: "robots", detail: null } });
    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({ body: "About a.", fullContent: null, fullContentStatus: "failed" });
    expect(pageRequests(s)).toEqual([]);
  });

  it("fetches again an article whose fetch failed", async () => {
    const s = testServer();
    const { id } = await delivered(s);
    expect((await (await s.post(`/api/v1/articles/${id}/full-content`)).json()).status).toBe("failed");
    s.site.set("https://blog.example.org/a", page);
    expect((await (await s.post(`/api/v1/articles/${id}/full-content`)).json()).status).toBe("fetched");
  });

  it("refuses a generated article with 400, and answers 404 for one that does not exist", async () => {
    const s = testServer();
    const generated = s.article(s.category().id);
    const refused = await s.post(`/api/v1/articles/${generated}/full-content`);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe("invalid_input");
    expect((await s.post("/api/v1/articles/9999/full-content")).status).toBe(404);
  });

  it("needs the token", async () => {
    const s = testServer();
    expect((await s.post("/api/v1/articles/1/full-content", undefined, null)).status).toBe(401);
  });
});

describe("a feed that fetches full content and summarises", () => {
  it("requests the page of a new article once, and stores both its full content and its summary", async () => {
    const s = testServer(undefined, { summarize: () => ({ summary: "What the page says." }) });
    s.site.set("https://blog.example.org/a", page);
    const { id } = await delivered(s, { fetchFullContent: true, autoSummarize: true });

    s.summarizer.tick();
    s.fullContent.tick();
    await Promise.all([s.summarizer.idle(), s.fullContent.idle()]);

    expect(pageRequests(s)).toEqual(["https://blog.example.org/a"]);
    const article = await (await s.get(`/api/v1/articles/${id}`)).json();
    expect(article.fullContent.body).toContain("A sentence of the page");
    expect(article.autoSummary).toMatchObject({ text: "What the page says.", source: "page" });
    expect(s.llmRequests.summarize[0]!.prompt).toContain("A sentence of the page");
  });
});
