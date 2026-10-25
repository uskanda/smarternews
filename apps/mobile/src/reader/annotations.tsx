import { locateHighlights, PART_SEPARATOR, rangesByPart } from "@smarternews/client";
import type { Article, Highlight } from "@smarternews/core/api";
import { useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "../theme/theme";
import { Button } from "../ui/controls";
import { Sheet } from "../ui/Sheet";
import { Txt } from "../ui/Txt";
import { markdownText, type AnnotationMarks } from "./Markdown";

// The reader's annotations on the article screen of the app: they are shown, never made, changed or removed
// here; that is done on the web. Highlights are found in the text of the originals as the app draws them, by the
// rules the web app uses. No model is involved.

/** The quote of a highlight, set apart as a quotation and shown as written. */
function Quote({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <View style={{ paddingLeft: theme.spacing.md, borderLeftWidth: 2, borderLeftColor: theme.colors["outline-strong"] }}>
      <Txt variant="body-md">{children}</Txt>
    </View>
  );
}

/** The highlights whose quote the body no longer holds, after the body, in the order they were made. */
function MissingHighlights({ highlights }: { highlights: readonly Highlight[] }) {
  const theme = useTheme();
  if (highlights.length === 0) return null;
  return (
    <View testID="missing-highlights" style={{ gap: theme.spacing.sm }}>
      <Txt variant="label-sm" color="on-surface-muted" heading>
        元の本文にあった箇所
      </Txt>
      {highlights.map((highlight) => (
        <View key={highlight.id} style={{ gap: theme.spacing.xs }}>
          <Quote>{highlight.quote}</Quote>
          {highlight.note !== null ? <Txt variant="body-md">{highlight.note}</Txt> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The body of an article with the reader's highlights. `parts` are the Markdown of the originals the body is
 * drawn from: one, or one per segment of a translation. `render` draws the body, giving each original the marks
 * `marksFor` returns. With `enabled` false, as while what the feed delivered is shown in place of the full
 * content, nothing is marked.
 */
export function AnnotatedBody({
  article,
  parts,
  enabled,
  render,
}: {
  article: Article;
  parts: readonly string[];
  enabled: boolean;
  render: (marksFor: (index: number) => AnnotationMarks | undefined) => ReactNode;
}) {
  const theme = useTheme();
  const highlights = article.annotations.highlights;
  const [opened, setOpened] = useState<number | null>(null);
  // The parts come anew with every drawing of the page: their text decides when they are read again.
  const partsKey = parts.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `partsKey` stands for `parts`
  const texts = useMemo(() => (enabled && highlights.length > 0 ? parts.map(markdownText) : null), [enabled, highlights.length, partsKey]);
  const located = useMemo(() => (texts ? locateHighlights(texts.join(PART_SEPARATOR), highlights) : null), [texts, highlights]);
  const byPart = useMemo(() => (located && texts ? rangesByPart(located, texts) : null), [located, texts]);
  const marksFor = (index: number): AnnotationMarks | undefined => (byPart ? { ranges: byPart[index] ?? [], onOpen: setOpened } : undefined);
  const shown = highlights.find((highlight) => highlight.id === opened);
  return (
    <View style={{ gap: theme.spacing.lg }}>
      {render(marksFor)}
      {located ? <MissingHighlights highlights={located.missing} /> : null}
      <Sheet title="ハイライト" visible={shown !== undefined} onClose={() => setOpened(null)}>
        {shown ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Quote>{shown.quote}</Quote>
            <Txt variant="label-sm" color="on-surface-muted" heading>
              メモ
            </Txt>
            <Txt variant="body-md">{shown.note}</Txt>
          </View>
        ) : null}
        <Button label="閉じる" onPress={() => setOpened(null)} />
      </Sheet>
    </View>
  );
}

/** The note on the whole article, above the body, as written: no markup is read in it. */
export function ArticleNote({ article }: { article: Article }) {
  const theme = useTheme();
  const note = article.annotations.note;
  if (note === null) return null;
  return (
    <View testID="article-note" style={{ gap: theme.spacing.xs, paddingLeft: theme.spacing.md, borderLeftWidth: 2, borderLeftColor: theme.colors.annotation }}>
      <Txt variant="label-sm" color="on-surface-muted" heading>
        メモ
      </Txt>
      <Txt variant="body-md">{note.text}</Txt>
    </View>
  );
}
