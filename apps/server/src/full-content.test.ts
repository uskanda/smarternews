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

describe("the content selector of a feed", () => {
  const COMMENT = "A comment below the article that is not part of it at all. ".repeat(12);
  const storyPage = () =>
    new Response(
      `<html><head><title>a</title></head><body><article><h1>a</h1><div class="story"><p>${LONG}</p></div>` +
        `<p>${COMMENT}</p><p>${COMMENT}</p></article></body></html>`,
      { headers: { "content-type": "text/html" } },
    );

  it("is listed, changed and taken away, and a value that is not a CSS selector is refused", async () => {
    const s = testServer();
    s.site.set(FEED, rss([]));
    const created = await (await s.post("/api/v1/feeds", { url: FEED, contentSelector: "article .body" })).json();
    expect(created.contentSelector).toBe("article .body");

    expect((await (await s.patch(`/api/v1/feeds/${created.id}`, { contentSelector: "main" })).json()).contentSelector).toBe("main");
    const invalid = await s.patch(`/api/v1/feeds/${created.id}`, { contentSelector: "div[" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.fields).toEqual([{ path: "contentSelector", message: "not a CSS selector", code: "format" }]);
    const unusable = await s.patch(`/api/v1/feeds/${created.id}`, { contentSelector: "div:frobnicate" });
    expect(unusable.status).toBe(400);
    expect((await unusable.json()).error.fields).toEqual([expect.objectContaining({ path: "contentSelector", code: "format" })]);

    await s.patch(`/api/v1/feeds/${created.id}`, { contentSelector: null });
    expect(await (await s.get("/api/v1/feeds")).json()).toEqual([expect.objectContaining({ id: created.id, contentSelector: null })]);
  });

  it("takes the full content of the unread articles again by the new selector once it changes, without waiting for the next look", async () => {
    const s = testServer();
    s.site.set("https://blog.example.org/a", storyPage);
    const { feed, id } = await delivered(s, { fetchFullContent: true });
    s.fullContent.tick();
    await s.fullContent.idle();
    expect((await (await s.get(`/api/v1/articles/${id}`)).json()).fullContent.body).toContain("A comment below");

    expect((await s.patch(`/api/v1/feeds/${feed.id}`, { contentSelector: ".story" })).status).toBe(200);
    await s.fullContent.idle();

    const article = await (await s.get(`/api/v1/articles/${id}`)).json();
    expect(article.fullContentStatus).toBe("fetched");
    expect(article.fullContent.body).toContain("A sentence of the page");
    expect(article.fullContent.body).not.toContain("A comment below");
  });

  it("previews the selector on the page of the feed's newest article and stores nothing", async () => {
    const s = testServer();
    s.site.set("https://blog.example.org/a", storyPage);
    const { feed, id } = await delivered(s);

    const response = await s.post(`/api/v1/feeds/${feed.id}/content-preview`, { contentSelector: ".story" });
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview).toMatchObject({ status: "ok", article: { id, title: "a", url: "https://blog.example.org/a" }, matched: true, shorter: false });
    expect(preview.markdown).toContain("A sentence of the page");
    expect(preview.markdown).not.toContain("A comment below");
    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({ fullContent: null, fullContentStatus: "none" });

    expect(await (await s.post(`/api/v1/feeds/${feed.id}/content-preview`, { contentSelector: ".missing" })).json()).toMatchObject({ status: "ok", matched: false });
  });

  it("answers why a preview has nothing to show, and refuses a selector and a feed it cannot use", async () => {
    const s = testServer();
    s.site.set(FEED, rss([]));
    const empty = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    expect(await (await s.post(`/api/v1/feeds/${empty.id}/content-preview`, { contentSelector: ".story" })).json()).toEqual({ status: "no-article" });

    const invalid = await s.post(`/api/v1/feeds/${empty.id}/content-preview`, { contentSelector: "div[" });
    expect(invalid.status).toBe(400);
    expect((await s.post("/api/v1/feeds/999/content-preview", { contentSelector: ".story" })).status).toBe(404);
  });

  it("previews a page that cannot be read with the reason full content gives", async () => {
    const s = testServer();
    const { feed, id } = await delivered(s);
    expect(await (await s.post(`/api/v1/feeds/${feed.id}/content-preview`, { contentSelector: null })).json()).toEqual({
      status: "failed",
      article: { id, title: "a", url: "https://blog.example.org/a" },
      error: { reason: "http", detail: "404" },
    });
  });
});
