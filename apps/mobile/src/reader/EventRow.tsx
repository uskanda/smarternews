import { eventTime, registrationLabel } from "@smarternews/client";
import type { ArticleSummary } from "@smarternews/core/api";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "../theme/theme";
import { Txt } from "../ui/Txt";

/** One event: its name, when it takes place, where, what it costs, and whether to sign up. */
export const EventRow = memo(function EventRow({ article, timeZone, onOpen }: { article: ArticleSummary; timeZone: string; onOpen: (article: ArticleSummary) => void }) {
  const theme = useTheme();
  const event = article.event!;
  const details = [eventTime(event, timeZone), event.venue, event.fee, registrationLabel(event.registration)].filter((part): part is string => Boolean(part));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[article.title, ...details, article.isRead ? "既読" : "未読"].join("。")}
      onPress={() => onOpen(article)}
      android_ripple={{ color: theme.colors.selected }}
      style={({ pressed }) => ({
        minHeight: theme.spacing["touch-android"],
        gap: 2,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.outline,
        backgroundColor: pressed ? theme.colors.selected : theme.colors.surface,
      })}
    >
      <Txt variant={article.isRead ? "body-md" : "label-md"} color={article.isRead ? "on-surface-muted" : "on-surface"}>
        {article.title}
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: theme.spacing.md, rowGap: theme.spacing.xs }}>
        {details.map((part) => (
          <Txt key={part} variant="label-sm" color="on-surface-muted" style={{ fontVariant: ["tabular-nums"] }}>
            {part}
          </Txt>
        ))}
      </View>
    </Pressable>
  );
});
