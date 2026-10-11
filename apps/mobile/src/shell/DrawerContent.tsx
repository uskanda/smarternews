import { buildNav, GENERATED_LABEL, listKey, type NavEntry } from "@smarternews/client";
import { useGlobalSearchParams, useRouter } from "expo-router";
import { useDrawerStatus } from "expo-router/drawer";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCategories, useCounts, useFeeds } from "../api/queries";
import { useTheme } from "../theme/theme";
import { Icon } from "../ui/Icon";
import { Txt } from "../ui/Txt";
import { useCollapsed } from "./collapsed";

function Item({
  label,
  spoken,
  count,
  selected,
  indent = 0,
  onPress,
}: {
  label: string;
  /** What a screen reader says, when the label alone would not tell two entries apart. */
  spoken?: string;
  count?: number;
  selected: boolean;
  /** Extra space on the left, for an entry below a category. */
  indent?: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const shown = count !== undefined && count > 0;
  const name = spoken ?? label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shown ? `${name}、未読${count}件` : name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: theme.spacing["touch-android"],
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        paddingLeft: theme.spacing.lg + indent,
        paddingRight: theme.spacing.lg,
        backgroundColor: selected || pressed ? theme.colors.selected : "transparent",
      })}
    >
      <Txt variant={selected ? "label-md" : "body-md"} numberOfLines={2} style={{ flex: 1 }}>
        {label}
      </Txt>
      {shown ? (
        <Txt variant="label-sm" color="on-surface-muted" style={{ fontVariant: ["tabular-nums"] }}>
          {count}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/**
 * The lists a user can read: the four fixed ones, the enabled categories with the generated articles and the
 * feeds below them, the feeds without a category, and settings. A category that has feeds can be folded.
 */
export function DrawerContent({ closeDrawer }: { closeDrawer: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const open = useDrawerStatus() === "open";
  const router = useRouter();
  const current = useGlobalSearchParams<{ key?: string }>().key ?? "unread";
  const categories = useCategories().data;
  const feeds = useFeeds().data;
  const counts = useCounts().data;
  const collapsed = useCollapsed();
  const model = useMemo(() => buildNav({ categories: categories ?? [], feeds: feeds ?? [], counts }), [categories, feeds, counts]);

  const show = (key: string) => {
    closeDrawer();
    router.navigate({ pathname: "/list/[key]", params: { key } });
  };
  const item = (entry: NavEntry, options: { indent?: number; spoken?: string } = {}) => {
    const key = listKey(entry.target);
    return <Item key={key} label={entry.label} spoken={options.spoken} count={entry.unread} indent={options.indent} selected={current === key} onPress={() => show(key)} />;
  };
  const rule = <View style={{ height: 1, marginVertical: theme.spacing.sm, backgroundColor: theme.colors.outline }} />;

  return (
    <ScrollView
      accessibilityLabel="項目"
      // A closed drawer is off the screen: a screen reader must not walk into it.
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!open}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.md }}
    >
      {model.views.map((entry) => (
        <View key={listKey(entry.target)} style={{ flexDirection: "row" }}>
          {item(entry)}
        </View>
      ))}
      {rule}
      {model.groups.map((group) => {
        const key = listKey(group.entry.target);
        const folded = collapsed.isCollapsed(key);
        return (
          <View key={key}>
            <View style={{ flexDirection: "row" }}>
              {item(group.entry)}
              {group.children.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  // The state says whether it is open; a label that changed too would say it twice.
                  accessibilityLabel={`${group.entry.label}の下の項目`}
                  accessibilityState={{ expanded: !folded }}
                  onPress={() => collapsed.toggle(key)}
                  style={{ width: theme.spacing["touch-android"], minHeight: theme.spacing["touch-android"], alignItems: "center", justifyContent: "center" }}
                >
                  <Icon name={folded ? "expand" : "collapse"} color={theme.colors["on-surface-muted"]} />
                </Pressable>
              ) : null}
            </View>
            {folded
              ? null
              : group.children.map((child) => (
                  // The fold button's column stays empty here, so that the counts of the entries line up with the category's.
                  <View key={listKey(child.target)} style={{ flexDirection: "row", paddingRight: theme.spacing["touch-android"] }}>
                    {item(child, {
                      indent: theme.spacing["nav-indent"],
                      // "AI生成" appears once per category and once at the top: said with its category.
                      spoken: child.label === GENERATED_LABEL ? `${group.entry.label}の${GENERATED_LABEL}` : undefined,
                    })}
                  </View>
                ))}
          </View>
        );
      })}
      {rule}
      <View style={{ flexDirection: "row" }}>
        <Item
          label="設定"
          selected={false}
          onPress={() => {
            closeDrawer();
            router.push("/settings");
          }}
        />
      </View>
    </ScrollView>
  );
}
