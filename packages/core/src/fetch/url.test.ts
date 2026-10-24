import { describe, expect, it } from "vitest";
import { normalizeTitle, normalizeUrl } from "./url.ts";

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

describe("normalizeTitle", () => {
  it("ignores width, case, white space and punctuation", () => {
    const plain = normalizeTitle("Example社が新しい端末を発表");
    expect(plain).toBe("example社が新しい端末を発表");
    expect(normalizeTitle("ＥＸＡＭＰＬＥ社が 新しい端末を発表！")).toBe(plain);
    expect(normalizeTitle("  Example社が、新しい端末を「発表」 ")).toBe(plain);
  });

  it("ignores symbols", () => {
    expect(normalizeTitle("Rust 2.0 — released! ★")).toBe(normalizeTitle("rust 2.0 released"));
  });

  it("returns null when fewer than ten characters remain", () => {
    expect(normalizeTitle("お知らせ")).toBeNull();
    expect(normalizeTitle("Ａ ｂ c! d? e. f, g; h: i")).toBeNull();
    expect(normalizeTitle("abcdefghij")).toBe("abcdefghij");
  });

  it("counts characters outside the basic plane once", () => {
    expect(normalizeTitle("𠮷野家の新メニュー発表会")).toBe("𠮷野家の新メニュー発表会");
    expect(normalizeTitle("𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷")).toBeNull();
  });
});
