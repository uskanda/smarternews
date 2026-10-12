// The adapter of Google's Cloud Translation API, basic edition (v2). Segments travel as HTML: sent as
// Markdown, the marks of emphasis and the brackets of links come back broken. The answer is rewritten as
// Markdown by the same conversion that reads a feed, so a tag the answer slipped in does not survive.
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

function htmlOf(item: TranslationItem): string {
  return item.plain ? escapeHtml(item.text) : renderMarkdown(item.text, { images: true });
}

/** The characters a request for these items sends. The tags count too, so the count errs on the high side. */
export function googleChars(items: TranslationItem[]): number {
  return items.reduce((sum, item) => sum + htmlOf(item).length, 0);
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
    for (const batch of batches(items.map(htmlOf))) {
      for (const entry of await this.#send(batch, target)) {
        if (typeof entry.translatedText !== "string") throw new Error("the translation API answered without a translation");
        translated.push(entry.translatedText);
        const language = entry.detectedSourceLanguage;
        if (typeof language === "string" && language.length > 0) languages.set(language, (languages.get(language) ?? 0) + 1);
      }
    }
    const texts = translated.map((html, index) => {
      const converted = convertContent(html, BASE_URL);
      const item = items[index]!;
      const text = item.plain ? converted.text : renumbered(converted.markdown, item.text);
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
