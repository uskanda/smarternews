import { splitByMatches } from "@smarternews/core/api";

/** The class of a word that matched the search. Its look is `search-match` in DESIGN.md. */
export const SEARCH_MATCH = "search-match";

/**
 * A text with the words that matched the search marked. The terms are those the server matched with, and
 * `splitByMatches` finds them as the server does: case and width do not matter.
 */
export function Highlighted({ text, terms }: { text: string; terms: readonly string[] | undefined }) {
  if (!terms || terms.length === 0) return <>{text}</>;
  return (
    <>
      {splitByMatches(text, terms).map((part, index) =>
        part.match ? (
          <mark key={index} className={SEARCH_MATCH}>
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
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

function markText(node: HastNode, terms: readonly string[]): HastNode[] {
  if (node.type === "text") {
    const parts = splitByMatches((node as HastText).value, terms);
    if (!parts.some((part) => part.match)) return [node];
    return parts.map((part): HastNode =>
      part.match
        ? { type: "element", tagName: "mark", properties: { className: [SEARCH_MATCH] }, children: [{ type: "text", value: part.text }] }
        : { type: "text", value: part.text },
    );
  }
  if ("children" in node && Array.isArray(node.children)) node.children = node.children.flatMap((child) => markText(child, terms));
  return [node];
}

/**
 * A rehype plugin that marks the matches of the terms in the text of a rendered body, code included. Only
 * text is touched: a raw piece of HTML stays text, as the body never renders it.
 */
export function rehypeSearchMatch(terms: readonly string[]) {
  return () => (tree: HastNode) => {
    markText(tree, terms);
  };
}
