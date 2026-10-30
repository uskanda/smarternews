import { cutByRanges, relayedImageUrl, type PartRange, type TermMatcher } from "@smarternews/client";
import { marked, type Token, type Tokens } from "marked";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useConnection } from "../connection/ConnectionProvider";
import { isWebLink, openSource } from "../lib/links";
import { themeFor, useTheme, type Theme } from "../theme/theme";
import { Icon } from "../ui/Icon";
import { Highlighted } from "./highlight";

// An article body is Markdown: written by a model that read web pages, or rewritten from what a feed
// delivered. It is drawn from the parsed tokens with the app's own text components: HTML inside it is shown as
// the characters it is, never interpreted, and a link opens only when it points to a web page. Images are
// loaded only for the content of a feed article, and only from the relay of the server the app is connected
// to, whose addresses the API puts in the content. The device never asks another site for an image.

/** The highlights to draw in a body, and what pressing one with a note opens. */
export interface AnnotationMarks {
  ranges: readonly PartRange[];
  /** Called with the id of a highlight with a note that is pressed. */
  onOpen?: (id: number) => void;
}

/**
 * The theme, the words of a search to mark in the text when the article was opened from search results, the
 * term groups to colour the text by, and the URL of the connected server, against which the addresses of
 * relayed images are resolved. `marks` are the reader's highlights, counted in the text of the runs of
 * `words` in the order they are drawn: `cursor` is where the next run starts. `collect` takes those runs.
 */
type Drawing = Theme & {
  terms?: readonly string[];
  groups?: TermMatcher | null;
  server?: string;
  marks?: AnnotationMarks;
  cursor?: { offset: number };
  collect?: string[];
};

/** A run of text with the words of the search marked and the terms of the term groups coloured, when there are any. */
function plainWords(text: string, theme: Drawing, key?: string): ReactNode {
  const searched = theme.terms && theme.terms.length > 0;
  const colored = theme.groups && !theme.groups.empty && theme.groups.split(text).some((part) => part.group !== null);
  return searched || colored ? <Highlighted key={key} text={text} terms={theme.terms} groups={theme.groups} /> : text;
}

/**
 * A highlight the reader made, drawn as `annotation-mark` in DESIGN.md: the fill alone, no line, around the
 * marks of words. One with a note can be pressed, and its last part is followed by the icon of its note, a
 * button of its own so that a screen reader reaches it.
 */
function highlighted(piece: { text: string; range: PartRange; last: boolean }, theme: Drawing, key: string): ReactNode {
  const { range } = piece;
  const open = range.note && theme.marks?.onOpen ? () => theme.marks!.onOpen!(range.id) : undefined;
  return (
    <Fragment key={key}>
      <Text testID={`annotation-${range.id}`} onPress={open} style={{ backgroundColor: theme.colors["annotation-fill"] }}>
        {plainWords(piece.text, theme)}
      </Text>
      {piece.last && range.note ? (
        <Pressable
          testID={`annotation-note-${range.id}`}
          accessibilityRole="button"
          accessibilityLabel="ハイライト、メモあり"
          onPress={open}
          hitSlop={theme.spacing.md}
          style={{ paddingLeft: theme.spacing.xs }}
        >
          <Icon name="note" color={theme.colors.annotation} size={16} />
        </Pressable>
      ) : null}
    </Fragment>
  );
}

/**
 * A run of the text of the body: what highlights are counted in, with the reader's highlights drawn around the
 * marks of words. Only text comes here: the address of a link or an image is never matched.
 */
function words(text: string, theme: Drawing, key?: string): ReactNode {
  theme.collect?.push(text);
  if (!theme.marks || !theme.cursor) return plainWords(text, theme, key);
  const from = theme.cursor.offset;
  theme.cursor.offset += text.length;
  if (theme.marks.ranges.length === 0) return plainWords(text, theme, key);
  return (
    <Fragment key={key}>
      {cutByRanges(text, from, theme.marks.ranges).map((piece, index) =>
        piece.range ? highlighted({ text: piece.text, range: piece.range, last: piece.last }, theme, String(index)) : plainWords(piece.text, theme, String(index)),
      )}
    </Fragment>
  );
}

/**
 * An image of a feed article, as wide as the text, loaded from the server's relay. Its height follows from its
 * proportions once it has loaded; when it cannot be loaded, a word that it could not, with its description,
 * takes its place: a site that refuses the relay would otherwise leave no trace of the image.
 */
function ArticleImage({ uri, alt, theme }: { uri: string; alt: string; theme: Theme }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Text style={[theme.type["label-sm"], { color: theme.colors["on-surface-muted"] }]}>
        画像を表示できませんでした{alt ? <>（<Text>{alt}</Text>）</> : null}
      </Text>
    );
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
function paragraphBlocks(tokens: Token[] | undefined, theme: Drawing, key: string, images: boolean): ReactNode[] {
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
    const uri = images && token.type === "image" && theme.server ? relayedImageUrl(theme.server, (token as Tokens.Image).href) : null;
    if (uri !== null) {
      flush();
      blocks.push(<ArticleImage key={`${key}.${blocks.length}`} uri={uri} alt={(token as Tokens.Image).text} theme={theme} />);
    } else {
      run.push(token);
    }
  }
  flush();
  return blocks;
}

function inline(tokens: Token[] | undefined, theme: Drawing, prefix: string): ReactNode {
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
            {words((token as Tokens.Codespan).text, theme)}
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
        // The description of an image is no part of the text highlights are found in.
        return plainWords((token as Tokens.Image).text, theme, key);
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens ? <Fragment key={key}>{inline(text.tokens, theme, `${key}.`)}</Fragment> : words(unescape(text.text), theme, key);
      }
      case "escape":
        return words((token as Tokens.Escape).text, theme, key);
      default:
        // Includes "html": the raw characters are shown.
        return words(token.raw, theme, key);
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

function block(token: Token, theme: Drawing, key: string, images: boolean): ReactNode {
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
          {words((token as Tokens.Code).text, theme)}
        </Text>
      );
    case "text": {
      const text = token as Tokens.Text;
      if (text.tokens) return <Fragment key={key}>{paragraphBlocks(text.tokens, theme, key, images)}</Fragment>;
      return (
        <Paragraph key={key} theme={theme}>
          {words(unescape(text.text), theme)}
        </Paragraph>
      );
    }
    default:
      // Includes "html" and tables: shown as the characters that were written.
      return (
        <Paragraph key={key} theme={theme}>
          {words(token.raw.trim(), theme)}
        </Paragraph>
      );
  }
}

/**
 * `quiet` draws the text one size smaller and in the muted colour: the original under its translation.
 * `highlight` marks the words of the search an article was opened from, wherever they are in the text.
 * `groups` colours the terms of the term groups in the text.
 * `annotations` draws the reader's highlights, counted in the text `markdownText` gives.
 */
export function Markdown({
  text,
  images = false,
  quiet = false,
  highlight,
  groups,
  annotations,
}: {
  text: string;
  images?: boolean;
  quiet?: boolean;
  highlight?: readonly string[];
  groups?: TermMatcher | null;
  annotations?: AnnotationMarks;
}) {
  const base = useTheme();
  const server = useConnection().connection?.url;
  const theme = useMemo<Drawing>(
    () => ({
      ...(quiet ? ({ ...base, type: { ...base.type, "body-lg": base.type["body-md"] }, colors: { ...base.colors, "on-surface": base.colors["on-surface-muted"] } } as unknown as Theme) : base),
      terms: highlight,
      groups,
      server,
    }),
    [base, quiet, highlight, groups, server],
  );
  const tokens = useMemo(() => marked.lexer(text, { gfm: true }), [text]);
  // The runs of text are counted from the start on every drawing.
  const drawing: Drawing = annotations ? { ...theme, marks: annotations, cursor: { offset: 0 } } : theme;
  return <View style={{ gap: theme.spacing.lg }}>{tokens.map((token, index) => block(token, drawing, String(index), images))}</View>;
}

/**
 * The text highlights are found in: the runs of text of the body, joined in the order they are drawn. The marks
 * of a list, the descriptions of images and the addresses of links are no part of it. The web app makes the same
 * text of its tree, apart from spaces.
 */
export function markdownText(text: string): string {
  const collect: string[] = [];
  const drawing: Drawing = { ...themeFor("light"), collect };
  for (const [index, token] of marked.lexer(text, { gfm: true }).entries()) block(token, drawing, String(index), false);
  return collect.join("");
}
