import { groupMentions, MENTION_KIND_LABELS } from "@smarternews/client";
import type { Article } from "@smarternews/core/api";
import { Pressable, View } from "react-native";
import { useTheme } from "../theme/theme";
import { Txt } from "../ui/Txt";

/**
 * The names found in an article, below its body: by kind, people first, each opening the list of the articles of
 * that name. The names come from a model that read other sites, so they are drawn as plain text, never as markup.
 * An article without names shows nothing.
 */
export function Mentions({ mentions, onOpen }: { mentions: Article["mentions"]; onOpen: (name: string) => void }) {
  const theme = useTheme();
  const groups = groupMentions(mentions);
  if (groups.length === 0) return null;
  return (
    <View testID="mentions" style={{ gap: theme.spacing.md, paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.outline }}>
      {groups.map((group) => (
        <View key={group.kind} style={{ gap: theme.spacing.xs }}>
          <Txt variant="label-sm" color="on-surface-muted" heading>
            {group.label}
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs }}>
            {group.mentions.map((mention) => (
              <Pressable
                key={mention.name}
                accessibilityRole="link"
                // The kind is said with the name: the heading of the kind is not read with each name.
                accessibilityLabel={`${MENTION_KIND_LABELS[mention.kind]}、${mention.name}`}
                onPress={() => onOpen(mention.name)}
                style={({ pressed }) => ({
                  minHeight: theme.spacing["touch-android"],
                  maxWidth: "100%",
                  justifyContent: "center",
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                  borderWidth: 1,
                  borderColor: theme.colors["outline-strong"],
                  borderRadius: theme.rounded.lg,
                  backgroundColor: pressed ? theme.colors.selected : theme.colors.surface,
                })}
              >
                <Txt variant="body-md" color="primary">
                  {mention.name}
                </Txt>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
