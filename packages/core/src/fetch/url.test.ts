import { describe, expect, it } from "vitest";
import { candidateHost, normalizeHost, normalizeTitle, normalizeUrl, siteHost } from "./url.ts";

describe("siteHost", () => {
  it("lowercases the host and takes off a leading www. only", () => {
    expect(siteHost("https://WWW.Example.org/a?b=1")).toBe("example.org");
    expect(siteHost("http://example.org.:8080/")).toBe("example.org");
    expect(siteHost("https://www2.example.org/")).toBe("www2.example.org");
  });

  it("keeps subdomains apart", () => {
    expect(siteHost("https://blog.example.org/a")).toBe("blog.example.org");
    expect(siteHost("https://www.blog.example.org/a")).toBe("blog.example.org");
  });

  it("gives nothing for what is not a URL", () => {
    expect(siteHost("not a url")).toBe("");
    expect(siteHost("")).toBe("");
  });
});

describe("candidateHost", () => {
  it("is the host of the URL", () => {
    expect(candidateHost("https://www.example.org/a", "https://other.example.net")).toBe("example.org");
  });

  it("is the host of the outlet when the URL is still a Google News redirect", () => {
    expect(candidateHost("https://news.google.com/rss/articles/abc", "https://Times.Example.org")).toBe("times.example.org");
    expect(candidateHost("https://news.google.com/rss/articles/abc", null)).toBe("");
    expect(candidateHost("https://news.google.com/rss/articles/abc", "")).toBe("");
  });
});

describe("normalizeHost", () => {
  it("brings a host written by hand to the form of a candidate's", () => {
    expect(normalizeHost(" WWW.Example.org ")).toBe("example.org");
    expect(normalizeHost("blog.example.org")).toBe("blog.example.org");
    expect(normalizeHost("xn--r8jz45g.jp")).toBe("xn--r8jz45g.jp");
  });

  it("gives null for what is not a host", () => {
    for (const value of ["", "a b", "user@example.org", "example.org/a", "example.org:80", "."]) expect(normalizeHost(value)).toBeNull();
  });
});

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
