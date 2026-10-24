// What a feed delivers as an item's content is HTML written by someone else. It is never stored or shown as
// HTML: this module rewrites it as Markdown that keeps only paragraphs, headings, lists, quotes, emphasis,
// code, links and images. Scripts, styles, frames and every attribute but a link's or an image's address go.
import { parseHTML } from "linkedom";

export const MAX_CONTENT_CHARS = 100_000;

export interface ConvertedContent {
  markdown: string;
  /** The words alone on one line, without markup, link targets or image addresses. Stop words are matched against it. */
  text: string;
}

// The subset of the DOM this module uses. The project does not load the DOM type library.
interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: Iterable<DomNode>;
  getAttribute?(name: string): string | null;
}

const ELEMENT = 1;
const TEXT = 3;

/** Elements whose content is not for reading. */
const DROPPED = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "VIDEO", "AUDIO", "CANVAS", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "SELECT",
  "TEXTAREA", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "LINK", "META",
]);

const BLOCKS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "FIGURE", "FIGCAPTION", "ADDRESS", "DETAILS", "SUMMARY",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "DL", "DT", "DD", "BLOCKQUOTE", "PRE", "HR", "TABLE", "THEAD", "TBODY", "TFOOT",
  "TR", "CAPTION",
]);

// The title of the article is the first level, so content headings start one below it.
const HEADING_MARKS: Record<string, string> = { H1: "##", H2: "##", H3: "###", H4: "####", H5: "####", H6: "####" };

const NOTICE = { ja: "（長い内容のため、ここまでを表示しています。）", en: "(The content is long and ends here.)" };

interface Context {
  baseUrl: string;
  /** Plain mode yields the words only: no markup, no addresses. */
  plain: boolean;
}

function children(node: DomNode): DomNode[] {
  return [...node.childNodes];
}

function attribute(node: DomNode, name: string): string {
  return node.getAttribute?.(name)?.trim() ?? "";
}

function escapeText(text: string): string {
  return text.replace(/[\\*_`[\]]/g, "\\$&");
}

/** An absolute URL of one of the given schemes, written so that it cannot end a Markdown link early. */
function resolve(raw: string, baseUrl: string, schemes: readonly string[]): string | null {
  if (raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (!schemes.includes(url.protocol)) return null;
  return url.toString().replaceAll("(", "%28").replaceAll(")", "%29").replaceAll(" ", "%20").replaceAll("<", "%3C").replaceAll(">", "%3E");
}

function isTrackingPixel(node: DomNode): boolean {
  const small = (name: string) => /^[01](px)?$/.test(attribute(node, name));
  return small("width") || small("height");
}

function image(node: DomNode, ctx: Context): string {
  if (ctx.plain || isTrackingPixel(node)) return "";
  const url = resolve(attribute(node, "src"), ctx.baseUrl, ["http:", "https:"]);
  if (!url) return "";
  return `![${escapeText(attribute(node, "alt").replace(/\s+/g, " "))}](${url})`;
}

function onlyImages(node: DomNode): boolean {
  const meaningful = children(node).filter((child) => child.nodeType === ELEMENT || (child.textContent ?? "").trim().length > 0);
  return meaningful.length > 0 && meaningful.every((child) => child.nodeName === "IMG" || (child.nodeType === ELEMENT && onlyImages(child)));
}

function wrap(mark: string, inner: string, ctx: Context): string {
  const trimmed = inner.trim();
  if (ctx.plain || trimmed.length === 0) return inner;
  return `${inner.startsWith(" ") ? " " : ""}${mark}${trimmed}${mark}${inner.endsWith(" ") ? " " : ""}`;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return longest > 0 ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

function inline(node: DomNode, ctx: Context): string {
  if (node.nodeType === TEXT) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ");
    return ctx.plain ? text : escapeText(text);
  }
  if (node.nodeType !== ELEMENT || DROPPED.has(node.nodeName)) return "";
  const inner = () => children(node).map((child) => inline(child, ctx)).join("");
  switch (node.nodeName) {
    case "BR":
      return ctx.plain ? " " : "\\\n";
    case "IMG":
      return image(node, ctx);
    case "STRONG":
    case "B":
      return wrap("**", inner(), ctx);
    case "EM":
    case "I":
      return wrap("*", inner(), ctx);
    case "CODE":
    case "KBD":
    case "SAMP": {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      return ctx.plain || text.length === 0 ? text : codeSpan(text);
    }
    case "A": {
      const text = inner();
      const url = ctx.plain || onlyImages(node) ? null : resolve(attribute(node, "href"), ctx.baseUrl, ["http:", "https:"]);
      return url && text.trim().length > 0 ? `[${text.trim()}](${url})` : text;
    }
    default:
      // A block met inside a run of text is read as text, set apart by spaces.
      return BLOCKS.has(node.nodeName) ? ` ${inner()} ` : inner();
  }
}

/** A finished run of text as one paragraph, or nothing when it holds no words. */
function paragraph(run: string, ctx: Context): string | null {
  const text = run
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\\\n ?/g, "\\\n")
    .replace(/^(\\\n)+|(\\\n)+$/g, "")
    .trim();
  if (text.length === 0) return null;
  if (ctx.plain) return text;
  // At the start of a line these would begin a heading, a quote, a list or a rule.
  return text.replace(/^(#{1,6}(?=\s)|>|[-+](?=\s)|-{3,}$|={3,}$)/, "\\$1").replace(/^(\d+)([.)])(?=\s)/, "$1\\$2");
}

function indent(block: string, prefix: string): string {
  return block
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${prefix}${line}`))
    .join("\n");
}

function list(node: DomNode, ordered: boolean, ctx: Context): string | null {
  const lines: string[] = [];
  let number = 1;
  for (const item of children(node)) {
    if (item.nodeName !== "LI") continue;
    const parts = blocksOf(item, ctx);
    if (parts.length === 0) continue;
    if (ctx.plain) {
      lines.push(parts.join(" "));
      continue;
    }
    const marker = ordered ? `${number}. ` : "- ";
    number += 1;
    lines.push(`${marker}${indent(parts.join("\n"), " ".repeat(marker.length))}`);
  }
  return lines.length > 0 ? lines.join(ctx.plain ? " " : "\n") : null;
}

function fenced(node: DomNode, ctx: Context): string | null {
  const text = (node.textContent ?? "").replace(/^\n+|\s+$/g, "");
  if (text.length === 0) return null;
  if (ctx.plain) return text.replace(/\s+/g, " ");
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

function block(node: DomNode, ctx: Context): string[] {
  const name = node.nodeName;
  if (name in HEADING_MARKS) {
    const text = paragraph(inlineLine(node, ctx), ctx);
    if (!text) return [];
    return [ctx.plain ? text : `${HEADING_MARKS[name]} ${text}`];
  }
  switch (name) {
    case "UL":
    case "OL": {
      const text = list(node, name === "OL", ctx);
      return text ? [text] : [];
    }
    case "BLOCKQUOTE": {
      const parts = blocksOf(node, ctx);
      if (parts.length === 0) return [];
      if (ctx.plain) return [parts.join(" ")];
      return [
        parts
          .join("\n\n")
          .split("\n")
          .map((line) => (line.length > 0 ? `> ${line}` : ">"))
          .join("\n"),
      ];
    }
    case "PRE": {
      const text = fenced(node, ctx);
      return text ? [text] : [];
    }
    case "HR":
      return ctx.plain ? [] : ["---"];
    case "TR": {
      const cells = children(node)
        .filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH")
        .map((cell) => blocksOf(cell, ctx).join(" ").replaceAll("\n", " "))
        .filter((cell) => cell.length > 0);
      return cells.length > 0 ? [cells.join(ctx.plain ? " " : " | ")] : [];
    }
    default:
      return blocksOf(node, ctx);
  }
}

function inlineLine(node: DomNode, ctx: Context): string {
  return children(node)
    .map((child) => inline(child, ctx))
    .join("")
    .replaceAll("\\\n", " ");
}

/** The blocks made by the children of a node: runs of text become paragraphs, block elements their own blocks. */
function blocksOf(node: DomNode, ctx: Context): string[] {
  const result: string[] = [];
  let run = "";
  const flush = () => {
    const text = paragraph(run, ctx);
    if (text) result.push(text);
    run = "";
  };
  for (const child of children(node)) {
    if (child.nodeType === ELEMENT && BLOCKS.has(child.nodeName)) {
      flush();
      result.push(...block(child, ctx));
    } else {
      run += inline(child, ctx);
    }
  }
  flush();
  return result;
}

function cut(markdown: string, language: string): string {
  if (markdown.length <= MAX_CONTENT_CHARS) return markdown;
  let kept = markdown.slice(0, MAX_CONTENT_CHARS);
  const lastBreak = kept.lastIndexOf("\n\n");
  if (lastBreak > MAX_CONTENT_CHARS / 2) kept = kept.slice(0, lastBreak);
  // A code block that the cut left open would swallow the notice.
  const fences = kept.split("\n").filter((line) => /^`{3,}$/.test(line.trim())).length;
  if (fences % 2 === 1) kept += "\n```";
  return `${kept.trimEnd()}\n\n${language.toLowerCase().startsWith("ja") ? NOTICE.ja : NOTICE.en}`;
}

/**
 * Rewrites an item's content as Markdown, and gives its words for matching. `baseUrl` is the item's page:
 * relative links and images are resolved against it. `language` picks the sentence that marks a cut.
 */
export function convertContent(html: string, baseUrl: string, language = "en"): ConvertedContent {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`) as unknown as { document: { body: DomNode } };
  const body = document.body;
  const markdown = blocksOf(body, { baseUrl, plain: false }).join("\n\n");
  const text = blocksOf(body, { baseUrl, plain: true }).join(" ").replace(/\s+/g, " ").trim();
  return { markdown: cut(markdown, language), text: text.slice(0, MAX_CONTENT_CHARS) };
}
