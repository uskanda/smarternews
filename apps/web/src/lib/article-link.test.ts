import { describe, expect, it } from "vitest";
import { articleLink } from "./article-link.ts";

const article = (fields: { title: string; translatedTitle?: string | null; primaryUrl: string | null }) => ({ translatedTitle: null, ...fields });

describe("articleLink", () => {
  it("is the title and the main source as a Markdown link", () => {
    expect(articleLink(article({ title: "新しい版の公開", primaryUrl: "https://example.com/a" }))).toBe("[新しい版の公開](https://example.com/a)");
  });

  it("takes the translated title, the headline the reader saw, over the original", () => {
    expect(articleLink(article({ title: "New release", translatedTitle: "新しい版の公開", primaryUrl: "https://example.com/a" }))).toBe(
      "[新しい版の公開](https://example.com/a)",
    );
  });

  it("escapes the brackets and backslashes of the title", () => {
    expect(articleLink(article({ title: String.raw`[速報] a\b ]`, primaryUrl: "https://example.com/a" }))).toBe(
      String.raw`[\[速報\] a\\b \]](https://example.com/a)`,
    );
  });

  it("puts the line breaks of the title on one line", () => {
    expect(articleLink(article({ title: "First\nsecond", primaryUrl: "https://example.com/a" }))).toBe("[First second](https://example.com/a)");
  });

  it("encodes the parentheses and spaces of the address", () => {
    expect(articleLink(article({ title: "Wiki", primaryUrl: "https://en.wikipedia.org/wiki/Foo_(bar) baz" }))).toBe(
      "[Wiki](https://en.wikipedia.org/wiki/Foo_%28bar%29%20baz)",
    );
  });

  it("is nothing for an article without a main source", () => {
    expect(articleLink(article({ title: "No source", primaryUrl: null }))).toBeNull();
  });
});
