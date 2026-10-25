import { buildNav, GENERATED_LABEL, listKey, type NavEntry } from "@smarternews/client";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { useDrawerStatus } from "expo-router/drawer";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCategories, useCounts, useFeeds } from "../api/queries";
import { useTheme } from "../theme/theme";
import { Icon } from "../ui/Icon";
import { Txt } from "../ui/Txt";
import { unfold, useCollapsed } from "./collapsed";
import { DragRow, useDrawerDrag, useNavMoves, type DrawerGeometry } from "./order";

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
 * The search box at the top of the drawer. The search key of the keyboard closes the drawer and shows the
 * results over every article; with spaces only, nothing changes.
 */
function SearchBox({ onSearch }: { onSearch: (words: string) => void }) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
      <TextInput
        testID="search-box"
        accessibilityLabel="記事を検索"
        placeholder="記事を検索"
        placeholderTextColor={theme.colors["on-surface-muted"]}
        returnKeyType="search"
        value={value}
        onChangeText={setValue}
        onSubmitEditing={() => {
          const words = value.trim();
          if (words.length > 0) onSearch(words);
        }}
        style={[
          theme.type["body-md"],
          {
            minHeight: theme.spacing["touch-android"],
            paddingHorizontal: theme.spacing.sm,
            borderWidth: 1,
            borderColor: theme.colors["outline-strong"],
            borderRadius: theme.rounded.md,
            backgroundColor: theme.colors.surface,
            color: theme.colors["on-surface"],
          },
        ]}
      />
    </View>
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
  const onSearch = usePathname() === "/search";
  const listParam = useGlobalSearchParams<{ key?: string }>().key ?? "unread";
  // On the search results no entry of the drawer is the one shown.
  const current = onSearch ? "" : listParam;
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

  const scroll = useRef<ScrollView>(null);
  const geometry = useRef<DrawerGeometry>({ rows: new Map(), top: 0, height: 0, offset: 0, contentHeight: 0 });
  const { drag, handlers } = useDrawerDrag({ scroll, geometry, model, onMove: useNavMoves(), unfold });
  // Rows that left the drawer, by a fold or a move, must not be measured as if they were still there.
  const shown = new Set(model.groups.flatMap((group) => [group.entry, ...(collapsed.isCollapsed(listKey(group.entry.target)) ? [] : group.children)]).map((entry) => listKey(entry.target)));
  for (const key of geometry.current.rows.keys()) if (!shown.has(key)) geometry.current.rows.delete(key);
  /** One row of a category or of what is below it. A long press picks it up when it may move. */
  const row = (key: string, content: ReactNode, style: object = {}) => (
    <DragRow key={key} dragKey={key} handlers={handlers}>
      <View
        testID={`nav-row-${key}`}
        collapsable={false}
        onLayout={(event) => geometry.current.rows.set(key, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })}
        style={{
          flexDirection: "row",
          opacity: drag?.key === key ? 0.4 : 1,
          // The category a held feed may go into is framed like a focused control.
          borderRadius: theme.rounded.md,
          ...(drag?.armed === key ? { outlineWidth: 2, outlineColor: theme.colors.primary, outlineOffset: -2 } : {}),
          ...style,
        }}
      >
        {content}
      </View>
    </DragRow>
  );
  const dragged = drag ? [...model.groups.map((group) => group.entry), ...model.groups.flatMap((group) => group.children)].find((entry) => listKey(entry.target) === drag.key) : undefined;

  return (
    <ScrollView
      ref={scroll}
      accessibilityLabel="項目"
      // The drawer stays put while an entry is held: the finger moves the entry, not the list.
      scrollEnabled={drag === null}
      scrollEventThrottle={16}
      onScroll={(event) => {
        geometry.current.offset = event.nativeEvent.contentOffset.y;
      }}
      onLayout={(event) => {
        // The drawer fills the window from its top edge, so its own place is its place on screen.
        geometry.current.top = event.nativeEvent.layout.y;
        geometry.current.height = event.nativeEvent.layout.height;
      }}
      onContentSizeChange={(_width, height) => {
        geometry.current.contentHeight = height;
      }}
      // A closed drawer is off the screen: a screen reader must not walk into it.
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!open}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.md }}
    >
      <SearchBox
        onSearch={(words) => {
          closeDrawer();
          router.navigate({ pathname: "/search", params: { q: words, category: undefined, feed: undefined, unread: undefined } });
        }}
      />
      {model.views.map((entry) => (
        <View key={listKey(entry.target)} style={{ flexDirection: "row" }}>
          {item(entry)}
        </View>
      ))}
      {rule}
      {model.groups.flatMap((group) => {
        const key = listKey(group.entry.target);
        const folded = collapsed.isCollapsed(key);
        return [
          row(
            key,
            <>
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
            </>,
          ),
          ...(folded
            ? []
            : group.children.map((child) =>
                row(
                  listKey(child.target),
                  item(child, {
                    indent: theme.spacing["nav-indent"],
                    // "AI生成" appears once per category and once at the top: said with its category.
                    spoken: child.label === GENERATED_LABEL ? `${group.entry.label}の${GENERATED_LABEL}` : undefined,
                  }),
                  // The fold button's column stays empty here, so that the counts of the entries line up with the category's.
                  { paddingRight: theme.spacing["touch-android"] },
                ),
              )),
        ];
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
      {drag && drag.lineY !== null ? (
        <View
          testID="nav-drop-line"
          pointerEvents="none"
          style={{ position: "absolute", left: theme.spacing.sm, right: theme.spacing.sm, top: drag.lineY - 1, height: 2, backgroundColor: theme.colors.primary }}
        />
      ) : null}
      {drag && dragged ? (
        // The entry under the finger, lifted off the list.
        <View
          testID="nav-dragged"
          pointerEvents="none"
          style={{
            position: "absolute",
            left: theme.spacing.sm,
            right: theme.spacing.sm,
            top: drag.y - theme.spacing["touch-android"] / 2,
            minHeight: theme.spacing["touch-android"],
            justifyContent: "center",
            paddingHorizontal: theme.spacing.lg,
            borderWidth: 1,
            borderColor: theme.colors["outline-strong"],
            borderRadius: theme.rounded.md,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Txt variant="label-md" numberOfLines={1}>
            {dragged.label}
          </Txt>
        </View>
      ) : null}
    </ScrollView>
  );
}
