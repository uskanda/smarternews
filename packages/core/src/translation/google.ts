// The adapter of Google's Cloud Translation API, basic edition (v2). Segments travel as HTML: sent as
// Markdown, the marks of emphasis and the brackets of links come back broken. The answer is rewritten as
// Markdown by the same conversion that reads a feed, so a tag the answer slipped in does not survive.
//
// Every character sent is paid for, tags and addresses included. So a segment is sent without the tags that
// only say what kind of block it is, and with a number in place of each address; both are put back here.
import { convertContent } from "../feeds/content.ts";
import type { Fetcher } from "../fetch/http.ts";
import { escapeHtml, renderMarkdown } from "../markdown.ts";
import type { TranslationItem, TranslationOutput, Translator } from "./adapter.ts";

/** The address is fixed: nothing a user or a feed says decides where the text goes. */
export const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";
/** One request carries at most this many segments and this many characters. */
export const GOOGLE_MAX_SEGMENTS = 128;
export const GOOGLE_MAX_CHARS = 5000;

/** Links and images of a segment are absolute already; this only satisfies the conversion. */
const BASE_URL = "https://invalid.invalid/";

/** What is sent for one segment, and what is needed to make Markdown of the answer again. */
interface Compact {
  html: string;
  /** The addresses of the links and images, in the place of which their index was sent. */
  urls: string[];
  /** What the Markdown of the block starts with ("## ", "- ", "3. ", "> ", or nothing). Null when the block was sent whole. */
  marker: string | null;
}

/** A tag that starts or ends a block, or breaks a line: with one inside, a block is sent whole. */
const BLOCK_TAG = /<\/?(?:p|ul|ol|li|blockquote|pre|h[1-6]|table|hr|div|br)\b/;

/** The inside of a block that holds running text only, and the marker its Markdown starts with. */
function unwrapped(html: string): { inner: string; marker: string } | null {
  const shapes: Array<[RegExp, (match: RegExpExecArray) => string]> = [
    [/^<p>([\s\S]*)<\/p>$/, () => ""],
    [/^<h([1-6])>([\s\S]*)<\/h\1>$/, (match) => `${"#".repeat(Number(match[1]))} `],
    [/^<ul>\n<li>([\s\S]*)<\/li>\n<\/ul>$/, () => "- "],
    [/^<ol(?: start="(\d+)")?>\n<li>([\s\S]*)<\/li>\n<\/ol>$/, (match) => `${match[1] ?? "1"}. `],
    [/^<blockquote>\n<p>([\s\S]*)<\/p>\n<\/blockquote>$/, () => "> "],
  ];
  for (const [shape, markerOf] of shapes) {
    const match = shape.exec(html);
    if (!match) continue;
    const inner = match.at(-1)!;
    return BLOCK_TAG.test(inner) ? null : { inner, marker: markerOf(match) };
  }
  return null;
}

function compact(item: TranslationItem): Compact {
  if (item.plain) return { html: escapeHtml(item.text), urls: [], marker: null };
  const urls: string[] = [];
  const numbered = (url: string) => urls.push(url) - 1;
  const html = renderMarkdown(item.text, { images: "original" })
    .trim()
    // Only the address and, for an image, its description say something; the rest is how this app draws them.
    .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>/g, (_tag, url: string) => `<a href="${numbered(url)}">`)
    .replace(/<img\s[^>]*?src="([^"]*)"[^>]*>/g, (tag: string, url: string) => `<img src="${numbered(url)}" alt="${/\salt="([^"]*)"/.exec(tag)?.[1] ?? ""}">`);
  const block = unwrapped(html);
  return block ? { html: block.inner, urls, marker: block.marker } : { html, urls, marker: null };
}

/**
 * The answer with the addresses in place of their numbers. A link or an image that names anything but a
 * number that was sent loses its tag: the answer cannot bring in an address of its own.
 */
function withUrls(html: string, urls: string[]): string {
  const known = (value: string | undefined) => (value !== undefined && /^\d+$/.test(value) ? urls[Number(value)] : undefined);
  return html
    .replace(/<a\b[^>]*>/gi, (tag) => {
      const url = known(/\shref\s*=\s*["']?([^"'\s>]*)/i.exec(tag)?.[1]);
      return url === undefined ? "" : `<a href="${url}">`;
    })
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const url = known(/\ssrc\s*=\s*["']?([^"'\s>]*)/i.exec(tag)?.[1]);
      return url === undefined ? "" : `<img src="${url}" alt="${/\salt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? ""}">`;
    });
}

/** The characters a request for these items sends: the text and the tags inside it, which are paid for too. */
export function googleChars(items: TranslationItem[]): number {
  return items.reduce((sum, item) => sum + compact(item).html.length, 0);
}

function batches(html: string[]): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of html) {
    if (current.length > 0 && (current.length >= GOOGLE_MAX_SEGMENTS || size + text.length > GOOGLE_MAX_CHARS)) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) result.push(current);
  return result;
}

const NUMBERED = /^(\d+)\. /;

/**
 * The item of a numbered list with the number its original has. A segment is one item, and the conversion
 * counts the items of every list from one.
 */
function renumbered(text: string, original: string): string {
  const number = NUMBERED.exec(original)?.[1];
  const counted = NUMBERED.exec(text)?.[1];
  if (number === undefined || counted === undefined || number === counted) return text;
  const [first, ...rest] = text.slice(counted.length).split("\n");
  // The lines that follow are indented by the width of the marker.
  const indent = (line: string) => (line.startsWith(" ".repeat(counted.length + 2)) ? " ".repeat(number.length + 2) + line.slice(counted.length + 2) : line);
  return [`${number}${first}`, ...rest.map(indent)].join("\n");
}

/** The Markdown of a block from the Markdown of its running text. */
function marked(text: string, marker: string): string {
  if (text.length === 0) return "";
  return marker === "> " ? text.split("\n").map((line) => `> ${line}`).join("\n") : `${marker}${text}`;
}

interface Answer {
  data?: { translations?: Array<{ translatedText?: unknown; detectedSourceLanguage?: unknown }> };
  error?: { message?: unknown };
}

export class GoogleTranslator implements Translator {
  readonly #fetcher: Fetcher;
  readonly #apiKey: string;

  constructor(options: { fetcher: Fetcher; apiKey: string }) {
    this.#fetcher = options.fetcher;
    this.#apiKey = options.apiKey;
  }

  async translate(items: TranslationItem[], target: string): Promise<TranslationOutput> {
    const translated: string[] = [];
    const languages = new Map<string, number>();
    const sent = items.map(compact);
    for (const batch of batches(sent.map((entry) => entry.html))) {
      for (const entry of await this.#send(batch, target)) {
        if (typeof entry.translatedText !== "string") throw new Error("the translation API answered without a translation");
        translated.push(entry.translatedText);
        const language = entry.detectedSourceLanguage;
        if (typeof language === "string" && language.length > 0) languages.set(language, (languages.get(language) ?? 0) + 1);
      }
    }
    const texts = translated.map((html, index) => {
      const item = items[index]!;
      const { urls, marker } = sent[index]!;
      const converted = convertContent(item.plain ? html : withUrls(html, urls), BASE_URL);
      const text = item.plain ? converted.text : marker === null ? renumbered(converted.markdown, item.text) : marked(converted.markdown, marker);
      if (text.length === 0) throw new Error("the translation API answered with an empty translation");
      return text;
    });
    // The language most of the segments are in.
    const sourceLanguage = [...languages].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { texts, sourceLanguage };
  }

  async #send(html: string[], target: string): Promise<NonNullable<NonNullable<Answer["data"]>["translations"]>> {
    // The key goes in a header: an address ends up in messages and logs.
    const response = await this.#fetcher.get(GOOGLE_TRANSLATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.#apiKey },
      body: JSON.stringify({ q: html, target, format: "html" }),
    });
    let answer: Answer = {};
    try {
      answer = JSON.parse(response.text) as Answer;
    } catch {
      // judged by the status below
    }
    if (response.status !== 200) {
      const detail = typeof answer.error?.message === "string" ? `: ${answer.error.message.slice(0, 200)}` : "";
      throw new Error(`the translation API answered HTTP status ${response.status}${detail}`.replaceAll(this.#apiKey, "***"));
    }
    const translations = answer.data?.translations;
    if (!Array.isArray(translations) || translations.length !== html.length) {
      throw new Error(`the translation API answered with ${Array.isArray(translations) ? translations.length : "no"} translations for ${html.length} segments`);
    }
    return translations;
  }
}
