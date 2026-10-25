// The text side of article search: how a query becomes terms, where terms match a text, and the excerpt of a
// result. Pure functions without Node imports: the web app and the mobile app load them to mark matches the
// same way the server finds them. No model is involved.
import { DomainError } from "../errors.ts";

/** The form in which texts are compared: full-width and half-width alike, upper and lower case alike. */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** The longest query, in characters. */
export const MAX_QUERY_CHARS = 200;

/** Terms of at most this many characters cannot use the trigram index and are matched with LIKE. */
export const SHORT_TERM_CHARS = 2;

/** The number of characters of a text, a character outside the BMP counted once. */
export function charCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * The terms of a query: normalized, split on spaces (a full-width space is one after normalizing), each once.
 * Refuses a query that is empty without its spaces, or longer than `MAX_QUERY_CHARS`.
 */
export function parseSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) throw new DomainError("invalid", "the query is empty", [{ path: "q", message: "is empty" }]);
  if (charCount(trimmed) > MAX_QUERY_CHARS) {
    throw new DomainError("invalid", `the query is too long: at most ${MAX_QUERY_CHARS} characters`, [
      { path: "q", message: `is too long: at most ${MAX_QUERY_CHARS} characters` },
    ]);
  }
  const terms = normalizeForMatch(trimmed)
    .split(/\s+/u)
    .filter((term) => term.length > 0);
  return [...new Set(terms)];
}

/** A range of the original text, start inclusive and end exclusive, in UTF-16 units. */
export type MatchRange = [number, number];

// A base character with what follows it and changes it when normalized: combining marks, and the half-width
// voiced and semi-voiced sound marks of half-width katakana.
const CLUSTER = /[\s\S][\p{M}ﾞﾟ]*/gu;

/** A text in the form it is matched in, with the way back from each position to the original. */
export interface NormalizedText {
  /** The text normalized one cluster at a time. */
  normalized: string;
  /** For each UTF-16 unit of `normalized`, the start of the original cluster it came from. */
  starts: number[];
  /** For each UTF-16 unit of `normalized`, the end of the original cluster it came from. */
  ends: number[];
}

/**
 * Normalizes `text` one cluster at a time, so that a position in the normalized text leads back to the
 * original. A cluster that widens when normalized (㍿ is four characters) leads back to the whole cluster.
 */
export function normalizeWithMap(text: string): NormalizedText {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const match of text.matchAll(CLUSTER)) {
    const start = match.index;
    const end = start + match[0].length;
    const part = normalizeForMatch(match[0]);
    normalized += part;
    for (let i = 0; i < part.length; i += 1) {
      starts.push(start);
      ends.push(end);
    }
  }
  return { normalized, starts, ends };
}

/**
 * Where the terms occur in `text`, as ranges of the original, sorted and joined where they touch or overlap.
 * A cluster that widens when normalized is marked whole when a part of it matches. Terms are expected
 * normalized, as `parseSearchTerms` returns them.
 */
export function matchRanges(text: string, terms: readonly string[]): MatchRange[] {
  const wanted = terms.filter((term) => term.length > 0);
  if (wanted.length === 0 || text.length === 0) return [];
  const { normalized, starts, ends } = normalizeWithMap(text);
  const found: MatchRange[] = [];
  for (const term of wanted) {
    let from = normalized.indexOf(term);
    while (from !== -1) {
      const last = from + term.length - 1;
      found.push([starts[from]!, ends[last]!]);
      from = normalized.indexOf(term, from + term.length);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const joined: MatchRange[] = [];
  for (const range of found) {
    const previous = joined.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else joined.push([range[0], range[1]]);
  }
  return joined;
}

/** A text cut into parts that alternate between not matching and matching, for marking matches on screen. */
export function splitByMatches(text: string, terms: readonly string[]): Array<{ text: string; match: boolean }> {
  const parts: Array<{ text: string; match: boolean }> = [];
  let at = 0;
  for (const [start, end] of matchRanges(text, terms)) {
    if (start > at) parts.push({ text: text.slice(at, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}

/** The fields an excerpt is taken from, in this order. The body is the text without Markdown and link targets. */
export interface ExcerptFields {
  summary: string;
  autoSummary: string | null;
  body: string;
  impact: string | null;
  venue: string | null;
}

/** About this many characters of an excerpt come before the match. */
const EXCERPT_BEFORE = 40;
/** About this many characters an excerpt has in all, without the marks where it was cut. */
const EXCERPT_CHARS = 120;
const CUT = "…";

/** Moves a position off the second half of a surrogate pair, so that a cut never splits a character. */
function onCharBoundary(text: string, at: number): number {
  const code = text.charCodeAt(at);
  return at > 0 && at < text.length && code >= 0xdc00 && code <= 0xdfff ? at - 1 : at;
}

/** The text around the first match in the first of the texts that has one, or null. */
function firstExcerpt(texts: ReadonlyArray<string | null>, terms: readonly string[]): string | null {
  for (const raw of texts) {
    if (!raw) continue;
    const text = raw.replace(/\s+/gu, " ").trim();
    const first = matchRanges(text, terms)[0];
    if (!first) continue;
    const start = onCharBoundary(text, Math.max(0, first[0] - EXCERPT_BEFORE));
    const end = onCharBoundary(text, Math.min(text.length, Math.max(start + EXCERPT_CHARS, first[1])));
    return `${start > 0 ? CUT : ""}${text.slice(start, end).trim()}${end < text.length ? CUT : ""}`;
  }
  return null;
}

/**
 * The text around the first match, from the first field that has one, on one line. About 40 characters come
 * before the match and about 120 in all; a cut end is marked with "…". Null when no field matches, as when the
 * terms are only in the title.
 */
export function excerptOf(fields: ExcerptFields, terms: readonly string[]): string | null {
  return firstExcerpt([fields.summary, fields.autoSummary, fields.body, fields.impact, fields.venue], terms);
}

/** The excerpt of a search result, and whether it was taken from a note of the reader's. */
export interface SearchExcerpt {
  excerpt: string | null;
  excerptFromNote: boolean;
}

/**
 * The excerpt of a search result: from the fields of the article as `excerptOf` takes it, or, when none of them
 * matches, from the reader's notes in the order given (the note on the whole article first, then those on
 * highlights oldest first). A note is taken as it was written, its Markdown marks included, on one line. A
 * highlighted text is never an excerpt: it is a copy of the body, not the reader's words.
 */
export function searchExcerpt(fields: ExcerptFields & { notes: readonly string[] }, terms: readonly string[]): SearchExcerpt {
  const excerpt = excerptOf(fields, terms);
  if (excerpt !== null) return { excerpt, excerptFromNote: false };
  const fromNote = firstExcerpt(fields.notes, terms);
  return { excerpt: fromNote, excerptFromNote: fromNote !== null };
}
