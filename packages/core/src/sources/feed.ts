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

/** Elements of attached files that an item may hold more than one of. */
const ARRAY_MEDIA = new Set(["enclosure", "media:content", "media:thumbnail", "media:group"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "entry" || name === "link" || ARRAY_MEDIA.has(name),
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

/** Reads RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed. */
export function parseFeed(xml: string): ParsedFeed {
  const json = parseJsonFeed(xml);
  if (json) return { title: json.title, items: json.items.map(({ title, url, snippet, publishedAt }) => ({ title, url, snippet, publishedAt })) };
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

export type AttachmentKind = "image" | "audio" | "video" | "other";

/** A file the feed attaches to an item: an RSS enclosure, a Media RSS content or thumbnail. */
export interface FeedAttachment {
  /** An absolute HTTP or HTTPS address. */
  url: string;
  kind: AttachmentKind;
  mimeType: string | null;
  /** In bytes, as the feed says. Null when it says nothing usable. */
  size: number | null;
  title: string | null;
  /** True for a media:thumbnail: the picture of what the item's page shows, such as a video. */
  thumbnail: boolean;
}

/** The Media RSS description of an item: HTML when its type says so, plain text otherwise. */
export interface FeedDescription {
  text: string;
  html: boolean;
}

/** At most this many attachments are kept for one item. A bound against a feed that lists without end. */
export const MAX_ATTACHMENTS = 20;
/** An attachment whose address is longer than this is left out. */
export const MAX_ATTACHMENT_URL_CHARS = 2000;

export interface SubscriptionItem extends FeedItem {
  /** What the feed says identifies the item: an RSS guid, an Atom id, an rdf:about. Null when it has none. */
  key: string | null;
  author: string | null;
  /** The content as the feed delivers it. Untrusted HTML: convert it before storing or showing it. */
  contentHtml: string;
  /** The files the feed attaches to the item, without repeats, in the order the feed lists them. */
  attachments: FeedAttachment[];
  /** The Media RSS description, given only when the item has no content. Untrusted, like the content. */
  description: FeedDescription | null;
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

// ---- enclosures and Media RSS ----

function nodesOf(value: unknown): Node[] {
  return (Array.isArray(value) ? value : [value]).filter((node): node is Node => !!node && typeof node === "object");
}

function attributeOf(node: Node, name: string): string {
  const value = node[`@_${name}`];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** An absolute HTTP or HTTPS address, or null. `base` resolves a relative one; without it a relative one is refused. */
function absoluteUrl(raw: string, base: string | null): string | null {
  if (raw.length === 0) return null;
  try {
    const url = base === null ? new URL(raw) : new URL(raw, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const MEDIA_KINDS = new Set<AttachmentKind>(["image", "audio", "video"]);

/** The kind by the Media RSS medium first, then by the head of the media type. */
function kindOf(medium: string, mimeType: string | null): AttachmentKind {
  const named = medium.toLowerCase() as AttachmentKind;
  if (MEDIA_KINDS.has(named)) return named;
  if (medium.length > 0) return "other";
  const head = (mimeType?.split("/")[0] ?? "") as AttachmentKind;
  return MEDIA_KINDS.has(head) ? head : "other";
}

function sizeOf(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const size = Number(raw);
  return size > 0 && Number.isSafeInteger(size) ? size : null;
}

function mediaTitle(node: Node): string | null {
  const title = node["media:title"];
  return orNull(plainText(textOf(Array.isArray(title) ? title[0] : title), 200));
}

/**
 * The files an item attaches: its enclosures, then the media:content of the item and of its media:group, then
 * their media:thumbnail. Relative addresses are resolved against `base`, the item's page. An address that is
 * not HTTP or HTTPS, is too long, or was listed before is left out.
 */
function attachmentsOf(item: Node, base: string | null): FeedAttachment[] {
  const attachments: FeedAttachment[] = [];
  const seen = new Set<string>();
  const add = (node: Node, attachment: Omit<FeedAttachment, "url">) => {
    if (attachments.length >= MAX_ATTACHMENTS) return;
    const url = absoluteUrl(attributeOf(node, "url"), base);
    if (url === null || url.length > MAX_ATTACHMENT_URL_CHARS || seen.has(url)) return;
    seen.add(url);
    attachments.push({ url, ...attachment });
  };
  const itemTitle = mediaTitle(item);
  const scopes = [
    { node: item, title: itemTitle },
    ...nodesOf(item["media:group"]).map((group) => ({ node: group, title: mediaTitle(group) ?? itemTitle })),
  ];
  for (const enclosure of nodesOf(item.enclosure)) {
    const mimeType = orNull(attributeOf(enclosure, "type").toLowerCase());
    add(enclosure, { kind: kindOf("", mimeType), mimeType, size: sizeOf(attributeOf(enclosure, "length")), title: null, thumbnail: false });
  }
  const contents = scopes.flatMap((scope) => nodesOf(scope.node["media:content"]).map((node) => ({ node, title: mediaTitle(node) ?? scope.title })));
  for (const { node, title } of contents) {
    const mimeType = orNull(attributeOf(node, "type").toLowerCase());
    add(node, { kind: kindOf(attributeOf(node, "medium"), mimeType), mimeType, size: sizeOf(attributeOf(node, "fileSize")), title, thumbnail: false });
  }
  for (const { node, title } of [...scopes, ...contents]) {
    for (const thumbnail of nodesOf(node["media:thumbnail"])) add(thumbnail, { kind: "image", mimeType: null, size: null, title, thumbnail: true });
  }
  return attachments;
}

/** The first media:description of the item, of its media:group, or of its first media:content. */
function descriptionOf(item: Node): FeedDescription | null {
  const groups = nodesOf(item["media:group"]);
  const firstContents = [item, ...groups].map((scope) => nodesOf(scope["media:content"])[0]).filter((node): node is Node => node !== undefined);
  for (const scope of [item, ...groups, ...firstContents]) {
    const raw = scope["media:description"];
    const node = Array.isArray(raw) ? raw[0] : raw;
    const text = textOf(node).trim();
    if (text.length === 0) continue;
    return { text, html: !!node && typeof node === "object" && attributeOf(node as Node, "type").toLowerCase() === "html" };
  }
  return null;
}

/** The attachments of an item, and its description when it has no content. */
function mediaOf(item: Node, url: string, contentHtml: string, feedUrl: string | null) {
  const base = absoluteUrl(url, feedUrl) ?? feedUrl;
  return { attachments: attachmentsOf(item, base), description: contentHtml.length > 0 ? null : descriptionOf(item) };
}

function rssSubscriptionItem(item: Node, feedUrl: string | null): SubscriptionItem {
  const read = rssItem(item);
  const contentHtml = (textOf(item["content:encoded"]) || textOf(item.description)).trim();
  return {
    ...read,
    key: orNull(textOf(item.guid)) ?? orNull(String(item["@_rdf:about"] ?? "")),
    author: rssAuthor(item),
    contentHtml,
    ...mediaOf(item, read.url, contentHtml, feedUrl),
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

// ---- JSON Feed 1.0 and 1.1 (https://jsonfeed.org/version/1.1) -----------------------------------------

const JSON_FEED_VERSION = "https://jsonfeed.org/version/";

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Plain text as HTML: blank lines part paragraphs, and other line breaks stay as breaks. */
function textAsHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function jsonAuthor(item: Node): string | null {
  const first: unknown = Array.isArray(item.authors) ? item.authors[0] : item.author;
  if (!first || typeof first !== "object") return null;
  return orNull(plainTitle(stringOf((first as Node).name), 200));
}

function jsonItem(item: Node): SubscriptionItem {
  const summary = stringOf(item.summary).trim();
  const text = stringOf(item.content_text);
  const html = stringOf(item.content_html);
  // summary and content_text are plain text, so escaping them keeps a "<" in them from reading as a tag.
  const snippet = summary.length > 0 ? plainText(escapeHtml(summary)) : text.trim().length > 0 ? plainText(escapeHtml(text)) : plainText(html);
  const id = typeof item.id === "number" ? String(item.id) : stringOf(item.id);
  return {
    title: plainTitle(stringOf(item.title)),
    url: (stringOf(item.url) || stringOf(item.external_url)).trim(),
    snippet,
    publishedAt: parseDate(item.date_published) ?? parseDate(item.date_modified),
    key: orNull(id),
    author: jsonAuthor(item),
    contentHtml: html.trim().length > 0 ? html.trim() : textAsHtml(text),
    // The attachments of JSON Feed are not read (add-json-feed); it has no Media RSS description.
    attachments: [],
    description: null,
  };
}

/** A JSON Feed read in full, or null when the text is not one. */
export function parseJsonFeed(text: string): ParsedSubscription | null {
  if (!text.trimStart().startsWith("{")) return null;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (!root || typeof root !== "object" || !stringOf((root as Node).version).startsWith(JSON_FEED_VERSION)) return null;
  const feed = root as Node;
  const items = Array.isArray(feed.items) ? feed.items.filter((item): item is Node => !!item && typeof item === "object") : [];
  return {
    title: plainText(stringOf(feed.title), 200),
    siteUrl: siteLink(feed.home_page_url, (link) => stringOf(link).trim()),
    items: items.map(jsonItem),
  };
}

/**
 * Reads RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed with everything a reader shows: identifier, author, content
 * and, but for JSON Feed, attachments. `feedUrl`, the address the document came from, resolves the relative
 * pages of items.
 */
export function parseSubscription(xml: string, feedUrl: string | null = null): ParsedSubscription {
  const json = parseJsonFeed(xml);
  if (json) return json;
  const root = parseXml(xml);
  const rss = (root.rss as Node | undefined)?.channel as Node | undefined;
  if (rss) {
    return {
      title: plainText(textOf(rss.title), 200),
      siteUrl: siteLink(rss.link, rssLink),
      items: ((rss.item as Node[] | undefined) ?? []).map((item) => rssSubscriptionItem(item, feedUrl)),
    };
  }
  const rdf = root["rdf:RDF"] as Node | undefined;
  if (rdf) {
    const channel = rdf.channel as Node | undefined;
    return {
      title: plainText(textOf(channel?.title), 200),
      siteUrl: siteLink(channel?.link, rssLink),
      items: ((rdf.item as Node[] | undefined) ?? []).map((item) => rssSubscriptionItem(item, feedUrl)),
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
      items: entries.map((entry, index) => {
        const read = atomEntry(entry);
        const contentHtml = atomContent(entry, rawEntries[index]);
        return {
          ...read,
          key: orNull(textOf(entry.id)),
          author: atomAuthor(entry),
          contentHtml,
          ...mediaOf(entry, read.url, contentHtml, feedUrl),
        };
      }),
    };
  }
  throw new Error("the document is not a feed");
}

export async function fetchXml(fetcher: Fetcher, url: string): Promise<string> {
  const response = await fetcher.get(url, { headers: { accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*"} });
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
