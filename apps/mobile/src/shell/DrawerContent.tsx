import { useGlobalSearchParams, useRouter } from "expo-router";
import { useDrawerStatus } from "expo-router/drawer";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCategories, useCounts } from "../api/queries";
import { useTheme } from "../theme/theme";
import { Txt } from "../ui/Txt";

function Item({ label, count, selected, onPress }: { label: string; count?: number; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const shown = count !== undefined && count > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shown ? `${label}、未読${count}件` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.spacing["touch-android"],
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
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

/** The views a user can read: the three fixed ones, the enabled categories with their unread counts, and settings. */
export function DrawerContent({ closeDrawer }: { closeDrawer: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const open = useDrawerStatus() === "open";
  const router = useRouter();
  const current = useGlobalSearchParams<{ key?: string }>().key ?? "unread";
  const categories = useCategories();
  const counts = useCounts();
  const unreadOf = (categoryId: number) => counts.data?.categories.find((entry) => entry.categoryId === categoryId)?.unread;

  const show = (key: string) => {
    closeDrawer();
    router.navigate({ pathname: "/list/[key]", params: { key } });
  };

  return (
    <ScrollView
      accessibilityLabel="項目"
      // A closed drawer is off the screen: a screen reader must not walk into it.
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!open}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.md }}
    >
      <Item label="未読" count={counts.data?.unread} selected={current === "unread"} onPress={() => show("unread")} />
      <Item label="すべて" selected={current === "all"} onPress={() => show("all")} />
      <Item label="スター" selected={current === "starred"} onPress={() => show("starred")} />
      <View style={{ height: 1, marginVertical: theme.spacing.sm, backgroundColor: theme.colors.outline }} />
      {(categories.data ?? [])
        .filter((category) => category.enabled)
        .map((category) => (
          <Item
            key={category.id}
            label={category.name}
            count={unreadOf(category.id)}
            selected={current === `c-${category.slug}`}
            onPress={() => show(`c-${category.slug}`)}
          />
        ))}
      <View style={{ height: 1, marginVertical: theme.spacing.sm, backgroundColor: theme.colors.outline }} />
      <Item
        label="設定"
        selected={false}
        onPress={() => {
          closeDrawer();
          router.push("/settings");
        }}
      />
    </ScrollView>
  );
}
