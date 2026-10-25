import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inferSelectors } from "./infer.ts";
import { extractPage } from "./page.ts";

const PAGE_URL = "https://gazette.example.org/latest";
const recorded = readFileSync(join(import.meta.dirname, "../testing/pages/news-list.html"), "utf8");

describe("inferSelectors", () => {
  it("finds the list of articles of a recorded page first, with the time elements as its dates", () => {
    const candidates = inferSelectors(recorded);
    expect(candidates[0]).toEqual({ item: "#content > div.article-list > article.entry", date: "time" });
    const extracted = extractPage(recorded, PAGE_URL, candidates[0]!, "UTC");
    expect(extracted.items).toHaveLength(6);
    expect(extracted.items[0]).toMatchObject({
      title: "Harbor bridge reopens after two years of repairs",
      url: "https://gazette.example.org/2026/10/24/harbor-bridge-reopens",
      publishedAt: new Date("2026-10-24T08:30:00Z"),
    });
  });

  it("does not take a row of links inside nav, header, footer or aside for a list of articles", () => {
    const selectors = inferSelectors(recorded).map((candidate) => candidate.item);
    expect(selectors.some((selector) => /menu|ranking|footer/.test(selector))).toBe(false);
    expect(selectors.length).toBeLessThanOrEqual(3);
  });

  it("joins classes up to three levels when no ancestor has an id", () => {
    const html = `<html><body><div class="wrap"><section class="news"><ul class="items">${[1, 2, 3, 4]
      .map((n) => `<li class="item"><a href="/n/${n}">The headline of story number ${n}</a></li>`)
      .join("")}</ul></section></div></body></html>`;
    expect(inferSelectors(html)).toEqual([{ item: "section.news > ul.items > li.item" }]);
  });

  it("finds nothing on a page with one link", () => {
    expect(inferSelectors('<html><body><p>Nothing here but <a href="/about">one link</a>.</p></body></html>')).toEqual([]);
  });

  it("needs most items of a group to hold a link with text", () => {
    const html = `<html><body><ul class="cards">${[1, 2, 3, 4, 5]
      .map((n) => (n <= 3 ? `<li class="card">Card ${n}</li>` : `<li class="card"><a href="/c/${n}">Card ${n}</a></li>`))
      .join("")}</ul></body></html>`;
    expect(inferSelectors(html)).toEqual([]);
  });
});
