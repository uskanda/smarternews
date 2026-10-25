import { formatShort, type TermMatcher } from "@smarternews/client";
import type { ArticleSummary, TermGroup } from "@smarternews/core/api";
import { memo, useRef } from "react";
import { Pressable, View } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useTheme } from "../theme/theme";
import { Txt } from "../ui/Txt";
import { highlight } from "./highlight";

export function Badge({ children, tone = "plain" }: { children: string; tone?: "plain" | "warning" }) {
  const theme = useTheme();
  const color = tone === "warning" ? "warning" : "on-surface-muted";
  return (
    <View style={{ paddingHorizontal: theme.spacing.xs, borderWidth: 1, borderRadius: theme.rounded.sm, borderColor: theme.colors[color] }}>
      <Txt variant="label-sm" color={color}>
        {children}
      </Txt>
    </View>
  );
}

/** The badge of a term group a row matched: its name on the group's fill, with a line of its colour on the left. */
function TermBadge({ group }: { group: TermGroup }) {
  const theme = useTheme();
  return (
    <View
      testID={`term-badge-${group.color}`}
      style={{
        flexShrink: 1,
        paddingHorizontal: theme.spacing.xs,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors[`term-${group.color}`],
        borderRadius: theme.rounded.sm,
        backgroundColor: theme.colors[`term-${group.color}-fill`],
      }}
    >
      <Txt variant="label-sm" numberOfLines={1}>
        {group.name}
      </Txt>
    </View>
  );
}

export interface ArticleRowProps {
  article: ArticleSummary;
  /** The category of a generated article, the feed of a feed article. */
  sourceName: string;
  timeZone: string;
  /** The current time in milliseconds, the same for every row of one drawing of the list. */
  now: number;
  /** Which time the row shows: when the article was last updated, or, in the recently read articles, when it was read. */
  time?: "updated" | "read";
  onOpen: (article: ArticleSummary) => void;
  onToggleRead: (article: ArticleSummary) => void;
  onLongPress: (article: ArticleSummary) => void;
  /** In search results: the text around the match, shown in place of the summary when there is one. */
  excerpt?: string | null;
  /** In search results: the words to mark in the headline and the excerpt. */
  terms?: readonly string[];
  /** The term groups to colour the headline and the summary by, and to show the badges of. */
  groups?: TermMatcher | null;
}

/**
 * One line of the list. Importance four gets a highlighter stroke in the margin and five has its headline
 * marked; both are also said in words. Swiping the row to the left toggles read and unread without opening it.
 *
 * Drawn again only when its own article changes: a list redraws for many reasons, and a row holds a gesture.
 */
export const ArticleRow = memo(function ArticleRow({
  article,
  sourceName,
  timeZone,
  now,
  time: shownTime = "updated",
  onOpen,
  onToggleRead,
  onLongPress,
  excerpt = null,
  terms,
  groups = null,
}: ArticleRowProps) {
  const theme = useTheme();
  const swipeable = useRef<SwipeableMethods>(null);
  // A feed article has no importance, and so no mark; it has its page instead of counted sources.
  const marked = (article.importance ?? 0) >= 4;
  const generated = article.origin === "generated";
  const headline = article.translatedTitle ?? article.title;
  const line = excerpt ?? article.summary;
  // Judged by what the row shows: a group whose terms are only in the body gets no badge.
  const matched = groups ? groups.groupsIn([headline, line]) : [];
  const time = formatShort(shownTime === "read" ? (article.readAt ?? article.updatedAt) : article.updatedAt, timeZone, new Date(now));
  const spoken = [
    marked ? `重要度${article.importance}` : null,
    headline,
    line,
    sourceName,
    time,
    generated ? `出典${article.refCount}件` : null,
    article.revision > 0 ? "更新" : null,
    article.unconfirmed ? "未確認" : null,
    article.starred ? "スター" : null,
    ...matched.map((group) => group.name),
    article.isRead ? "既読" : "未読",
  ]
    .filter((part): part is string => Boolean(part))
    // A summary ends with its own full stop.
    .map((part) => part.replace(/[。.]$/, ""))
    .join("。");
  const toggleLabel = article.isRead ? "未読に戻す" : "既読にする";

  return (
    <Swipeable
      testID={`row-${article.id}`}
      friction={2}
      rightThreshold={72}
      overshootRight={false}
      renderRightActions={() => (
        <View style={{ width: 120, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.selected }}>
          <Txt variant="label-md" color="primary">
            {toggleLabel}
          </Txt>
        </View>
      )}
      ref={swipeable}
      // The action panel is on the right, so it opens when the row is swiped to the left.
      onSwipeableOpen={() => {
        swipeable.current?.close();
        onToggleRead(article);
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="長く押すと、ほかの操作を選べます"
        accessibilityActions={[{ name: "toggleRead", label: toggleLabel }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "toggleRead") onToggleRead(article);
        }}
        onPress={() => onOpen(article)}
        onLongPress={() => onLongPress(article)}
        android_ripple={{ color: theme.colors.selected }}
        style={({ pressed }) => ({
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.outline,
          backgroundColor: pressed ? theme.colors.selected : theme.colors.surface,
        })}
      >
        <View style={{ width: theme.spacing.lg, paddingVertical: theme.spacing.md, alignItems: "center" }}>
          {marked ? (
            <View
              testID={`mark-${article.id}`}
              style={{
                width: theme.spacing.xs,
                borderRadius: theme.rounded.sm,
                backgroundColor: theme.colors.mark,
                ...(article.importance === 5 ? { flex: 1 } : { height: theme.spacing.lg }),
              }}
            />
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2, paddingVertical: theme.spacing.md, paddingRight: theme.spacing.lg }}>
          <Txt
            testID={`title-${article.id}`}
            // Read and unread differ in weight and colour only. The size and the line height stay, so that
            // reading an article does not move the rows below it.
            variant="label-md"
            // On the mark's fill, muted text is too faint: the weight alone tells a read headline there.
            color={article.isRead && article.importance !== 5 ? "on-surface-muted" : "on-surface"}
            style={[
              article.isRead ? { fontFamily: theme.type["body-md"].fontFamily } : null,
              article.importance === 5 ? { backgroundColor: theme.colors["mark-fill"], alignSelf: "flex-start" } : null,
            ]}
          >
            {highlight(headline, terms, groups)}
          </Txt>
          <Txt testID={excerpt !== null ? `excerpt-${article.id}` : undefined} variant="body-md" color="on-surface-muted" numberOfLines={2}>
            {highlight(line, terms, groups)}
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: theme.spacing.md, rowGap: theme.spacing.xs }}>
            <Txt variant="label-sm" color="on-surface-muted">
              {sourceName}
            </Txt>
            <Txt variant="label-sm" color="on-surface-muted" style={{ fontVariant: ["tabular-nums"] }}>
              {time}
            </Txt>
            {generated ? (
              <Txt variant="label-sm" color="on-surface-muted">
                出典{article.refCount}件
              </Txt>
            ) : null}
            {article.revision > 0 ? <Badge>更新</Badge> : null}
            {article.unconfirmed ? <Badge tone="warning">未確認</Badge> : null}
            {article.starred ? (
              <Txt variant="label-sm" color="on-surface-muted">
                スター
              </Txt>
            ) : null}
            {matched.map((group) => (
              <TermBadge key={group.id} group={group} />
            ))}
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
});
