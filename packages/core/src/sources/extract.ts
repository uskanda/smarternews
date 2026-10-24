import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { parseDate } from "./text.ts";

export interface ExtractedArticle {
  title: string;
  /** Readable text of the page, or "" when nothing could be extracted. */
  text: string;
  /**
   * The HTML of the article body as Readability left it, or "" when nothing could be extracted. Not cut: it is
   * written by another site, and is shown only after `convertContent` rewrites it, which bounds its length.
   */
  html: string;
  publishedAt: Date | null;
}

// The subset of the DOM this module uses. The project does not load the DOM type library.
interface DomElement {
  getAttribute(name: string): string | null;
  textContent: string | null;
}
interface DomDocument {
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): Iterable<DomElement>;
}

const DATE_META = [
  'meta[property="article:published_time"]',
  'meta[property="og:published_time"]',
  'meta[name="article:published_time"]',
  'meta[itemprop="datePublished"]',
  'meta[name="pubdate"]',
  'meta[name="publishdate"]',
  'meta[name="date"]',
  'meta[name="DC.date.issued"]',
  'meta[name="dc.date"]',
];

function findDatePublished(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findDatePublished(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.datePublished === "string") return record.datePublished;
  for (const entry of Object.values(record)) {
    const found = findDatePublished(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function publishedAt(document: DomDocument): Date | null {
  for (const selector of DATE_META) {
    const date = parseDate(document.querySelector(selector)?.getAttribute("content"));
    if (date) return date;
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const date = parseDate(findDatePublished(JSON.parse(script.textContent ?? "")));
      if (date) return date;
    } catch {
      // malformed JSON-LD is common; try the next block
    }
  }
  return parseDate(document.querySelector("time[datetime]")?.getAttribute("datetime"));
}

/** Pulls the readable text, its HTML and the publication time out of a page. */
export function extractArticle(html: string, _url: string, maxChars = 8000): ExtractedArticle {
  const { document } = parseHTML(html) as unknown as { document: DomDocument };
  const published = publishedAt(document);
  const pageTitle = (document.querySelector("title")?.textContent ?? "").replace(/\s+/g, " ").trim();
  let text = "";
  let content = "";
  let title = pageTitle;
  try {
    const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 100 }).parse();
    text = (article?.textContent ?? "").replace(/\s+/g, " ").trim();
    content = text.length > 0 ? (article?.content ?? "") : "";
    title = article?.title?.trim() || pageTitle;
  } catch {
    // an unreadable page leaves the text empty
  }
  return { title, text: text.slice(0, maxChars), html: content, publishedAt: published };
}
