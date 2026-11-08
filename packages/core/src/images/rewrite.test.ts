import { describe, expect, it } from "vitest";
import type { Article, ArticleAttachment } from "../api.ts";
import { relayArticleImages, relayMarkdownImages } from "./rewrite.ts";
import { imageProxyPath } from "./sign.ts";

const key = new Uint8Array(32).fill(3);
const relay = (url: string) => imageProxyPath(key, url);

describe("relayMarkdownImages", () => {
  it("puts the relay in place of the URL of every image over HTTP and HTTPS", () => {
    const markdown = "Text ![A chart](https://img.example.org/a.png) and ![Plain](http://img.example.org/b.png?x=1&y=%28z%29)";
    expect(relayMarkdownImages(markdown, key)).toBe(
      `Text ![A chart](${relay("https://img.example.org/a.png")}) and ![Plain](${relay("http://img.example.org/b.png?x=1&y=%28z%29")})`,
    );
  });

  it("reads an address in angle brackets, and keeps an escaped description as it is", () => {
    expect(relayMarkdownImages("![A \\[1\\] \\*b\\*](<https://img.example.org/a b.png>)", key)).toBe(
      `![A \\[1\\] \\*b\\*](${relay("https://img.example.org/a b.png")})`,
    );
  });

  it("leaves links, other schemes and what only looks like an image alone", () => {
    const markdown = "[link](https://example.org/a) ![data](data:image/png;base64,AAAA) !\\[not\\](https://img.example.org/n.png) ![rel](/a.png)";
    expect(relayMarkdownImages(markdown, key)).toBe(markdown);
  });

  it("does not relay a relay path again", () => {
    const once = relayMarkdownImages("![a](https://img.example.org/a.png)", key);
    expect(relayMarkdownImages(once, key)).toBe(once);
  });
});

describe("relayArticleImages", () => {
  const attachment = (url: string, kind: ArticleAttachment["kind"]): ArticleAttachment => ({
    url,
    kind,
    mimeType: null,
    size: null,
    title: null,
    thumbnailOf: null,
    imageUrl: null,
  });
  // Only what the relay reads; the rest of an article plays no part here.
  const article = (origin: Article["origin"], attachments: ArticleAttachment[]) =>
    ({ origin, body: "", bodyHtml: "", fullContent: null, translation: null, attachments }) as unknown as Article;

  it("loads the image attachments of a feed article through the relay, and leaves the others to be linked", () => {
    const relayed = relayArticleImages(
      article("feed", [
        attachment("http://img.example.org/cover.jpg", "image"),
        attachment("https://cdn.example.org/ep.mp3", "audio"),
        attachment("https://cdn.example.org/ep.mp4", "video"),
      ]),
      key,
    );
    expect(relayed.attachments).toEqual([
      { ...attachment("http://img.example.org/cover.jpg", "image"), imageUrl: relay("http://img.example.org/cover.jpg") },
      attachment("https://cdn.example.org/ep.mp3", "audio"),
      attachment("https://cdn.example.org/ep.mp4", "video"),
    ]);
  });

  it("loads nothing for an article that is not a feed article", () => {
    const generated = article("generated", [attachment("https://img.example.org/a.jpg", "image")]);
    expect(relayArticleImages(generated, key).attachments[0]!.imageUrl).toBeNull();
  });
});
