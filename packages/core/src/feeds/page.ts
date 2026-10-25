// Web feeds: the articles of a page without a feed, taken out of the HTML the page answers with a set of CSS
// selectors. No script of the page runs, and no model is involved: what is taken is the title, the link and the
// date of each article. The text is not taken; full content fetching gets it from the article's page.
import { parseHTML } from "linkedom";
import type { PageSelectors } from "../api.ts";
import { DomainError } from "../errors.ts";
import type { PageResult } from "../fetch/pages.ts";
import { normalizeUrl } from "../fetch/url.ts";
import type { ParsedSubscription, SubscriptionItem } from "../sources/feed.ts";
import { zonedToUtc } from "../time.ts";

/** Why a fetch of a web feed failed when its page no longer has the elements of its articles. */
export const NO_ITEM_ELEMENT = "no element matches the item selector";

const TITLE_CHARS = 300;

/** Why a page could not be had, as a fetch of a web feed records it. */
export function pageFailureReason(page: Exclude<PageResult, { ok: true }>, url: string): string {
  switch (page.reason) {
    case "robots":
      return "robots.txt forbids";
    case "http":
      return `HTTP status ${page.status}: ${url}`;
    case "limit":
      return "page limit reached";
    case "not-html":
      return `the answer is not a web page: ${page.detail}`;
    default:
      return page.detail;
  }
}

/** The parts of a linkedom element this module reads. */
export interface PageElement {
  readonly tagName: string;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): PageElement | null;
  querySelectorAll(selector: string): Iterable<PageElement>;
}

export interface PageDocument {
  querySelector(selector: string): PageElement | null;
  querySelectorAll(selector: string): Iterable<PageElement>;
}

export function parseDocument(html: string): PageDocument {
  return (parseHTML(html) as unknown as { document: PageDocument }).document;
}

/** What one set of selectors takes out of a page. */
export interface Extracted {
  /** The page's own title. */
  title: string;
  /** The elements the item selector matched, articles taken out of them or not. */
  matched: number;
  /** The articles, in the order of the page: the items with a link and a title. */
  items: SubscriptionItem[];
}

const FIELD_NAMES = { item: "item", title: "title", link: "link", date: "date" } as const;

/** Runs one selector; a selector the engine cannot use is refused with the name of its field. */
function select(root: PageDocument | PageElement, selector: string, field: keyof PageSelectors, all: true): PageElement[];
function select(root: PageDocument | PageElement, selector: string, field: keyof PageSelectors, all: false): PageElement | null;
function select(root: PageDocument | PageElement, selector: string, field: keyof PageSelectors, all: boolean): PageElement[] | PageElement | null {
  try {
    return all ? [...root.querySelectorAll(selector)] : root.querySelector(selector);
  } catch (error) {
    const message = `the ${FIELD_NAMES[field]} selector cannot be used: ${error instanceof Error ? error.message : String(error)}`;
    throw new DomainError("invalid", message, [{ path: `selectors.${field}`, message }]);
  }
}

/** The text of an element on one line, cut at `TITLE_CHARS`. */
function textOf(element: PageElement | null): string {
  const text = (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1).trimEnd()}…` : text;
}

/** The link of an item: the element the link selector finds, the item when it is a link, or its first link. */
function linkOf(item: PageElement, selectors: PageSelectors): PageElement | null {
  if (selectors.link !== undefined) {
    const found = select(item, selectors.link, "link", false);
    if (found === null || found.hasAttribute("href")) return found;
    // A selector that finds the heading around a link means the link in it.
    return found.querySelector("a[href]");
  }
  if (item.tagName.toLowerCase() === "a" && item.hasAttribute("href")) return item;
  return item.querySelector("a[href]");
}

/** The address a link points to, absolute against the page; null unless it is a web page. */
function addressOf(link: PageElement | null, pageUrl: string): string | null {
  const href = link?.getAttribute("href")?.trim();
  if (!href) return null;
  try {
    const url = new URL(href, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? normalizeUrl(url.toString()) : null;
  } catch {
    return null;
  }
}

function dateOf(item: PageElement, selectors: PageSelectors, timeZone: string): Date | null {
  if (selectors.date === undefined) return null;
  const element = select(item, selectors.date, "date", false);
  if (element === null) return null;
  return parsePageDate(element.getAttribute("datetime") ?? "", timeZone) ?? parsePageDate(element.textContent ?? "", timeZone);
}

const emptyDocument = parseDocument("<!doctype html><html><body></body></html>");

/**
 * Refuses selectors the engine that reads pages cannot use, such as an unknown pseudo-class, naming the field.
 * The shared schema checks only that a selector reads as CSS.
 */
export function checkSelectorsUsable(selectors: PageSelectors): void {
  for (const field of ["item", "title", "link", "date"] as const) {
    const selector = selectors[field];
    if (selector !== undefined) select(emptyDocument, selector, field, false);
  }
}

/** Takes the articles out of a page with one set of selectors. Finding nothing is an answer, not an error. */
export function extractPage(html: string, pageUrl: string, selectors: PageSelectors, timeZone: string): Extracted {
  const document = parseDocument(html);
  const elements = select(document, selectors.item, "item", true);
  const items: SubscriptionItem[] = [];
  for (const element of elements) {
    const link = linkOf(element, selectors);
    const url = addressOf(link, pageUrl);
    const title = selectors.title === undefined ? textOf(link) : textOf(select(element, selectors.title, "title", false));
    if (url === null || title.length === 0) continue;
    items.push({ key: null, url, title, snippet: "", contentHtml: "", author: null, publishedAt: dateOf(element, selectors, timeZone) });
  }
  return { title: textOf(document.querySelector("title")), matched: elements.length, items };
}

/**
 * Reads a page as a subscription, the way a feed is read: the page's title, the page as its site, and its
 * articles without a key, so that they are told apart by their link. Throws when the item selector matches no
 * element, which is how a page whose structure changed shows.
 */
export function parsePage(html: string, pageUrl: string, selectors: PageSelectors, timeZone: string): ParsedSubscription {
  const extracted = extractPage(html, pageUrl, selectors, timeZone);
  if (extracted.matched === 0) throw new Error(NO_ITEM_ELEMENT);
  return { title: extracted.title, siteUrl: pageUrl, items: extracted.items };
}

// A date: year, month and day with -, /, . or 年月日 between them; a weekday in brackets may follow. Then a time,
// and an offset, may follow.
const DATE_PATTERN =
  /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:\s*日)?(?:\s*[(（][^)）]{1,6}[)）])?(?:(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?/;

const pad = (value: string | number) => String(value).padStart(2, "0");

/**
 * The time a date on a page stands for, or null when it reads as none: ISO 8601, YYYY-MM-DD, YYYY/MM/DD, the
 * year, month and day separated by dots, and YYYY年M月D日, each with a time after it or not. A time without an
 * offset is read in `timeZone`. A relative time such as "3 hours ago" is not read.
 */
export function parsePageDate(text: string, timeZone: string): Date | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0", zone] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const date = `${year}-${pad(m)}-${pad(d)}`;
  const time = `${pad(hour)}:${pad(minute)}:${pad(second)}`;
  if (zone === undefined) return zonedToUtc(date, time, timeZone);
  const offset = zone === "Z" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const parsed = new Date(`${date}T${time}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
