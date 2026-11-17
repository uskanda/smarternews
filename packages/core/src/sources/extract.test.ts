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

  it("returns the HTML of the article body, with its paragraphs, apart from the text, which stays as it was", () => {
    const extracted = extractArticle(page("", ARTICLE_BODY), "https://example.org/a");
    expect(extracted.html).toMatch(/<p>The vendor released a patch on Sunday/);
    expect(extracted.html).toContain("</p>");
    expect(extracted.html).not.toContain("About us");
    expect(extracted.text).toBe(
      "The vendor released a patch on Sunday for a flaw that attackers had been using for two weeks, according to its advisory. " +
        "Administrators are asked to install the update as soon as possible because the flaw allows remote code execution without a login. " +
        "The company said that it found no sign of customer data being taken, and that an investigation continues with outside help.",
    );
  });

  it("gives empty HTML for a page without readable content", () => {
    expect(extractArticle("<html><body><script>app()</script></body></html>", "https://example.org/a").html).toBe("");
  });
});

describe("extractArticle with a content selector", () => {
  const STORY = "The council approved the new budget on Monday after a long debate about the cost of repairs to the old bridge.";
  const RELATED = "Read also: ten other stories about bridges, budgets and councils from the archive of this site.";
  const SECOND = "A second block that the selector also matches, further down the page.";
  const body = `
<article>
  <div class="story"><p>${STORY}</p></div>
  <section class="related"><p>${RELATED}</p><p>${RELATED}</p><p>${RELATED}</p></section>
  <div class="story"><p>${SECOND}</p></div>
</article>`;

  it("takes the first element the selector matches instead of what Readability finds", () => {
    const extracted = extractArticle(page("", body), "https://example.org/a", 8000, ".story");
    expect(extracted.matched).toBe(true);
    expect(extracted.text).toBe(STORY);
    expect(extracted.html).toContain(`<p>${STORY}</p>`);
    expect(extracted.html).not.toContain("Read also");
    expect(extracted.html).not.toContain(SECOND);
  });

  it("takes an element once when the elements it matches are nested", () => {
    const nested = `<div class="part"><p>${STORY}</p><div class="part"><p>${SECOND}</p></div></div>`;
    const extracted = extractArticle(page("", nested), "https://example.org/a", 8000, ".part");
    expect(extracted.text.split(STORY)).toHaveLength(2);
    expect(extracted.text.split(SECOND)).toHaveLength(2);
    expect(extracted.html.split(SECOND)).toHaveLength(2);
  });

  it("keeps the title and the publication time it reads without a selector", () => {
    const head = '<meta property="article:published_time" content="2026-03-01T09:00:00Z">';
    const extracted = extractArticle(page(head, ARTICLE_BODY), "https://example.org/a", 8000, "article p");
    expect(extracted.publishedAt).toEqual(new Date("2026-03-01T09:00:00Z"));
    expect(extracted.title).toContain("Vendor ships fix");
  });

  it("cuts the text at the limit, not the HTML", () => {
    const extracted = extractArticle(page("", body), "https://example.org/a", 20, ".story");
    expect(extracted.text).toHaveLength(20);
    expect(extracted.html).toContain(STORY);
  });

  it("falls back to Readability when nothing matches", () => {
    const without = extractArticle(page("", ARTICLE_BODY), "https://example.org/a");
    const extracted = extractArticle(page("", ARTICLE_BODY), "https://example.org/a", 8000, ".missing");
    expect(extracted.matched).toBe(false);
    expect(extracted.text).toBe(without.text);
    expect(extracted.html).toBe(without.html);
  });

  it("falls back to Readability when the element it matches has no text", () => {
    const empty = `${ARTICLE_BODY}<div class="story"><img src="https://example.org/a.png"></div>`;
    const extracted = extractArticle(page("", empty), "https://example.org/a", 8000, ".story");
    expect(extracted.matched).toBe(false);
    expect(extracted.text).toContain("released a patch on Sunday");
  });

  it("falls back to Readability when the selector cannot be used", () => {
    const extracted = extractArticle(page("", ARTICLE_BODY), "https://example.org/a", 8000, "p:unknown-thing");
    expect(extracted.matched).toBe(false);
    expect(extracted.text).toContain("released a patch on Sunday");
  });

  it("says nothing matched when no selector is given", () => {
    expect(extractArticle(page("", ARTICLE_BODY), "https://example.org/a").matched).toBe(false);
    expect(extractArticle(page("", ARTICLE_BODY), "https://example.org/a", 8000, null).matched).toBe(false);
  });
});
