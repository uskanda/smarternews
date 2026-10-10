import { XMLParser } from "fast-xml-parser";
import type { Fetcher } from "../fetch/http.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { parseDate, plainText, plainTitle } from "./text.ts";
import type { RawCandidate } from "./types.ts";

export interface FeedItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt: Date | null;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

export function parseXml(xml: string): Node {
  return parser.parse(xml) as Node;
}

/** The text of an element, whether the parser gave a string or an object with attributes. */
export function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object" && "#text" in node) return String((node as Node)["#text"]);
  return "";
}

function rssLink(link: unknown): string {
  const first = Array.isArray(link) ? link[0] : link;
  return textOf(first).trim();
}

function atomLink(link: unknown): string {
  const links = (Array.isArray(link) ? link : [link]).filter((entry): entry is Node => !!entry && typeof entry === "object");
  const alternate = links.find((entry) => entry["@_rel"] === "alternate") ?? links.find((entry) => entry["@_rel"] === undefined);
  return String((alternate ?? links[0])?.["@_href"] ?? "").trim();
}

function rssItem(item: Node): FeedItem {
  return {
    title: plainTitle(textOf(item.title)),
    url: rssLink(item.link),
    snippet: plainText(textOf(item.description)),
    publishedAt: parseDate(textOf(item.pubDate)) ?? parseDate(textOf(item["dc:date"])),
  };
}

function atomEntry(entry: Node): FeedItem {
  return {
    title: plainTitle(textOf(entry.title)),
    url: atomLink(entry.link),
    snippet: plainText(textOf(entry.summary) || textOf(entry.content)),
    publishedAt: parseDate(textOf(entry.published)) ?? parseDate(textOf(entry.updated)),
  };
}

/** Reads RSS 2.0, RSS 1.0 (RDF) and Atom. */
export function parseFeed(xml: string): ParsedFeed {
  const root = parseXml(xml);
  const rss = (root.rss as Node | undefined)?.channel as Node | undefined;
  if (rss) return { title: plainText(textOf(rss.title), 200), items: ((rss.item as Node[] | undefined) ?? []).map(rssItem) };
  const rdf = root["rdf:RDF"] as Node | undefined;
  if (rdf) {
    return {
      title: plainText(textOf((rdf.channel as Node | undefined)?.title), 200),
      items: ((rdf.item as Node[] | undefined) ?? []).map(rssItem),
    };
  }
  const atom = root.feed as Node | undefined;
  if (atom) return { title: plainText(textOf(atom.title), 200), items: ((atom.entry as Node[] | undefined) ?? []).map(atomEntry) };
  throw new Error("the document is not a feed");
}

export async function fetchXml(fetcher: Fetcher, url: string): Promise<string> {
  const response = await fetcher.get(url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP status ${response.status}: ${url}`);
  return response.text;
}

/** Candidates from one feed. Items older than `since` are left out; items without a date are kept. */
export async function collectFeed(fetcher: Fetcher, feedUrl: string, since: Date | null): Promise<RawCandidate[]> {
  const feed = parseFeed(await fetchXml(fetcher, feedUrl));
  const candidates: RawCandidate[] = [];
  for (const item of feed.items) {
    if (item.url.length === 0 || item.title.length === 0) continue;
    if (since && item.publishedAt && item.publishedAt < since) continue;
    let url: string;
    try {
      url = normalizeUrl(new URL(item.url, feedUrl).toString());
    } catch {
      continue;
    }
    candidates.push({
      url,
      aliases: [],
      fetchable: true,
      title: item.title,
      snippet: item.snippet,
      siteName: feed.title,
      publishedAt: item.publishedAt,
      sourceKind: "feed",
    });
  }
  return candidates;
}
