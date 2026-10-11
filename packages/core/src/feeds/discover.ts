import { parseHTML } from "linkedom";
import { DomainError } from "../errors.ts";
import type { Fetcher } from "../fetch/http.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { parseSubscription } from "../sources/feed.ts";

export interface DiscoveredFeed {
  url: string;
  title: string;
}

const FEED_TYPES = new Set(["application/rss+xml", "application/atom+xml", "application/rdf+xml"]);

interface LinkElement {
  getAttribute(name: string): string | null;
}

function refuse(message: string): DomainError {
  return new DomainError("invalid", message, [{ path: "url", message }]);
}

/**
 * The feeds behind a URL. When the URL is a feed, that is the one answer; when it is a page, the answers are
 * the feeds the page points to with `<link rel="alternate">`. Nothing is subscribed.
 */
export async function discoverFeeds(fetcher: Fetcher, url: string): Promise<DiscoveredFeed[]> {
  let response;
  try {
    response = await fetcher.get(url);
  } catch (error) {
    throw refuse(`the page could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status < 200 || response.status >= 300) throw refuse(`the page could not be fetched: HTTP status ${response.status}`);
  try {
    return [{ url: normalizeUrl(url), title: parseSubscription(response.text).title }];
  } catch {
    // not a feed, so read it as a page
  }
  const { document } = parseHTML(response.text) as unknown as { document: { querySelectorAll(selector: string): Iterable<LinkElement> } };
  const found = new Map<string, DiscoveredFeed>();
  for (const link of document.querySelectorAll("link[href]")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const type = (link.getAttribute("type") ?? "").toLowerCase().trim();
    if (!rel.includes("alternate") || !FEED_TYPES.has(type)) continue;
    let target: URL;
    try {
      target = new URL(link.getAttribute("href") ?? "", response.url);
    } catch {
      continue;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") continue;
    const feedUrl = normalizeUrl(target.toString());
    if (!found.has(feedUrl)) found.set(feedUrl, { url: feedUrl, title: (link.getAttribute("title") ?? "").replace(/\s+/g, " ").trim() });
  }
  return [...found.values()];
}
