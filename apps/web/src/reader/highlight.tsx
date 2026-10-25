import { cutByRanges, groupRuns, splitHighlights, type HighlightPart, type PartRange, type TermMatcher } from "@smarternews/client";
import type { TermGroup } from "@smarternews/core/api";
import { Fragment, type ReactNode } from "react";

/** The class of a word that matched the search. Its look is `search-match` in DESIGN.md. */
export const SEARCH_MATCH = "search-match";
/** The class of a place a term of a term group matched. Its look is `term-match-<colour>` in DESIGN.md. */
export const TERM_MATCH = "term-match";

/** The words of a part, in a search mark when they matched the search. */
function drawWords(part: { text: string; search: boolean }, key: number): ReactNode {
  return part.search ? (
    <mark key={key} className={SEARCH_MATCH}>
      {part.text}
    </mark>
  ) : (
    <Fragment key={key}>{part.text}</Fragment>
  );
}

/** A run of parts of one group: one term mark around them, or the parts alone. */
function drawRun(run: { group: TermGroup | null; parts: HighlightPart[] }, key: number): ReactNode {
  if (!run.group) return <Fragment key={key}>{run.parts.map(drawWords)}</Fragment>;
  return (
    <mark key={key} className={TERM_MATCH} data-term={run.group.color}>
      {run.parts.map(drawWords)}
    </mark>
  );
}

/**
 * A text with the words that matched the search marked, and, with `groups`, the terms of the term groups
 * coloured. The search terms are those the server matched with, and both are found as the server finds
 * them: case and width do not matter.
 */
export function Highlighted({ text, terms, groups }: { text: string; terms: readonly string[] | undefined; groups?: TermMatcher | null }) {
  if ((!terms || terms.length === 0) && (!groups || groups.empty)) return <>{text}</>;
  return <>{groupRuns(splitHighlights(text, groups ?? null, terms)).map(drawRun)}</>;
}

/** The class of a highlight the reader made on the body. Its look is `annotation-mark` in DESIGN.md. */
export const ANNOTATION_MARK = "annotation-mark";
/**
 * What an element carries when its text is no part of the text highlights are found in: the description shown
 * for an image that could not be loaded, the icon of a note. A selection is measured without it.
 */
export const SKIP_ATTRIBUTE = "data-annotation-skip";

/** The name a screen reader gives a highlight. */
export const highlightLabel = (hasNote: boolean): string => (hasNote ? "ハイライト、メモあり" : "ハイライト");

/**
 * A part of the drawn text that a highlight marks, counted in the text of one rendered body. Its first part
 * alone takes the focus with Tab; the icon of its note follows its last part.
 */
export type AnnotationRange = PartRange;

/** The highlights to mark in a rendered body, and who wants to know the text they are counted in. */
export interface AnnotationMarks {
  ranges: readonly AnnotationRange[];
  /** Told the text of the tree before it is drawn: its text nodes joined in the order of the document. */
  onText?: (text: string) => void;
}

// The few shapes of the HTML syntax tree (hast) this plugin touches.
interface HastText {
  type: "text";
  value: string;
}
interface HastElement {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const text = (value: string): HastText => ({ type: "text", value });
const element = (className: string, children: HastNode[], term?: string): HastElement => ({
  type: "element",
  tagName: "mark",
  properties: { className: [className], ...(term ? { dataTerm: term } : {}) },
  children,
});

/** The icon after a highlight with a note: a page with lines, drawn without text so that no letter is added. */
const noteIcon = (): HastElement => ({
  type: "element",
  tagName: "svg",
  properties: { className: ["annotation-note-icon"], viewBox: "0 0 16 16", ariaHidden: "true", focusable: "false", dataAnnotationSkip: "" },
  children: [
    {
      type: "element",
      tagName: "path",
      properties: { d: "M3 1.5h7l3 3v10H3z M5 7h6 M5 9.5h6 M5 12h4", fill: "none", stroke: "currentColor", strokeWidth: "1.5" },
      children: [],
    },
  ],
});

const isText = (node: HastNode): node is HastText => node.type === "text" || node.type === "raw";

/** The text nodes of the tree joined in the order of the document. A raw piece of HTML counts as its characters. */
function textOf(node: HastNode): string {
  if (isText(node)) return node.value;
  return "children" in node && Array.isArray(node.children) ? node.children.map(textOf).join("") : "";
}

/** The words of a text, marked where they matched the search and coloured where a term group matched. */
function markWords(value: string, search: readonly string[] | undefined, matcher: TermMatcher | null): HastNode[] {
  if (value.length === 0) return [];
  const parts = splitHighlights(value, matcher, search);
  if (!parts.some((part) => part.search || part.group)) return [text(value)];
  return groupRuns(parts).flatMap((run): HastNode[] => {
    const inner = run.parts.map((part) => (part.search ? element(SEARCH_MATCH, [text(part.text)]) : text(part.text)));
    return run.group ? [element(TERM_MATCH, inner, run.group.color)] : inner;
  });
}

/** A highlight around the marks of words: it is outside them, so that their lines show inside it. */
function highlight(range: AnnotationRange, children: HastNode[], first: boolean, last: boolean): HastNode[] {
  const mark: HastElement = {
    type: "element",
    tagName: "mark",
    properties: {
      className: [ANNOTATION_MARK],
      dataAnnotation: String(range.id),
      ...(first ? { tabIndex: 0, role: "button", ariaLabel: highlightLabel(range.note) } : {}),
    },
    children,
  };
  return last && range.note ? [mark, noteIcon()] : [mark];
}

function markText(
  node: HastNode,
  search: readonly string[] | undefined,
  matcher: TermMatcher | null,
  ranges: readonly AnnotationRange[],
  at: { offset: number },
): HastNode[] {
  // A raw piece of HTML is shown as its characters: react-markdown turns it into text after the plugins run,
  // and here it becomes that text a little earlier, so that its words are marked like any other.
  if (isText(node)) {
    const value = node.value;
    const from = at.offset;
    at.offset += value.length;
    if (ranges.length === 0) return markWords(value, search, matcher);
    return cutByRanges(value, from, ranges).flatMap((piece) =>
      piece.range ? highlight(piece.range, markWords(piece.text, search, matcher), piece.first, piece.last) : markWords(piece.text, search, matcher),
    );
  }
  if ("children" in node && Array.isArray(node.children)) node.children = node.children.flatMap((child) => markText(child, search, matcher, ranges, at));
  return [node];
}

/**
 * A rehype plugin that marks, in the text of a rendered body, code included, the matches of the search terms
 * and the terms of the term groups, and the reader's highlights around them. Only text is touched: the
 * address of a link or an image is never matched, and a raw piece of HTML stays text, as the body never
 * renders it. With `annotations`, the text of the tree is told before anything is marked.
 */
export function rehypeHighlights(search: readonly string[] | undefined, matcher: TermMatcher | null, annotations?: AnnotationMarks) {
  return () => (tree: HastNode) => {
    annotations?.onText?.(textOf(tree));
    markText(tree, search, matcher, annotations?.ranges ?? [], { offset: 0 });
  };
}
