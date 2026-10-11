import { marked, type Token, type Tokens } from "marked";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Image, Text, View } from "react-native";
import { isWebLink, openSource } from "../lib/links";
import { useTheme, type Theme } from "../theme/theme";

// An article body is Markdown: written by a model that read web pages, or rewritten from what a feed
// delivered. It is drawn from the parsed tokens with the app's own text components: HTML inside it is shown as
// the characters it is, never interpreted, and a link opens only when it points to a web page. Images are
// loaded only for the content of a feed article, and only over HTTPS.

const HTTPS = /^https:\/\//i;

/**
 * An image of a feed article, as wide as the text. The device asks the other site for it. Its height follows
 * from its proportions once it has loaded; when it cannot be loaded, its description takes its place.
 */
function ArticleImage({ uri, alt, theme }: { uri: string; alt: string; theme: Theme }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return alt ? <Text style={[theme.type["label-sm"], { color: theme.colors["on-surface-muted"] }]}>{alt}</Text> : null;
  }
  return (
    <Image
      accessible
      accessibilityRole="image"
      accessibilityLabel={alt}
      source={{ uri }}
      resizeMode="contain"
      onLoad={(event) => {
        const { width, height } = event.nativeEvent.source;
        if (width > 0 && height > 0) setRatio(width / height);
      }}
      onError={() => setFailed(true)}
      style={{ width: "100%", aspectRatio: ratio ?? 16 / 9, borderRadius: theme.rounded.md }}
    />
  );
}

/**
 * The tokens of a paragraph as blocks: an image stands on its own, between the runs of text around it.
 * Without `images`, everything stays one run and an image is shown as its description.
 */
function paragraphBlocks(tokens: Token[] | undefined, theme: Theme, key: string, images: boolean): ReactNode[] {
  const blocks: ReactNode[] = [];
  let run: Token[] = [];
  const flush = () => {
    if (run.some((token) => token.raw.trim().length > 0)) {
      blocks.push(
        <Paragraph key={`${key}.${blocks.length}`} theme={theme}>
          {inline(run, theme, `${key}.${blocks.length}.`)}
        </Paragraph>,
      );
    }
    run = [];
  };
  for (const token of tokens ?? []) {
    if (images && token.type === "image" && HTTPS.test((token as Tokens.Image).href)) {
      flush();
      const image = token as Tokens.Image;
      blocks.push(<ArticleImage key={`${key}.${blocks.length}`} uri={image.href} alt={image.text} theme={theme} />);
    } else {
      run.push(token);
    }
  }
  flush();
  return blocks;
}

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

function block(token: Token, theme: Theme, key: string, images: boolean): ReactNode {
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
      return <Fragment key={key}>{paragraphBlocks((token as Tokens.Paragraph).tokens, theme, key, images)}</Fragment>;
    case "list": {
      const list = token as Tokens.List;
      return (
        <View key={key} style={{ gap: theme.spacing.xs }}>
          {list.items.map((item, index) => (
            <View key={`${key}.${index}`} style={{ flexDirection: "row", gap: theme.spacing.sm }}>
              <Paragraph theme={theme}>{list.ordered ? `${Number(list.start || 1) + index}.` : "・"}</Paragraph>
              <View style={{ flex: 1, gap: theme.spacing.xs }}>{item.tokens.map((child, at) => block(child, theme, `${key}.${index}.${at}`, images))}</View>
            </View>
          ))}
        </View>
      );
    }
    case "blockquote":
      return (
        <View key={key} style={{ gap: theme.spacing.sm, paddingLeft: theme.spacing.md, borderLeftWidth: 2, borderLeftColor: theme.colors["outline-strong"] }}>
          {(token as Tokens.Blockquote).tokens.map((child, at) => block(child, theme, `${key}.${at}`, images))}
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
      if (text.tokens) return <Fragment key={key}>{paragraphBlocks(text.tokens, theme, key, images)}</Fragment>;
      return (
        <Paragraph key={key} theme={theme}>
          {unescape(text.text)}
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

export function Markdown({ text, images = false }: { text: string; images?: boolean }) {
  const theme = useTheme();
  const tokens = useMemo(() => marked.lexer(text, { gfm: true }), [text]);
  return <View style={{ gap: theme.spacing.lg }}>{tokens.map((token, index) => block(token, theme, String(index), images))}</View>;
}
