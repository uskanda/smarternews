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
  /** True when the text and the HTML are of the element the content selector matched, not Readability's. */
  matched: boolean;
}

// The subset of the DOM this module uses. The project does not load the DOM type library.
interface DomElement {
  getAttribute(name: string): string | null;
  textContent: string | null;
  outerHTML: string;
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

/** The first element the selector matches, when it has text. A selector the engine cannot use matches nothing. */
function selected(document: DomDocument, selector: string): { text: string; html: string } | null {
  let element: DomElement | null;
  try {
    element = document.querySelector(selector);
  } catch {
    return null;
  }
  const text = (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  return element && text.length > 0 ? { text, html: element.outerHTML } : null;
}

/**
 * Pulls the readable text, its HTML and the publication time out of a page. With a content selector, the
 * first element it matches is the article body instead of what Readability finds; a page where it matches no
 * element with text is read by Readability.
 */
export function extractArticle(html: string, _url: string, maxChars = 8000, contentSelector: string | null = null): ExtractedArticle {
  const { document } = parseHTML(html) as unknown as { document: DomDocument };
  const published = publishedAt(document);
  const pageTitle = (document.querySelector("title")?.textContent ?? "").replace(/\s+/g, " ").trim();
  // Tried before Readability, which changes the document it reads.
  const chosen = contentSelector === null ? null : selected(document, contentSelector);
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
  // Readability still runs with a selector: the title is read the same way whether one is given or not.
  if (chosen) return { title, text: chosen.text.slice(0, maxChars), html: chosen.html, publishedAt: published, matched: true };
  return { title, text: text.slice(0, maxChars), html: content, publishedAt: published, matched: false };
}
