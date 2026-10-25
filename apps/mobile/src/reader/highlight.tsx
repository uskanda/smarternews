import { groupRuns, splitHighlights, type HighlightPart, type TermMatcher } from "@smarternews/client";
import type { TermGroup } from "@smarternews/core/api";
import type { ReactNode } from "react";
import { Text } from "react-native";
import { useTheme, type Theme } from "../theme/theme";

/** The words of a part, drawn as `search-match` in DESIGN.md when they matched the search. */
function words(part: HighlightPart, key: string, theme: Theme) {
  return part.search ? (
    <Text
      key={key}
      testID="search-match"
      style={{ backgroundColor: theme.colors["search-match"], textDecorationLine: "underline", textDecorationColor: theme.colors["search-match-line"] }}
    >
      {part.text}
    </Text>
  ) : (
    part.text
  );
}

/**
 * A run of one term group, drawn as `term-match-<colour>` in DESIGN.md: the fill of the group's colour and a
 * line under it. Android draws the line in the colour of the text; the fill tells the group.
 */
function run(entry: { group: TermGroup | null; parts: HighlightPart[] }, key: number, theme: Theme) {
  const inner = entry.parts.map((part, index) => words(part, `${key}.${index}`, theme));
  if (!entry.group) return inner;
  const color = entry.group.color;
  return (
    <Text key={key} testID={`term-match-${color}`} style={{ backgroundColor: theme.colors[`term-${color}-fill`], textDecorationLine: "underline" }}>
      {inner}
    </Text>
  );
}

/**
 * Text, inside a `Text`, with the words that matched the search drawn as `search-match`, and the terms of the
 * term groups of `groups` coloured. Without either, the text is drawn as it is. Both are found as the server
 * finds them: case and width do not matter.
 */
export function Highlighted({ text, terms, groups }: { text: string; terms: readonly string[] | undefined; groups?: TermMatcher | null }) {
  const theme = useTheme();
  const colored = groups && !groups.empty ? groups : null;
  if ((!terms || terms.length === 0) && !colored) return text;
  return groupRuns(splitHighlights(text, colored, terms)).flatMap((entry, index) => run(entry, index, theme));
}

/**
 * The text as it is when nothing in it is marked or coloured, else the text drawn by `Highlighted`. A plain
 * text stays a plain child of its `Text`.
 */
export function highlight(text: string, terms: readonly string[] | undefined, groups?: TermMatcher | null): ReactNode {
  const searched = terms !== undefined && terms.length > 0;
  const colored = groups && !groups.empty && groups.split(text).some((part) => part.group !== null);
  return searched || colored ? <Highlighted text={text} terms={terms} groups={groups} /> : text;
}
