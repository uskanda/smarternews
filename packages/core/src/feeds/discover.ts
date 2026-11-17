import { parseHTML } from "linkedom";
import { DomainError } from "../errors.ts";
import type { Fetcher } from "../fetch/http.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { parseSubscription } from "../sources/feed.ts";

export interface DiscoveredFeed {
  url: string;
  title: string;
}

const FEED_TYPES = new Set(["application/rss+xml", "application/atom+xml", "application/rdf+xml", "application/feed+json"]);

/**
 * Where blogs keep their feed by default, tried in this order when a page points to none: WordPress, two
 * common names, Jekyll, Atom, Hugo and JSON Feed. Each place costs one request to the same host.
 */
export const COMMON_FEED_PATHS = ["/feed", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/feed.json"] as const;

interface LinkElement {
  getAttribute(name: string): string | null;
}

/** A `<link>` of a page whose target is on the web. */
export interface PageLink {
  /** The words of `rel`, in lower case. */
  rel: string[];
  /** `type` in lower case, or "" without one. */
  type: string;
  title: string;
  /** The target as an absolute HTTP or HTTPS address. */
  url: string;
}

/** The `<link>` elements of a page, in document order, with their targets resolved against `baseUrl`. */
export function pageLinks(page: string, baseUrl: string): PageLink[] {
  const { document } = parseHTML(page) as unknown as { document: { querySelectorAll(selector: string): Iterable<LinkElement> } };
  const links: PageLink[] = [];
  for (const link of document.querySelectorAll("link[href]")) {
    let target: URL;
    try {
      target = new URL(link.getAttribute("href") ?? "", baseUrl);
    } catch {
      continue;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") continue;
    links.push({
      rel: (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/),
      type: (link.getAttribute("type") ?? "").toLowerCase().trim(),
      title: (link.getAttribute("title") ?? "").replace(/\s+/g, " ").trim(),
      url: target.toString(),
    });
  }
  return links;
}

function refuse(message: string): DomainError {
  return new DomainError("invalid", message, [{ path: "url", message, code: "unreachable" }]);
}

/** The first common place under the page's origin that answers with a feed, or null when none does. */
async function commonFeed(fetcher: Fetcher, pageUrl: string): Promise<DiscoveredFeed | null> {
  for (const path of COMMON_FEED_PATHS) {
    try {
      const response = await fetcher.get(new URL(path, pageUrl).toString(), { maxBytes: fetcher.feedMaxBytes });
      if (response.status < 200 || response.status >= 300) continue;
      return { url: normalizeUrl(response.url), title: parseSubscription(response.text).title };
    } catch {
      // not fetched or not a feed: try the next place
    }
  }
  return null;
}

/**
 * The feeds behind a URL. When the URL is a feed, that is the one answer; when it is a page, the answers are
 * the feeds the page points to with `<link rel="alternate">`. A page that points to none gets the first feed
 * found at a common place under its origin. Nothing is subscribed. The URL is fetched under the size limit of
 * feeds, since it may be one; read as a page, it is held to the limit of pages.
 */
export async function discoverFeeds(fetcher: Fetcher, url: string): Promise<DiscoveredFeed[]> {
  let response;
  try {
    response = await fetcher.get(url, { maxBytes: fetcher.feedMaxBytes });
  } catch (error) {
    throw refuse(`the page could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status < 200 || response.status >= 300) throw refuse(`the page could not be fetched: HTTP status ${response.status}`);
  try {
    return [{ url: normalizeUrl(url), title: parseSubscription(response.text).title }];
  } catch {
    // not a feed, so read it as a page
  }
  if (Buffer.byteLength(response.text) > fetcher.maxBytes) {
    throw refuse(`the page could not be fetched: response larger than ${fetcher.maxBytes} bytes: ${response.url}`);
  }
  const found = new Map<string, DiscoveredFeed>();
  for (const link of pageLinks(response.text, response.url)) {
    if (!link.rel.includes("alternate") || !FEED_TYPES.has(link.type)) continue;
    const feedUrl = normalizeUrl(link.url);
    if (!found.has(feedUrl)) found.set(feedUrl, { url: feedUrl, title: link.title });
  }
  if (found.size > 0) return [...found.values()];
  const common = await commonFeed(fetcher, response.url);
  return common ? [common] : [];
}
