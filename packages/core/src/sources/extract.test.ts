import { describe, expect, it } from "vitest";
import { extractArticle } from "./extract.ts";

const page = (head: string, body: string) => `<!doctype html><html><head><title>Site | Vendor ships fix</title>${head}</head><body>${body}</body></html>`;

const ARTICLE_BODY = `
<nav><a href="/">Home</a><a href="/news">News</a><a href="/about">About us</a></nav>
<article>
  <h1>Vendor ships fix</h1>
  <p>The vendor released a patch on Sunday for a flaw that attackers had been using for two weeks, according to its advisory.</p>
  <p>Administrators are asked to install the update as soon as possible because the flaw allows remote code execution without a login.</p>
  <p>The company said that it found no sign of customer data being taken, and that an investigation continues with outside help.</p>
</article>
<footer>Copyright Example. All rights reserved. Privacy policy. Terms of use.</footer>`;

describe("extractArticle", () => {
  it("returns the article text without the navigation and footer", () => {
    const { text } = extractArticle(page("", ARTICLE_BODY), "https://example.org/a");
    expect(text).toContain("released a patch on Sunday");
    expect(text).toContain("investigation continues");
    expect(text).not.toContain("About us");
    expect(text).not.toContain("Privacy policy");
  });

  it("reads the publication time from the article metadata", () => {
    const head = '<meta property="article:published_time" content="2026-03-01T09:00:00+09:00">';
    expect(extractArticle(page(head, ARTICLE_BODY), "https://example.org/a").publishedAt).toEqual(new Date("2026-03-01T00:00:00Z"));
  });

  it("reads the publication time from JSON-LD", () => {
    const head = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","datePublished":"2026-03-01T08:30:00Z"}]}</script>`;
    expect(extractArticle(page(head, ARTICLE_BODY), "https://example.org/a").publishedAt).toEqual(new Date("2026-03-01T08:30:00Z"));
  });

  it("reads the publication time from a time element", () => {
    const body = ARTICLE_BODY.replace("<h1>", '<time datetime="2026-02-27T12:00:00Z">Feb 27</time><h1>');
    expect(extractArticle(page("", body), "https://example.org/a").publishedAt).toEqual(new Date("2026-02-27T12:00:00Z"));
  });

  it("gives no publication time when the page states none", () => {
    expect(extractArticle(page("", ARTICLE_BODY), "https://example.org/a").publishedAt).toBeNull();
  });

  it("ignores a date it cannot parse", () => {
    const head = '<meta property="article:published_time" content="yesterday">';
    expect(extractArticle(page(head, ARTICLE_BODY), "https://example.org/a").publishedAt).toBeNull();
  });

  it("gives empty text for a page without readable content", () => {
    expect(extractArticle("<html><body><script>app()</script></body></html>", "https://example.org/a").text).toBe("");
  });

  it("cuts very long text at the limit", () => {
    const long = `<article>${"<p>The quick brown fox jumps over the lazy dog near the quiet river bank today.</p>".repeat(400)}</article>`;
    expect(extractArticle(page("", long), "https://example.org/a", 1000).text.length).toBeLessThanOrEqual(1000);
  });

  it("returns the page title", () => {
    expect(extractArticle(page("", ARTICLE_BODY), "https://example.org/a").title).toContain("Vendor ships fix");
  });
});
