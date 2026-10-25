// Candidates for the selectors of a web feed, found by rule in the parts of a page with many links. Used when
// the model cannot be: the rules give the same answer for the same page, and no model is involved.
import { parseHTML } from "linkedom";
import type { PageSelectors } from "../api.ts";

interface Node {
  readonly localName: string;
  readonly textContent: string | null;
  readonly parentElement: Node | null;
  readonly children: ArrayLike<Node>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): Node | null;
  querySelectorAll(selector: string): Iterable<Node>;
  closest(selector: string): Node | null;
}

/** A group needs this many elements, and this share of them with a link that has text. */
const MIN_GROUP = 3;
const LINKED_SHARE = 0.8;
const MAX_CANDIDATES = 3;
/** How far up the nearest ancestor with an id may be; further up, classes are joined instead. */
const MAX_ID_DEPTH = 4;
/** Levels joined by classes when no ancestor with an id is near: the item and two above it. */
const CLASS_LEVELS = 3;
/** Rows of links in these are menus, rankings and the like, not the articles of the page. */
const OUTSIDE = "nav, header, footer, aside";

const IDENTIFIER = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

function classesOf(element: Node): string[] {
  return (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((name) => IDENTIFIER.test(name))
    .sort();
}

/** The element name and its classes, as a part of a selector: `article.entry`. */
function part(element: Node): string {
  return [element.localName, ...classesOf(element)].join(".");
}

function idOf(element: Node): string | null {
  const id = element.getAttribute("id")?.trim() ?? "";
  return IDENTIFIER.test(id) ? id : null;
}

/** The text of the link of an item: the item itself when it is a link, else its first link with text. */
function linkText(item: Node): string {
  const text = (node: Node) => (node.textContent ?? "").replace(/\s+/g, " ").trim();
  if (item.localName === "a" && item.hasAttribute("href")) return text(item);
  for (const link of item.querySelectorAll("a[href]")) {
    const found = text(link);
    if (found.length > 0) return found;
  }
  return "";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * The selector of the items of a group under `parent`: child combinators down from the nearest ancestor with an
 * id, or, without one near, the classes of the item and of up to two levels above it.
 */
function itemSelector(parent: Node, item: Node): string {
  const chain = [part(item)];
  let current: Node | null = parent;
  for (let depth = 0; current !== null && depth < MAX_ID_DEPTH; depth += 1) {
    const id = idOf(current);
    if (id !== null) return [`#${id}`, ...chain].join(" > ");
    chain.unshift(part(current));
    current = current.parentElement;
  }
  const levels = [part(item)];
  for (let above: Node | null = parent; above !== null && levels.length < CLASS_LEVELS; above = above.parentElement) {
    if (above.localName === "body" || above.localName === "html") break;
    levels.unshift(part(above));
  }
  return levels.join(" > ");
}

interface Region {
  selectors: PageSelectors;
  score: number;
}

/**
 * Up to three sets of selectors for the lists of links of a page, the likeliest first. A group is the children
 * of one element that share their element name and classes: three or more, most of them with a link that has
 * text, outside navigation, headers, footers and sidebars. The more items and the longer their link texts, the
 * likelier. An empty list when the page has no such group.
 */
export function inferSelectors(html: string): PageSelectors[] {
  const { document } = parseHTML(html) as unknown as { document: { querySelectorAll(selector: string): Iterable<Node> } };
  const regions: Region[] = [];
  for (const parent of document.querySelectorAll("*")) {
    if (parent.closest(OUTSIDE) !== null) continue;
    const groups = new Map<string, Node[]>();
    for (const child of Array.from(parent.children)) {
      const key = part(child);
      groups.set(key, [...(groups.get(key) ?? []), child]);
    }
    for (const members of groups.values()) {
      if (members.length < MIN_GROUP) continue;
      const texts = members.map(linkText).filter((text) => text.length > 0);
      if (texts.length < members.length * LINKED_SHARE) continue;
      const withTime = members.filter((member) => member.querySelector("time") !== null).length;
      const selectors: PageSelectors = { item: itemSelector(parent, members[0]!) };
      if (withTime > 0) selectors.date = "time";
      regions.push({ selectors, score: members.length * median(texts.map((text) => text.length)) });
    }
  }
  const seen = new Set<string>();
  return regions
    .sort((a, b) => b.score - a.score)
    .map((region) => region.selectors)
    .filter((selectors) => !seen.has(selectors.item) && seen.add(selectors.item))
    .slice(0, MAX_CANDIDATES);
}
