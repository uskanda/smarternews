import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import type { Article } from "../api.ts";
import { renderRss } from "./rss.ts";

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 7,
  categoryId: 1,
  origin: "generated",
  feedId: null,
  author: null,
  kind: "news",
  title: "Vendor ships fix",
  translatedTitle: null,
  summary: "A patch is out.",
  impact: null,
  importance: 4,
  unconfirmed: false,
  firstPublishedAt: "2026-03-01T12:00:00.000Z",
  updatedAt: "2026-03-01T12:00:00.000Z",
  revision: 0,
  isRead: false,
  starred: false,
  primaryUrl: "https://example.org/a",
  refCount: 2,
  event: null,
  body: "The **vendor** shipped a fix.",
  bodyHtml: "<p>The <strong>vendor</strong> shipped a fix.</p>",
  autoSummary: null,
  autoSummaryPending: false,
  translatable: false,
  translation: null,
  snippetOnly: false,
  previousArticleId: null,
  refs: [
    { url: "https://example.org/a", siteName: "Example News", title: "Fix shipped", publishedAt: "2026-03-01T09:00:00.000Z" },
    { url: "https://example.net/b", siteName: "Example Daily", title: "Patch notes", publishedAt: null },
  ],
  topics: [{ id: 3, text: "Exploited bugs" }],
  ...overrides,
});

const options = (articles: Article[], language = "en") => ({
  title: "Security",
  link: "http://127.0.0.1:8787/",
  description: "Articles of the category Security",
  language,
  timeZone: "UTC",
  articles,
  categoryNames: new Map([[1, "Security"]]),
});

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: (name) => name === "item" || name === "category" });
function parse(xml: string) {
  const channel = parser.parse(xml).rss.channel as { title: string; item?: Array<Record<string, unknown>> };
  return { channel, items: channel.item ?? [] };
}

describe("renderRss", () => {
  it("produces an RSS 2.0 channel titled after the category", () => {
    const xml = renderRss(options([article()]));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(parser.parse(xml).rss["@_version"]).toBe("2.0");
    expect(parse(xml).channel.title).toBe("Security");
  });

  it("gives each item the title, the main reference as its link, the time, the summary and the category", () => {
    const [item] = parse(renderRss(options([article()]))).items;
    expect(item).toMatchObject({
      title: "Vendor ships fix",
      link: "https://example.org/a",
      description: "A patch is out.",
      pubDate: "Sun, 01 Mar 2026 12:00:00 GMT",
      category: ["Security"],
    });
  });

  it("puts the body and a link to every reference into the full content", () => {
    const [item] = parse(renderRss(options([article()]))).items;
    const content = String(item!["content:encoded"]);
    expect(content).toContain("<p>The <strong>vendor</strong> shipped a fix.</p>");
    expect(content).toContain('<a href="https://example.org/a">');
    expect(content).toContain('<a href="https://example.net/b">');
    expect(content).toContain("Example Daily");
  });

  it("opens the content of an unconfirmed article with a notice", () => {
    const [item] = parse(renderRss(options([article({ unconfirmed: true })]))).items;
    expect(String(item!["content:encoded"]).indexOf("Unconfirmed")).toBe(String(item!["content:encoded"]).indexOf("<p><strong>") + 11);
  });

  it("includes what the story means for the reader", () => {
    const [item] = parse(renderRss(options([article({ impact: "Update this week." })]))).items;
    expect(String(item!["content:encoded"])).toContain("Update this week.");
  });

  it("keeps the identifier of an unchanged article stable", () => {
    const first = parse(renderRss(options([article()]))).items[0]!.guid as Record<string, unknown>;
    const second = parse(renderRss(options([article()]))).items[0]!.guid as Record<string, unknown>;
    expect(first["#text"]).toBe(second["#text"]);
    expect(first["@_isPermaLink"]).toBe("false");
  });

  it("gives an updated article a new identifier, a marked title and the time of the update", () => {
    const before = parse(renderRss(options([article()]))).items[0]!;
    const after = parse(renderRss(options([article({ revision: 1, updatedAt: "2026-03-02T08:00:00.000Z" })]))).items[0]!;
    expect((after.guid as Record<string, unknown>)["#text"]).not.toBe((before.guid as Record<string, unknown>)["#text"]);
    expect(after.title).toBe("[Updated] Vendor ships fix");
    expect(after.pubDate).toBe("Mon, 02 Mar 2026 08:00:00 GMT");
  });

  it("marks updates in Japanese when the output language is Japanese", () => {
    const [item] = parse(renderRss(options([article({ revision: 2 })], "ja"))).items;
    expect(item!.title).toBe("【更新】Vendor ships fix");
  });

  it("opens the content of an event with its time and venue", () => {
    const event = article({
      kind: "event",
      event: { startsAt: "2026-03-07T10:00:00.000Z", endsAt: "2026-03-07T16:00:00.000Z", venue: "City Hall", fee: null, registration: "required" },
    });
    const content = String(parse(renderRss(options([event]))).items[0]!["content:encoded"]);
    expect(content).toContain("City Hall");
    expect(content).toMatch(/Mar 7, 2026/);
    expect(content.indexOf("City Hall")).toBeLessThan(content.indexOf("shipped a fix"));
  });

  it("stays well-formed and loses nothing when a title holds markup characters", () => {
    const title = `Use <b> & "quotes" in <script>alert('x')</script> ]]> safely`;
    const [item] = parse(renderRss(options([article({ title, summary: "a < b && c > d" })]))).items;
    expect(item!.title).toBe(title);
    expect(item!.description).toBe("a < b && c > d");
  });

  it("drops characters that XML does not allow", () => {
    const xml = renderRss(options([article({ title: "Bad\u0000 char\u000b here" })]));
    expect(parse(xml).items[0]!.title).toBe("Bad char here");
  });

  it("falls back to the channel link for an article without references", () => {
    const [item] = parse(renderRss(options([article({ primaryUrl: null, refs: [] })]))).items;
    expect(item!.link).toBe("http://127.0.0.1:8787/");
  });

  it("renders a channel without items", () => {
    expect(parse(renderRss(options([]))).items).toEqual([]);
  });
});
