import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url.ts";

describe("normalizeUrl", () => {
  it("drops tracking parameters, so two links that differ only in them are equal", () => {
    const a = normalizeUrl("https://example.org/post?id=7&utm_source=feed&utm_medium=rss");
    const b = normalizeUrl("https://example.org/post?utm_source=mail&id=7");
    expect(a).toBe("https://example.org/post?id=7");
    expect(b).toBe(a);
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://example.org/post#comments")).toBe("https://example.org/post");
  });

  it("keeps parameters that select content", () => {
    expect(normalizeUrl("https://example.org/list?page=2&q=rust")).toBe("https://example.org/list?page=2&q=rust");
  });

  it("lowercases the host and removes click identifiers", () => {
    expect(normalizeUrl("https://Example.ORG/Path?fbclid=abc&gclid=def")).toBe("https://example.org/Path");
  });

  it("returns text that is not a URL unchanged", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});
