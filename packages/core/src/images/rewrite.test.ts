import { describe, expect, it } from "vitest";
import { relayMarkdownImages } from "./rewrite.ts";
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
