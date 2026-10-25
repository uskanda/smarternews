// Finding highlights in the body a screen draws. A highlight is kept as its text, the text right before and
// after it, and where it starts, all counted without spaces and line breaks; so it is found again after the
// body changes, and the web app and the Android app, which turn Markdown into text in their own ways, find it
// in the same place. Pure functions without a UI library. No model is involved.
import { ANCHOR_CONTEXT_CHARS } from "@smarternews/core/api";

/** What a screen saves to find a selection again: the fields of a new highlight. */
export interface HighlightAnchor {
  quote: string;
  /** Up to 32 characters right before the quote, without spaces. */
  prefix: string;
  /** Up to 32 characters right after the quote, without spaces. */
  suffix: string;
  /** Where the quote starts, counted in the body without spaces. */
  position: number;
}

/** A saved highlight, as much of it as finding it needs. */
export interface LocatableHighlight extends HighlightAnchor {
  id: number;
  createdAt: string;
}

/** A part of the body that one highlight marks. A highlight may have several when an older one cuts it. */
export interface LocatedRange<H extends LocatableHighlight> {
  highlight: H;
  /** Start in the body, inclusive, in UTF-16 units. */
  start: number;
  /** End in the body, exclusive, in UTF-16 units. */
  end: number;
}

export interface LocatedHighlights<H extends LocatableHighlight> {
  /** The marked parts, in the order of the body. No two overlap. */
  ranges: Array<LocatedRange<H>>;
  /** The highlights not found, or wholly under older ones, oldest first. */
  missing: H[];
}

const SPACE = /\s/u;

/** The body without spaces and line breaks, with the position in the body each of its units came from. */
function compact(text: string): { text: string; at: number[] } {
  let out = "";
  const at: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (SPACE.test(char)) continue;
    out += char;
    at.push(index);
  }
  return { text: out, at };
}

function withoutSpaces(text: string): string {
  return text.replace(/\s+/gu, "");
}

function isLowSurrogate(text: string, at: number): boolean {
  const code = text.charCodeAt(at);
  return code >= 0xdc00 && code <= 0xdfff;
}

/** At most `ANCHOR_CONTEXT_CHARS` units of `text` before `end`, never starting in the middle of a character. */
function before(text: string, end: number): string {
  let start = Math.max(0, end - ANCHOR_CONTEXT_CHARS);
  if (start > 0 && isLowSurrogate(text, start)) start += 1;
  return text.slice(start, end);
}

/** At most `ANCHOR_CONTEXT_CHARS` units of `text` from `start`, never ending in the middle of a character. */
function after(text: string, start: number): string {
  let end = Math.min(text.length, start + ANCHOR_CONTEXT_CHARS);
  if (end < text.length && isLowSurrogate(text, end)) end -= 1;
  return text.slice(start, end);
}

/**
 * The anchor of the selection from `start` to `end` of the body as a screen drew it. Spaces at the ends of the
 * selection are left out. Null when nothing but spaces is selected.
 */
export function anchorOf(text: string, start: number, end: number): HighlightAnchor | null {
  let from = Math.max(0, start);
  let to = Math.min(text.length, end);
  while (from < to && SPACE.test(text[from]!)) from += 1;
  while (to > from && SPACE.test(text[to - 1]!)) to -= 1;
  if (from >= to) return null;
  const head = withoutSpaces(text.slice(0, from));
  const tail = withoutSpaces(text.slice(to));
  return { quote: text.slice(from, to), prefix: before(head, head.length), suffix: after(tail, 0), position: head.length };
}

/** How many units the ends of two texts share. */
function sharedEnd(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) count += 1;
  return count;
}

/** How many units the starts of two texts share. */
function sharedStart(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
}

const byAge = (a: LocatableHighlight, b: LocatableHighlight) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id;

/**
 * Where the highlights are in the body a screen drew. Spaces and line breaks do not count; case and width do.
 * Where the quote occurs more than once, the occurrence whose text around it matches the saved text best is
 * taken, and of equals the one nearest the saved position. Where two highlights overlap, the older one marks
 * the characters they share.
 */
export function locateHighlights<H extends LocatableHighlight>(text: string, highlights: readonly H[]): LocatedHighlights<H> {
  const sorted = [...highlights].sort(byAge);
  if (sorted.length === 0) return { ranges: [], missing: [] };
  const body = compact(text);
  // For each unit of the compact body, the highlight that marks it, oldest first.
  const owner = new Int32Array(body.text.length).fill(-1);
  const missing: H[] = [];
  sorted.forEach((highlight, index) => {
    const quote = withoutSpaces(highlight.quote);
    if (quote.length === 0) {
      missing.push(highlight);
      return;
    }
    const prefix = withoutSpaces(highlight.prefix);
    const suffix = withoutSpaces(highlight.suffix);
    let best = -1;
    let bestScore = -1;
    let bestDistance = Infinity;
    for (let from = body.text.indexOf(quote); from !== -1; from = body.text.indexOf(quote, from + 1)) {
      const score =
        sharedEnd(before(body.text, from), prefix) + sharedStart(after(body.text, from + quote.length), suffix);
      const distance = Math.abs(from - highlight.position);
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        best = from;
        bestScore = score;
        bestDistance = distance;
      }
    }
    if (best === -1) {
      missing.push(highlight);
      return;
    }
    let marks = false;
    for (let at = best; at < best + quote.length; at += 1) {
      if (owner[at] === -1) {
        owner[at] = index;
        marks = true;
      }
    }
    // Wholly under older highlights, it would not be seen: it is listed with those not found.
    if (!marks) missing.push(highlight);
  });
  const ranges: Array<LocatedRange<H>> = [];
  let at = 0;
  while (at < owner.length) {
    const index = owner[at]!;
    let end = at + 1;
    while (end < owner.length && owner[end] === index) end += 1;
    if (index !== -1) ranges.push({ highlight: sorted[index]!, start: body.at[at]!, end: body.at[end - 1]! + 1 });
    at = end;
  }
  return { ranges, missing };
}

/** Between the texts of two parts of a body, such as the originals of a translated body, when they are joined. */
export const PART_SEPARATOR = "\n";

/** Where each part starts in the text the parts make when joined with `PART_SEPARATOR`. */
export function partStarts(texts: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const text of texts) {
    starts.push(at);
    at += text.length + PART_SEPARATOR.length;
  }
  return starts;
}

/** A part of the text of one part of a body that a highlight marks, counted from the start of that part. */
export interface PartRange {
  start: number;
  end: number;
  id: number;
  /** Whether the highlight has a note. */
  note: boolean;
  /** The first part of the highlight: the one that takes the focus. */
  first: boolean;
  /** The last part of the highlight: the one the icon of its note follows. */
  last: boolean;
}

/**
 * The ranges found in the joined text of the parts of a body, cut where a part ends and counted from the start of
 * each part: what each part draws. A highlight that spans two parts is marked in both.
 */
export function rangesByPart<H extends LocatableHighlight & { note: string | null }>(located: LocatedHighlights<H>, texts: readonly string[]): PartRange[][] {
  const starts = partStarts(texts);
  const firstStart = new Map<number, number>();
  const lastEnd = new Map<number, number>();
  for (const range of located.ranges) {
    const id = range.highlight.id;
    firstStart.set(id, Math.min(firstStart.get(id) ?? Infinity, range.start));
    lastEnd.set(id, Math.max(lastEnd.get(id) ?? -Infinity, range.end));
  }
  const byPart = texts.map((): PartRange[] => []);
  for (const range of located.ranges) {
    texts.forEach((text, index) => {
      const from = Math.max(range.start, starts[index]!);
      const to = Math.min(range.end, starts[index]! + text.length);
      if (from >= to) return;
      byPart[index]!.push({
        start: from - starts[index]!,
        end: to - starts[index]!,
        id: range.highlight.id,
        note: range.highlight.note !== null,
        first: from === firstStart.get(range.highlight.id),
        last: to === lastEnd.get(range.highlight.id),
      });
    });
  }
  return byPart;
}

/** Cuts a run of text, which starts at `from` in the text of its part, where the ranges begin and end. */
export function cutByRanges(text: string, from: number, ranges: readonly PartRange[]): Array<{ text: string; range: PartRange | null; first: boolean; last: boolean }> {
  const inside = ranges.filter((range) => range.start < from + text.length && range.end > from).sort((a, b) => a.start - b.start);
  if (inside.length === 0) return [{ text, range: null, first: false, last: false }];
  const pieces: Array<{ text: string; range: PartRange | null; first: boolean; last: boolean }> = [];
  let cut = 0;
  for (const range of inside) {
    const start = Math.max(range.start - from, 0);
    const end = Math.min(range.end - from, text.length);
    if (start > cut) pieces.push({ text: text.slice(cut, start), range: null, first: false, last: false });
    pieces.push({ text: text.slice(start, end), range, first: range.first && from + start === range.start, last: range.last && from + end === range.end });
    cut = end;
  }
  if (cut < text.length) pieces.push({ text: text.slice(cut), range: null, first: false, last: false });
  return pieces;
}
