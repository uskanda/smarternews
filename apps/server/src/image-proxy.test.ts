import { getArticle, insertFeed, IMAGE_PROXY_PATH, saveArticleTranslation, saveFullContent } from "@smarternews/core";
import { imageResponse, jpegBytes, pngBytes, seedFeedArticle } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { relayPath, testServer } from "./testing.ts";

type Server = ReturnType<typeof testServer>;

/** A feed article with the given content. */
function feedArticle(s: Server, body: string, url: string | null = null): number {
  const feed = insertFeed(s.db, { url: "https://blog.example.org/feed.xml", title: "Blog", categoryId: null }, s.clock);
  return seedFeedArticle(s.db, feed.id, { title: "Pictures", body, url });
}

/** The relay paths of a Markdown text, with the original URL each stands for. */
function relayed(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]!);
}

const original = (path: string) => Buffer.from(path.slice(IMAGE_PROXY_PATH.length).split("/")[1]!, "base64url").toString("utf8");

describe("the relay of an image", () => {
  it("answers an image over plain HTTP without a token, with the format of its bytes and headers that keep it an image", async () => {
    const s = testServer();
    s.site.set("http://img.example.org/a.png", () => imageResponse(pngBytes(200), "text/html"));
    const response = await s.get(relayPath("http://img.example.org/a.png"), null);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cache-control")).toBe(`private, max-age=${7 * 86_400}`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes(200));
  });

  it("answers 403 and asks no site when the original URL was replaced, or the signature is missing or wrong", async () => {
    const s = testServer();
    s.site.set("https://img.example.org/", () => imageResponse(pngBytes()));
    const [, , , , , signature, encoded] = relayPath("https://img.example.org/a.png").split("/");
    const other = relayPath("https://img.example.org/b.png").split("/")[6]!;
    for (const path of [
      `${IMAGE_PROXY_PATH}${signature}/${other}`,
      `${IMAGE_PROXY_PATH}/${encoded}`,
      `${IMAGE_PROXY_PATH}${"A".repeat(43)}/${encoded}`,
      `${IMAGE_PROXY_PATH}${signature}/${encoded}!`,
      `${IMAGE_PROXY_PATH}${signature}`,
      `${IMAGE_PROXY_PATH}${signature}/${encoded}/more`,
    ]) {
      const response = await s.get(path, null);
      expect(response.status, path).toBe(403);
    }
    expect(s.site.requests).toHaveLength(0);
  });

  it("answers 502 when the image cannot be had, and nothing of what the site sent", async () => {
    const s = testServer();
    s.site.set("https://img.example.org/page.png", () => imageResponse(new TextEncoder().encode("<html>secret</html>"), "image/png"));
    s.site.set("https://img.example.org/a.svg", () => imageResponse(new TextEncoder().encode("<svg/>"), "image/svg+xml"));
    s.site.set("https://img.example.org/away.png", () => new Response(null, { status: 302, headers: { location: "http://192.168.1.1/a.png" } }));
    for (const url of [
      "https://img.example.org/missing.png",
      "https://img.example.org/page.png",
      "https://img.example.org/a.svg",
      "https://img.example.org/away.png",
      "http://127.0.0.1/a.png",
    ]) {
      const response = await s.get(relayPath(url), null);
      expect(response.status, url).toBe(502);
      expect(await response.text()).not.toMatch(/secret|svg/);
    }
    expect(s.site.requests.map((request) => request.url).some((url) => url.includes("127.0.0.1") || url.includes("192.168"))).toBe(false);
  });

  it("answers 502 when the site does not answer in time", async () => {
    const s = testServer();
    s.site.set("https://img.example.org/slow.png", () => "hang" as unknown as Response);
    expect((await s.get(relayPath("https://img.example.org/slow.png"), null)).status).toBe(502);
  });

  it("answers an image the second time from disk, and an old URL as long as the key is the same", async () => {
    const s = testServer();
    s.site.set("https://img.example.org/a.jpg", () => imageResponse(jpegBytes()));
    const path = relayPath("https://img.example.org/a.jpg");
    expect((await s.get(path, null)).status).toBe(200);
    s.clock.advance(86_400_000);
    const again = await s.get(path, null);
    expect(again.headers.get("content-type")).toBe("image/jpeg");
    expect(s.site.requests).toHaveLength(1);
    s.clock.advance(29 * 86_400_000);
    expect((await s.get(path, null)).status).toBe(200);
  });

  it("passes on nothing the device sent: no cookie, no referrer, no address", async () => {
    const s = testServer();
    s.site.set("https://img.example.org/a.png", () => imageResponse(pngBytes()));
    const response = await s.app.request(relayPath("https://img.example.org/a.png"), {
      headers: {
        cookie: "session=abc",
        referer: "https://reader.example/c/tools/1",
        "x-forwarded-for": "203.0.113.7",
        "x-real-ip": "203.0.113.7",
        forwarded: "for=203.0.113.7",
        "user-agent": "DeviceBrowser/1",
      },
    });
    expect(response.status).toBe(200);
    const sent = s.site.requests[0]!.headers;
    expect(Object.keys(sent).sort()).toEqual(["accept", "user-agent"]);
    expect(sent["user-agent"]).toBe("test");
    expect(JSON.stringify(sent)).not.toMatch(/abc|reader\.example|203\.0\.113\.7|DeviceBrowser/);
  });

  it("keeps the token on every other path", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/articles", null)).status).toBe(401);
    expect((await s.get("/api/v1/image-proxyx/a/b", null)).status).toBe(401);
  });
});

describe("images in the answers of the API", () => {
  const BODY = "Before ![A chart](https://img.example.org/a.png) and ![Plain](http://img.example.org/b.png) and ![Bracketed](<https://img.example.org/c d.png>)";

  it("name the relay in the content of a feed article, while the stored content keeps the originals", async () => {
    const s = testServer();
    const id = feedArticle(s, BODY);
    const article = await (await s.get(`/api/v1/articles/${id}`)).json();
    const paths = relayed(article.body);
    expect(paths).toHaveLength(3);
    expect(paths.every((path) => path.startsWith(IMAGE_PROXY_PATH))).toBe(true);
    expect(paths.map(original)).toEqual(["https://img.example.org/a.png", "http://img.example.org/b.png", "https://img.example.org/c d.png"]);
    expect(article.bodyHtml).toContain(`<img src="${paths[0]}"`);
    expect(article.bodyHtml).not.toMatch(/img\.example\.org/);
    expect(getArticle(s.db, id).body).toBe(BODY);
    // An answer to a change of the article names the relay too.
    const patched = await (await s.patch(`/api/v1/articles/${id}`, { starred: true })).json();
    expect(relayed(patched.body)).toEqual(paths);
  });

  it("name the relay in the full content and in a translation", async () => {
    const s = testServer();
    const id = feedArticle(s, "Short.");
    saveFullContent(s.db, id, { markdown: "Full.\n\n![Full](http://img.example.org/full.png)", text: "Full.", now: s.clock().toISOString() });
    saveArticleTranslation(s.db, id, {
      segments: [
        { original: "![Pic](https://img.example.org/p.png)", translated: null },
        { original: "See ![Pic](https://img.example.org/q.png)", translated: "見て ![図](https://img.example.org/q.png)" },
      ],
      method: "google",
      truncated: false,
      now: s.clock().toISOString(),
    });
    const article = await (await s.get(`/api/v1/articles/${id}`)).json();
    expect(relayed(article.fullContent.body).map(original)).toEqual(["http://img.example.org/full.png"]);
    expect(article.fullContent.bodyHtml).toContain(`<img src="${IMAGE_PROXY_PATH}`);
    const [first, second] = article.translation.segments;
    expect(relayed(first.original).map(original)).toEqual(["https://img.example.org/p.png"]);
    expect(relayed(second.translated).map(original)).toEqual(["https://img.example.org/q.png"]);
    expect(second.translatedHtml).toContain(`<img src="${IMAGE_PROXY_PATH}`);
    expect(JSON.stringify(article)).not.toMatch(/\]\(<?https?:\/\/img\.example\.org/);
  });

  it("name the relay in the answers that translate and that fetch the full content", async () => {
    const s = testServer();
    const id = feedArticle(s, "Text ![Pic](https://img.example.org/p.png)", "https://blog.example.org/pictures");
    s.db.prepare("UPDATE feeds SET translate = 1").run();
    const translation = await (await s.post(`/api/v1/articles/${id}/translation`)).json();
    expect(JSON.stringify(translation)).toContain(IMAGE_PROXY_PATH);
    expect(JSON.stringify(translation)).not.toMatch(/\]\(https:\/\/img\.example\.org/);

    const LONG = "A sentence of the page that the full content is taken from. ".repeat(8);
    s.site.set("https://blog.example.org/pictures", () =>
      new Response(`<html><body><article><p>${LONG}</p><p><img src="http://img.example.org/f.png" alt="F"></p><p>${LONG}</p></article></body></html>`, {
        headers: { "content-type": "text/html" },
      }),
    );
    const result = await (await s.post(`/api/v1/articles/${id}/full-content`)).json();
    expect(result.status).toBe("fetched");
    expect(relayed(result.fullContent.body).map(original)).toEqual(["http://img.example.org/f.png"]);
  });

  it("leave the body of a generated article alone", async () => {
    const s = testServer();
    const id = s.article(s.category().id, { body: "Model wrote ![x](https://img.example.org/x.png)" });
    const article = await (await s.get(`/api/v1/articles/${id}`)).json();
    expect(article.body).toBe("Model wrote ![x](https://img.example.org/x.png)");
    expect(JSON.stringify(article)).not.toContain(IMAGE_PROXY_PATH);
    expect(article.bodyHtml).not.toContain("<img");
  });

  it("never carry the signing key", async () => {
    const s = testServer();
    const id = feedArticle(s, BODY);
    const answers = [
      await (await s.get(`/api/v1/articles/${id}`)).text(),
      await (await s.get("/api/v1/settings")).text(),
      await (await s.get("/api/v1/settings/export")).text(),
    ].join("\n");
    for (const form of [Buffer.from(s.imageKey).toString("base64url"), Buffer.from(s.imageKey).toString("hex"), Buffer.from(s.imageKey).toString("base64")]) {
      expect(answers).not.toContain(form);
    }
  });
});
