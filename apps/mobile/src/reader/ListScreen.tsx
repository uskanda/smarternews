import { groupEvents } from "@smarternews/client";
import type { ArticleSummary } from "@smarternews/core/api";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, RefreshControl, SectionList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../api/AppProvider";
import { useTimeZone } from "../api/queries";
import { openSource } from "../lib/links";
import { useTheme } from "../theme/theme";
import { Button, ErrorNotice, IconButton, Loading, Toggle } from "../ui/controls";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/toast";
import { Txt } from "../ui/Txt";
import { ArticleRow } from "./ArticleRow";
import { EventRow } from "./EventRow";
import { listParams, useReaderList, type View as ListView } from "./useReaderList";

function emptyText(view: ListView, hasSources: boolean, isEvents: boolean): string {
  if (!hasSources) return "カテゴリがまだありません。設定からWebの画面を開いて、カテゴリを追加してください。";
  if (isEvents) return "これから開催されるイベントはありません。";
  if (view === "unread") return "未読の記事はありません。";
  if (view === "starred") return "スターを付けた記事はありません。";
  if (view === "all") return "記事はまだありません。カテゴリを実行すると、ここに並びます。";
  return "ここに出す記事はありません。既読も表示すると、読んだ記事を確かめられます。";
}

/** A list of articles for one view. Opening a row goes to the article; the drawer changes the view. */
export function ListScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { api, now } = useApp();
  const toast = useToast();
  const timeZone = useTimeZone();
  const params = useLocalSearchParams<{ key: string; read?: string; min?: string }>();
  const ref = { key: params.key ?? "unread", includeRead: params.read === "1", importantOnly: params.min === "4" };
  const reader = useReaderList(ref);
  const { list, items, fetched, view, isEvents } = reader;
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<ArticleSummary | null>(null);

  // The rows are drawn again only when their article changes, so what they call must not change either:
  // these three stay the same functions and reach the current state through a ref.
  const current = useRef({ reader, ref, router });
  current.current = { reader, ref, router };
  const open = useCallback((article: ArticleSummary) => {
    const { ref: list, router: to } = current.current;
    to.push({ pathname: "/article/[id]", params: { id: String(article.id), list: list.key, ...listParams(list) } });
  }, []);
  const toggleRead = useCallback((article: ArticleSummary) => current.current.reader.setRead(article, !article.isRead), []);
  const showMenu = useCallback((article: ArticleSummary) => setMenuFor(article), []);

  // Back from another list returns to the unread list, where the app starts; back from there leaves the app.
  const key = ref.key;
  useFocusEffect(
    useCallback(() => {
      if (key === "unread") return undefined;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        current.current.router.navigate({ pathname: "/list/[key]", params: { key: "unread" } });
        return true;
      });
      return () => subscription.remove();
    }, [key]),
  );

  // One time for the whole list, changing once a minute: every row shows "today" or "yesterday" against it.
  const minute = Math.floor(now().getTime() / 60_000) * 60_000;
  const sections = useMemo(
    () => (isEvents ? groupEvents(items, timeZone, new Date(minute)).map((group) => ({ ...group, data: group.events })) : []),
    [isEvents, items, timeZone, minute],
  );
  // The last row must be able to scroll clear of the system's navigation bar.
  const listPadding = { paddingBottom: insets.bottom };

  const setFilter = (name: "read" | "min", value: string, on: boolean) => router.setParams({ [name]: on ? value : undefined });

  async function pulled() {
    setRefreshing(true);
    try {
      await reader.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function markAllRead() {
    const newest = fetched.reduce<string | null>((latest, item) => (latest === null || item.updatedAt > latest ? item.updatedAt : latest), null);
    if (newest === null) return;
    // "Before" is just after the newest article on screen, so one that arrives later stays unread.
    const before = new Date(new Date(newest).getTime() + 1).toISOString();
    try {
      const result = await api.markRead({ before, ...reader.scope, ...(reader.importantOnly ? { minImportance: 4 } : {}) });
      await reader.refresh();
      toast({
        message: `${result.updated}件を既読にしました`,
        durationMs: 10_000,
        action: { label: "取り消す", run: () => void api.markUnread(result.ids).then(() => reader.refresh()) },
      });
    } catch {
      toast({ message: "既読にできませんでした。もう一度試してください。" });
    }
  }

  const canMarkAll = (view === "unread" || reader.readToggle) && fetched.some((item) => !item.isRead);
  const header = (
    <ScreenHeader
      title={reader.title}
      left={<IconButton label="項目を開く" icon="menu" onPress={() => navigation.dispatch(DrawerActions.openDrawer())} />}
      right={canMarkAll ? <IconButton label="すべて既読にする" icon="checkAll" onPress={() => void markAllRead()} /> : null}
    />
  );

  if (reader.missing) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        {header}
        <Txt variant="body-md" style={{ padding: theme.spacing.lg }}>
          {reader.missingText}
        </Txt>
      </View>
    );
  }

  const status = (
    <View>
      {list.isError ? <ErrorNotice error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isPending && !list.isError ? <Loading /> : null}
      {list.isSuccess && items.length === 0 ? (
        <Txt variant="body-md" color="on-surface-muted" style={{ padding: theme.spacing.lg }}>
          {emptyText(view, reader.hasSources, isEvents)}
        </Txt>
      ) : null}
    </View>
  );
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={() => void pulled()} colors={[theme.colors.primary]} progressBackgroundColor={theme.colors.surface} />;
  const footer = list.isFetchingNextPage ? <Loading /> : null;
  const more = () => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      {header}
      {isEvents ? (
        <SectionList
          accessibilityLabel="イベントの一覧"
          testID="article-list"
          // A list of its own per view: a new view starts at the top, not where the last one was left.
          key={ref.key}
          sections={sections}
          contentContainerStyle={listPadding}
          keyExtractor={(item) => String(item.id)}
          renderSectionHeader={({ section }) => (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.xs, backgroundColor: theme.colors.background }}>
              <Txt variant="label-md" heading accessibilityLabel={section.label}>
                {section.date}
              </Txt>
              {section.weekday ? (
                <Txt variant="label-sm" color="on-surface-muted">
                  {section.weekday}
                </Txt>
              ) : null}
            </View>
          )}
          renderItem={({ item }) => <EventRow article={item} timeZone={timeZone} onOpen={open} />}
          ListHeaderComponent={status}
          ListFooterComponent={footer}
          refreshControl={refreshControl}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          stickySectionHeadersEnabled={false}
        />
      ) : (
        <FlatList
          accessibilityLabel="記事の一覧"
          testID="article-list"
          key={ref.key}
          data={items}
          contentContainerStyle={listPadding}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ArticleRow
              article={item}
              sourceName={reader.sourceName(item)}
              timeZone={timeZone}
              now={minute}
              onOpen={open}
              onToggleRead={toggleRead}
              onLongPress={showMenu}
            />
          )}
          ListHeaderComponent={
            <View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: theme.spacing.lg, paddingHorizontal: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.outline }}>
                {reader.readToggle ? <Toggle label="既読も表示" value={ref.includeRead} onChange={(on) => setFilter("read", "1", on)} /> : null}
                {reader.importanceFilter ? <Toggle label="重要度4以上だけ" value={ref.importantOnly} onChange={(on) => setFilter("min", "4", on)} /> : null}
              </View>
              {status}
            </View>
          }
          ListFooterComponent={footer}
          refreshControl={refreshControl}
          onEndReached={more}
          onEndReachedThreshold={0.5}
        />
      )}
      <Sheet title={menuFor?.title ?? ""} visible={menuFor !== null} onClose={() => setMenuFor(null)}>
        {menuFor ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={menuFor.starred ? "スターを外す" : "スターを付ける"}
              onPress={() => {
                reader.toggleStar(menuFor);
                setMenuFor(null);
              }}
            />
            <Button
              label={menuFor.isRead ? "未読に戻す" : "既読にする"}
              onPress={() => {
                reader.setRead(menuFor, !menuFor.isRead);
                setMenuFor(null);
              }}
            />
            {menuFor.primaryUrl ? (
              <Button
                label={menuFor.origin === "feed" ? "元のページを開く" : "出典を開く"}
                onPress={() => {
                  void openSource(menuFor.primaryUrl!);
                  setMenuFor(null);
                }}
              />
            ) : null}
            <Button label="閉じる" variant="quiet" onPress={() => setMenuFor(null)} />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
