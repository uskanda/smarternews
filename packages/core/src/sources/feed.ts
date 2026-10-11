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

// ---- subscribed feeds: the same documents, read in full -----------------------------------------------

export interface SubscriptionItem extends FeedItem {
  /** What the feed says identifies the item: an RSS guid, an Atom id, an rdf:about. Null when it has none. */
  key: string | null;
  author: string | null;
  /** The content as the feed delivers it. Untrusted HTML: convert it before storing or showing it. */
  contentHtml: string;
}

export interface ParsedSubscription {
  title: string;
  /** The page the feed belongs to. */
  siteUrl: string | null;
  items: SubscriptionItem[];
}

// Atom content of type "xhtml" holds elements, whose order among text the object form above loses. A second
// parser leaves these elements unparsed, so their source text is available.
const rawContentParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  processEntities: false,
  stopNodes: ["feed.entry.content", "feed.entry.summary"],
  isArray: (name) => name === "entry",
});

function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** "editor@example.org (Sam Editor)" names Sam Editor; anything else is taken as it is. */
function rssAuthor(item: Node): string | null {
  const creator = orNull(plainText(textOf(item["dc:creator"]), 200));
  if (creator) return creator;
  const author = plainText(textOf(item.author), 200);
  return orNull(/\(([^)]+)\)\s*$/.exec(author)?.[1] ?? author);
}

function atomAuthor(entry: Node): string | null {
  const first = Array.isArray(entry.author) ? entry.author[0] : entry.author;
  if (!first || typeof first !== "object") return orNull(plainText(textOf(first), 200));
  return orNull(plainText(textOf((first as Node).name), 200));
}

function rssSubscriptionItem(item: Node): SubscriptionItem {
  return {
    ...rssItem(item),
    key: orNull(textOf(item.guid)) ?? orNull(String(item["@_rdf:about"] ?? "")),
    author: rssAuthor(item),
    contentHtml: (textOf(item["content:encoded"]) || textOf(item.description)).trim(),
  };
}

function isXhtml(node: unknown): boolean {
  return !!node && typeof node === "object" && (node as Node)["@_type"] === "xhtml";
}

function atomContent(entry: Node, raw: Node | undefined): string {
  for (const name of ["content", "summary"] as const) {
    if (isXhtml(entry[name])) return textOf(raw?.[name]).trim();
    const text = textOf(entry[name]).trim();
    if (text.length > 0) return text;
  }
  return "";
}

function siteLink(link: unknown, parse: (link: unknown) => string): string | null {
  const url = parse(link);
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Reads RSS 2.0, RSS 1.0 (RDF) and Atom with everything a reader shows: identifier, author and content. */
export function parseSubscription(xml: string): ParsedSubscription {
  const root = parseXml(xml);
  const rss = (root.rss as Node | undefined)?.channel as Node | undefined;
  if (rss) {
    return {
      title: plainText(textOf(rss.title), 200),
      siteUrl: siteLink(rss.link, rssLink),
      items: ((rss.item as Node[] | undefined) ?? []).map(rssSubscriptionItem),
    };
  }
  const rdf = root["rdf:RDF"] as Node | undefined;
  if (rdf) {
    const channel = rdf.channel as Node | undefined;
    return {
      title: plainText(textOf(channel?.title), 200),
      siteUrl: siteLink(channel?.link, rssLink),
      items: ((rdf.item as Node[] | undefined) ?? []).map(rssSubscriptionItem),
    };
  }
  const atom = root.feed as Node | undefined;
  if (atom) {
    const entries = (atom.entry as Node[] | undefined) ?? [];
    const needsRaw = entries.some((entry) => isXhtml(entry.content) || isXhtml(entry.summary));
    const rawEntries = needsRaw ? ((((rawContentParser.parse(xml) as Node).feed as Node | undefined)?.entry as Node[] | undefined) ?? []) : [];
    return {
      title: plainText(textOf(atom.title), 200),
      siteUrl: siteLink(atom.link, atomLink),
      items: entries.map((entry, index) => ({
        ...atomEntry(entry),
        key: orNull(textOf(entry.id)),
        author: atomAuthor(entry),
        contentHtml: atomContent(entry, rawEntries[index]),
      })),
    };
  }
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
