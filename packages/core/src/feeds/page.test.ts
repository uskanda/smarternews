import { describe, expect, it } from "vitest";
import { extractPage, parsePage, parsePageDate } from "./page.ts";

const PAGE_URL = "https://example.org/news/";

function list(items: string[], head = "<title>Example News</title>"): string {
  return `<!doctype html><html><head>${head}</head><body><ul class="posts">${items.join("")}</ul></body></html>`;
}

describe("parsePage", () => {
  it("names the page by its title, and its site by its URL", () => {
    const parsed = parsePage(list(['<li><a href="/a">A</a></li>']), PAGE_URL, { item: "li" }, "UTC");
    expect(parsed.title).toBe("Example News");
    expect(parsed.siteUrl).toBe(PAGE_URL);
  });

  it("takes the text of the link as the title, and the first link of the item, when those selectors are left out", () => {
    const parsed = parsePage(
      list(['<li><span class="tag">News</span> <a href="/posts/1"> 新製品の発表 </a> <a href="/tags/x">tag</a></li>']),
      PAGE_URL,
      { item: "li" },
      "UTC",
    );
    expect(parsed.items).toEqual([
      { key: null, url: "https://example.org/posts/1", title: "新製品の発表", snippet: "", contentHtml: "", author: null, publishedAt: null },
    ]);
  });

  it("uses the title and link selectors when given, and an item that is itself a link", () => {
    const html = list([
      '<li><h2 class="t">The title</h2><a class="more" href="https://other.example/x">more</a><a href="/first">first</a></li>',
    ]);
    expect(parsePage(html, PAGE_URL, { item: "li", title: "h2.t", link: "a.more" }, "UTC").items[0]).toMatchObject({
      url: "https://other.example/x",
      title: "The title",
    });
    const anchors = '<div class="cards"><a class="card" href="one">One</a><a class="card" href="two">Two</a></div>';
    expect(parsePage(list([], `<title>T</title>`).replace("</body>", `${anchors}</body>`), PAGE_URL, { item: "a.card" }, "UTC").items.map((item) => item.url)).toEqual([
      "https://example.org/news/one",
      "https://example.org/news/two",
    ]);
  });

  it("makes a relative link absolute against the page URL", () => {
    const parsed = parsePage(list(['<li><a href="../2026/10/post.html">Post</a></li>']), "https://example.org/news/list.html", { item: "li" }, "UTC");
    expect(parsed.items[0]!.url).toBe("https://example.org/2026/10/post.html");
  });

  it("leaves out an item without a link, or without a title", () => {
    const parsed = parsePage(
      list([
        '<li><a href="/1">One</a></li>',
        "<li>No link here</li>",
        '<li><a href="/3">Three</a></li>',
        '<li><a href="/4"><img src="x.png"></a></li>',
        '<li><a href="javascript:void(0)">Script</a></li>',
      ]),
      PAGE_URL,
      { item: "li" },
      "UTC",
    );
    expect(parsed.items.map((item) => item.title)).toEqual(["One", "Three"]);
  });

  it("keeps the text of the item out of the content", () => {
    const parsed = parsePage(list(['<li><a href="/1">One</a><p>An excerpt of the article that goes on.</p></li>']), PAGE_URL, { item: "li" }, "UTC");
    expect(parsed.items[0]!.contentHtml).toBe("");
    expect(parsed.items[0]!.snippet).toBe("");
  });

  it("runs no script: articles a script would draw are not there", () => {
    const html = list(
      [],
      `<title>T</title><script>document.querySelector("ul").innerHTML = '<li><a href="/x">Drawn</a></li>';</script>`,
    );
    expect(() => parsePage(html, PAGE_URL, { item: "li" }, "UTC")).toThrow("no element matches the item selector");
    expect(extractPage(html, PAGE_URL, { item: "li" }, "UTC")).toMatchObject({ matched: 0, items: [] });
  });

  it("finds nothing with a selector no element matches", () => {
    expect(extractPage(list(['<li><a href="/1">One</a></li>']), PAGE_URL, { item: "article.post" }, "UTC")).toMatchObject({ matched: 0, items: [] });
  });

  it("refuses a selector the engine cannot use, naming the field", () => {
    expect(() => extractPage(list(['<li><a href="/1">One</a></li>']), PAGE_URL, { item: "li:frobnicate" }, "UTC")).toThrow(/item selector/);
  });

  it("reads the date of an item from its date element", () => {
    const parsed = parsePage(
      list([
        '<li><a href="/1">One</a><time datetime="2026-10-20T09:00:00+09:00">10月20日</time></li>',
        '<li><a href="/2">Two</a><span class="d">2026/10/19</span></li>',
        '<li><a href="/3">Three</a></li>',
      ]),
      PAGE_URL,
      { item: "li", date: "time, .d" },
      "Asia/Tokyo",
    );
    expect(parsed.items.map((item) => item.publishedAt?.toISOString() ?? null)).toEqual(["2026-10-20T00:00:00.000Z", "2026-10-18T15:00:00.000Z", null]);
  });
});

describe("parsePageDate", () => {
  const read = (text: string, timeZone = "UTC") => parsePageDate(text, timeZone)?.toISOString() ?? null;

  it("reads ISO 8601 with and without an offset", () => {
    expect(read("2026-10-20T09:00:00+09:00")).toBe("2026-10-20T00:00:00.000Z");
    expect(read("2026-10-20T09:00:00Z")).toBe("2026-10-20T09:00:00.000Z");
    expect(read("2026-10-20T09:00", "Asia/Tokyo")).toBe("2026-10-20T00:00:00.000Z");
  });

  it("reads a date with hyphens, slashes, dots or 年月日, and the time after it", () => {
    expect(read("2026-10-20")).toBe("2026-10-20T00:00:00.000Z");
    expect(read("2026/10/20 14:30")).toBe("2026-10-20T14:30:00.000Z");
    expect(read("Posted 2026.10.20")).toBe("2026-10-20T00:00:00.000Z");
    expect(read("2026年10月5日")).toBe("2026-10-05T00:00:00.000Z");
    expect(read("2026年10月5日(月) 9:05")).toBe("2026-10-05T09:05:00.000Z");
  });

  it("reads a date without an offset in the time zone of the settings", () => {
    expect(read("2026-10-20", "Asia/Tokyo")).toBe("2026-10-19T15:00:00.000Z");
    expect(read("2026/07/01 12:00", "America/New_York")).toBe("2026-07-01T16:00:00.000Z");
  });

  it("reads nothing from a relative time, or from a date that does not exist", () => {
    expect(read("3時間前")).toBeNull();
    expect(read("3 hours ago")).toBeNull();
    expect(read("2026/13/40")).toBeNull();
    expect(read("2026-02-30")).toBeNull();
    expect(read("")).toBeNull();
  });
});
