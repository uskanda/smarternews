import { marked, type Token, type Tokens } from "marked";
import { Fragment, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { isWebLink, openSource } from "../lib/links";
import { useTheme, type Theme } from "../theme/theme";

// An article body is Markdown written by a model that read web pages. It is drawn from the parsed tokens with
// the app's own text components: HTML inside it is shown as the characters it is, never interpreted, and a
// link opens only when it points to a web page.

function inline(tokens: Token[] | undefined, theme: Theme, prefix: string): ReactNode {
  return (tokens ?? []).map((token, index) => {
    const key = `${prefix}${index}`;
    switch (token.type) {
      case "strong":
        return (
          <Text key={key} style={{ fontFamily: theme.type["headline-lg"].fontFamily }}>
            {inline((token as Tokens.Strong).tokens, theme, `${key}.`)}
          </Text>
        );
      case "em":
      case "del":
        return <Fragment key={key}>{inline((token as Tokens.Em).tokens, theme, `${key}.`)}</Fragment>;
      case "codespan":
        return (
          <Text key={key} style={{ fontFamily: "monospace", fontSize: theme.type["body-md"].fontSize }}>
            {(token as Tokens.Codespan).text}
          </Text>
        );
      case "br":
        return "\n";
      case "link": {
        const link = token as Tokens.Link;
        const label = inline(link.tokens, theme, `${key}.`);
        if (!isWebLink(link.href)) return <Fragment key={key}>{label}</Fragment>;
        return (
          <Text key={key} accessibilityRole="link" onPress={() => void openSource(link.href)} style={{ color: theme.colors.primary, textDecorationLine: "underline" }}>
            {label}
          </Text>
        );
      }
      case "image":
        return (token as Tokens.Image).text;
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens ? <Fragment key={key}>{inline(text.tokens, theme, `${key}.`)}</Fragment> : unescape(text.text);
      }
      case "escape":
        return (token as Tokens.Escape).text;
      default:
        // Includes "html": the raw characters are shown.
        return token.raw;
    }
  });
}

/** marked escapes a few characters for HTML output; on a native screen they are plain characters again. */
function unescape(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function Paragraph({ children, theme }: { children: ReactNode; theme: Theme }) {
  return <Text style={[theme.type["body-lg"], { color: theme.colors["on-surface"] }]}>{children}</Text>;
}

function block(token: Token, theme: Theme, key: string): ReactNode {
  switch (token.type) {
    case "space":
    case "hr":
      return null;
    case "heading":
      return (
        <Text key={key} accessibilityRole="header" style={[theme.type["body-lg"], { fontFamily: theme.type["headline-lg"].fontFamily, color: theme.colors["on-surface"] }]}>
          {inline((token as Tokens.Heading).tokens, theme, `${key}.`)}
        </Text>
      );
    case "paragraph":
      return (
        <Paragraph key={key} theme={theme}>
          {inline((token as Tokens.Paragraph).tokens, theme, `${key}.`)}
        </Paragraph>
      );
    case "list": {
      const list = token as Tokens.List;
      return (
        <View key={key} style={{ gap: theme.spacing.xs }}>
          {list.items.map((item, index) => (
            <View key={`${key}.${index}`} style={{ flexDirection: "row", gap: theme.spacing.sm }}>
              <Paragraph theme={theme}>{list.ordered ? `${Number(list.start || 1) + index}.` : "・"}</Paragraph>
              <View style={{ flex: 1, gap: theme.spacing.xs }}>{item.tokens.map((child, at) => block(child, theme, `${key}.${index}.${at}`))}</View>
            </View>
          ))}
        </View>
      );
    }
    case "blockquote":
      return (
        <View key={key} style={{ gap: theme.spacing.sm, paddingLeft: theme.spacing.md, borderLeftWidth: 2, borderLeftColor: theme.colors["outline-strong"] }}>
          {(token as Tokens.Blockquote).tokens.map((child, at) => block(child, theme, `${key}.${at}`))}
        </View>
      );
    case "code":
      return (
        <Text key={key} style={{ fontFamily: "monospace", fontSize: theme.type["body-md"].fontSize, color: theme.colors["on-surface"] }}>
          {(token as Tokens.Code).text}
        </Text>
      );
    case "text": {
      const text = token as Tokens.Text;
      return (
        <Paragraph key={key} theme={theme}>
          {text.tokens ? inline(text.tokens, theme, `${key}.`) : unescape(text.text)}
        </Paragraph>
      );
    }
    default:
      // Includes "html" and tables: shown as the characters that were written.
      return (
        <Paragraph key={key} theme={theme}>
          {token.raw.trim()}
        </Paragraph>
      );
  }
}

export function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const tokens = useMemo(() => marked.lexer(text, { gfm: true }), [text]);
  return <View style={{ gap: theme.spacing.lg }}>{tokens.map((token, index) => block(token, theme, String(index)))}</View>;
}
