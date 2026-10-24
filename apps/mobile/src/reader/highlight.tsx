import { splitByMatches } from "@smarternews/core/api";
import { Text } from "react-native";
import { useTheme } from "../theme/theme";

/**
 * Text, inside a `Text`, with the words that matched the search drawn as `search-match` in DESIGN.md: a fill of
 * its own and a line under it. Without terms, the text is drawn as it is. They are found as the server finds
 * them: case and width do not matter.
 */
export function Highlighted({ text, terms }: { text: string; terms: readonly string[] | undefined }) {
  const theme = useTheme();
  if (!terms || terms.length === 0) return text;
  return splitByMatches(text, terms).map((part, index) =>
    part.match ? (
      <Text
        key={index}
        testID="search-match"
        style={{ backgroundColor: theme.colors["search-match"], textDecorationLine: "underline", textDecorationColor: theme.colors["search-match-line"] }}
      >
        {part.text}
      </Text>
    ) : (
      part.text
    ),
  );
}
