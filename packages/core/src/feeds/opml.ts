// OPML is how feed readers hand over a list of subscriptions. A folder stands for a category; nothing else
// of a category (topics, schedule) is in it, and neither are the feeds that are only sources of a topic.
import { XMLParser } from "fast-xml-parser";
import type { OpmlImportResult } from "../api.ts";
import type { Clock } from "../clock.ts";
import { createCategory, listCategories } from "../db/categories.ts";
import { transaction, type Database } from "../db/database.ts";
import { findFeedByUrl, insertFeed, listFeeds } from "../db/feeds.ts";
import { DomainError } from "../errors.ts";
import { normalizeUrl } from "../fetch/url.ts";

export interface OpmlFeed {
  url: string;
  title: string;
  /** The outermost folder the feed is in, or null when it is in none. */
  folder: string | null;
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  isArray: (name) => name === "outline",
});

function attribute(node: Node, name: string): string {
  // Attribute names are written in several casings in the wild: xmlUrl, xmlurl, XMLURL.
  const key = Object.keys(node).find((candidate) => candidate.toLowerCase() === `@_${name.toLowerCase()}`);
  return key === undefined ? "" : String(node[key] ?? "").trim();
}

function invalid(message: string): DomainError {
  return new DomainError("invalid", message);
}

function collect(outlines: Node[], folder: string | null, into: OpmlFeed[]): void {
  for (const outline of outlines) {
    const name = (attribute(outline, "text") || attribute(outline, "title")).replace(/\s+/g, " ");
    const address = attribute(outline, "xmlUrl");
    if (address.length > 0) {
      let url: URL;
      try {
        url = new URL(address);
      } catch {
        continue;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      into.push({ url: normalizeUrl(url.toString()), title: name.slice(0, 200) || url.host, folder });
      continue;
    }
    // An outline without an address is a folder. Folders inside it count as the outermost one.
    collect((outline.outline as Node[] | undefined) ?? [], folder ?? (name.length > 0 ? name.slice(0, 100) : null), into);
  }
}

/** The feeds an OPML document lists, in document order. Refuses a document that is not OPML. */
export function parseOpml(text: string): OpmlFeed[] {
  let root: Node;
  try {
    root = parser.parse(text) as Node;
  } catch (error) {
    throw invalid(`the document is not OPML: ${(error as Error).message}`);
  }
  const opml = root.opml as Node | undefined;
  if (!opml || typeof opml !== "object") throw invalid("the document is not OPML: it has no opml element");
  const body = opml.body as Node | undefined;
  const feeds: OpmlFeed[] = [];
  collect((body && typeof body === "object" ? (body.outline as Node[] | undefined) : undefined) ?? [], null, feeds);
  return feeds;
}

/**
 * Subscribes to the feeds of an OPML document that are not subscribed yet, without fetching them: the
 * poller fetches each when its turn comes. Nothing is deleted or moved, and nothing is stored when any
 * entry is refused.
 */
export function importOpml(db: Database, text: string, clock: Clock): OpmlImportResult {
  const feeds = parseOpml(text);
  const result: OpmlImportResult = { feedsCreated: 0, feedsSkipped: 0, categoriesCreated: 0 };
  transaction(db, () => {
    const byName = new Map(listCategories(db).map((category) => [category.name, category]));
    for (const feed of feeds) {
      if (findFeedByUrl(db, feed.url)) {
        result.feedsSkipped += 1;
        continue;
      }
      let categoryId: number | null = null;
      if (feed.folder !== null) {
        let category = byName.get(feed.folder);
        if (!category) {
          category = createCategory(db, { name: feed.folder, kind: "news" }, clock);
          byName.set(feed.folder, category);
          result.categoriesCreated += 1;
        }
        // A feed cannot belong to an event category; it is kept, without a category.
        categoryId = category.kind === "news" ? category.id : null;
      }
      insertFeed(db, { url: feed.url, title: feed.title, titleSetByUser: true, categoryId }, clock);
      result.feedsCreated += 1;
    }
  });
  return result;
}

function xmlAttribute(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Every subscribed feed as OPML 2.0, with the categories that hold feeds as folders. */
export function exportOpml(db: Database): string {
  const feeds = listFeeds(db);
  const line = (feed: (typeof feeds)[number], indent: string) =>
    `${indent}<outline type="rss" text="${xmlAttribute(feed.title)}" title="${xmlAttribute(feed.title)}" xmlUrl="${xmlAttribute(feed.url)}"` +
    `${feed.siteUrl ? ` htmlUrl="${xmlAttribute(feed.siteUrl)}"` : ""}/>`;
  const lines: string[] = [];
  for (const category of listCategories(db)) {
    const inside = feeds.filter((feed) => feed.categoryId === category.id);
    if (inside.length === 0) continue;
    lines.push(`    <outline text="${xmlAttribute(category.name)}" title="${xmlAttribute(category.name)}">`);
    for (const feed of inside) lines.push(line(feed, "      "));
    lines.push("    </outline>");
  }
  for (const feed of feeds.filter((entry) => entry.categoryId === null)) lines.push(line(feed, "    "));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', "  <head>", "    <title>smarternews</title>", "  </head>", "  <body>", ...lines, "  </body>", "</opml>", ""].join("\n");
}
