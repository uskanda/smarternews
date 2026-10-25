import { groupRuns, splitHighlights, type HighlightPart, type TermMatcher } from "@smarternews/client";
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

function markText(node: HastNode, search: readonly string[] | undefined, matcher: TermMatcher | null): HastNode[] {
  // A raw piece of HTML is shown as its characters: react-markdown turns it into text after the plugins run,
  // and here it becomes that text a little earlier, so that its words are marked like any other.
  if (node.type === "text" || node.type === "raw") {
    const value = (node as HastText).value;
    const parts = splitHighlights(value, matcher, search);
    if (!parts.some((part) => part.search || part.group)) return [text(value)];
    return groupRuns(parts).flatMap((run): HastNode[] => {
      const inner = run.parts.map((part) => (part.search ? element(SEARCH_MATCH, [text(part.text)]) : text(part.text)));
      return run.group ? [element(TERM_MATCH, inner, run.group.color)] : inner;
    });
  }
  if ("children" in node && Array.isArray(node.children)) node.children = node.children.flatMap((child) => markText(child, search, matcher));
  return [node];
}

/**
 * A rehype plugin that marks, in the text of a rendered body, code included, the matches of the search terms
 * and the terms of the term groups. Only text is touched: the address of a link or an image is never matched,
 * and a raw piece of HTML stays text, as the body never renders it.
 */
export function rehypeHighlights(search: readonly string[] | undefined, matcher: TermMatcher | null) {
  return () => (tree: HastNode) => {
    markText(tree, search, matcher);
  };
}
