import { buildNav, groupEvents, listKey, nextTarget, parseListKey } from "@smarternews/client";
import type { ArticleSummary } from "@smarternews/core/api";
import { DrawerActions } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, RefreshControl, ScrollView, SectionList, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../api/AppProvider";
import { useCategories, useFeeds, useSettings, useTermMatcher, useTimeZone } from "../api/queries";
import { openSource } from "../lib/links";
import { unfold } from "../shell/collapsed";
import { useTheme } from "../theme/theme";
import { Button, ErrorNotice, IconButton, Loading, Toggle } from "../ui/controls";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/toast";
import { Txt } from "../ui/Txt";
import { ArticleRow } from "./ArticleRow";
import { EventRow } from "./EventRow";
import { listParams, listRefOf, SEARCH_KEY, useReaderList, type View as ListView } from "./useReaderList";

function emptyText(view: ListView, hasSources: boolean, isEvents: boolean): string {
  if (!hasSources) return "カテゴリがまだありません。設定からWebの画面を開いて、カテゴリを追加してください。";
  if (isEvents) return "これから開催されるイベントはありません。";
  if (view === "unread") return "未読の記事はありません。";
  if (view === "recentlyRead") return "直近7日に読んだ記事はありません。";
  if (view === "starred") return "スターを付けた記事はありません。";
  if (view === "all") return "記事はまだありません。カテゴリを実行すると、ここに並びます。";
  return "ここに出す記事はありません。既読も表示すると、読んだ記事を確かめられます。";
}

/** The search results: the list screen over what the words of the search found. */
export function SearchScreen() {
  return <ListScreen search />;
}

/**
 * A list of articles for one view. Opening a row goes to the article; the drawer changes the view. With
 * `search`, the list holds the search results the screen's parameters describe.
 */
export function ListScreen({ search = false }: { search?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { api, now } = useApp();
  const toast = useToast();
  const timeZone = useTimeZone();
  const settings = useSettings();
  const categories = useCategories();
  const feeds = useFeeds();
  const groups = useTermMatcher();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ key: string; read?: string; min?: string; q?: string; category?: string; feed?: string; unread?: string }>();
  const ref = listRefOf(search ? SEARCH_KEY : (params.key ?? "unread"), params);
  const reader = useReaderList(ref);
  const { list, items, fetched, view, isEvents } = reader;
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<ArticleSummary | null>(null);
  const [narrowing, setNarrowing] = useState(false);
  const { height: windowHeight } = useWindowDimensions();

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

  const setFilter = (name: "read" | "min" | "unread", value: string, on: boolean) => router.setParams({ [name]: on ? value : undefined });
  /** Narrows the search results to a category or a feed, or to nothing. */
  const narrow = (to: { category?: number; feed?: number }) => {
    setNarrowing(false);
    router.setParams({ category: to.category === undefined ? undefined : String(to.category), feed: to.feed === undefined ? undefined : String(to.feed) });
  };
  const searchRef = ref.search;
  const narrowedTo =
    searchRef?.category !== undefined
      ? (categories.data?.find((entry) => entry.id === searchRef.category)?.name ?? "")
      : searchRef?.feed !== undefined
        ? (feeds.data?.find((entry) => entry.id === searchRef.feed)?.title ?? "")
        : "すべて";
  const narrowed = searchRef !== undefined && (searchRef.category !== undefined || searchRef.feed !== undefined || searchRef.unread);

  async function pulled() {
    setRefreshing(true);
    try {
      await reader.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  /** Opens the next list below this one that still has unread articles, by counts fetched after the marking. */
  async function openNext() {
    const from = parseListKey(key);
    if (!from) return;
    const counts = await client.fetchQuery({ queryKey: ["counts"], queryFn: () => api.counts(), staleTime: 0 });
    const next = nextTarget(buildNav({ categories: categories.data ?? [], feeds: feeds.data ?? [], counts }), from);
    if (!next) return;
    // The entry may sit below a folded category.
    const group = next.type === "feed" ? feeds.data?.find((feed) => feed.id === next.feedId)?.categoryId : next.type === "category" ? next.categoryId : undefined;
    if (next.type === "feed" || (next.type === "category" && next.generatedOnly)) {
      unfold(group == null ? listKey({ type: "uncategorized" }) : listKey({ type: "category", categoryId: group, generatedOnly: false }));
    }
    router.navigate({ pathname: "/list/[key]", params: { key: listKey(next) } });
  }

  async function markAllRead() {
    const newest = fetched.reduce<string | null>((latest, item) => (latest === null || item.updatedAt > latest ? item.updatedAt : latest), null);
    if (newest === null) return;
    // "Before" is just after the newest article on screen, so one that arrives later stays unread.
    const before = new Date(new Date(newest).getTime() + 1).toISOString();
    try {
      const result = await api.markRead({ before, ...reader.scope, ...(reader.importantOnly ? { minImportance: 4 } : {}) });
      await reader.refresh();
      if (settings.data?.advanceAfterMarkAll) await openNext();
      toast({
        message: `${result.updated}件を既読にしました`,
        durationMs: 10_000,
        action: { label: "取り消す", run: () => void api.markUnread(result.ids).then(() => reader.refresh()) },
      });
    } catch {
      toast({ message: "既読にできませんでした。もう一度試してください。" });
    }
  }

  const canMarkAll = reader.listControls && (view === "unread" || reader.readToggle) && fetched.some((item) => !item.isRead);
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
      {list.isPending && !list.isError && !(searchRef && searchRef.q.length === 0) ? <Loading /> : null}
      {searchRef && (searchRef.q.length === 0 || (list.isSuccess && items.length === 0)) ? (
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm, alignItems: "flex-start" }}>
          {searchRef.q.length === 0 ? (
            <Txt variant="body-md" color="on-surface-muted">
              項目の上の検索欄に語を入れてください。
            </Txt>
          ) : (
            <>
              <Txt variant="body-md">「{searchRef.q}」に一致する記事はありません。</Txt>
              <Txt variant="body-md" color="on-surface-muted">
                語を減らすと、見つかることがあります。
              </Txt>
              {narrowed ? <Button label="絞り込みを外す" onPress={() => router.setParams({ category: undefined, feed: undefined, unread: undefined })} /> : null}
            </>
          )}
        </View>
      ) : null}
      {!searchRef && list.isSuccess && items.length === 0 ? (
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm, alignItems: "flex-start" }}>
          <Txt variant="body-md" color="on-surface-muted">
            {emptyText(view, reader.hasSources, isEvents)}
          </Txt>
          {view === "recentlyRead" ? (
            <Button label="「未読」を開く" variant="quiet" onPress={() => router.navigate({ pathname: "/list/[key]", params: { key: "unread" } })} />
          ) : null}
        </View>
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
          // New term groups colour every row again.
          extraData={groups}
          renderItem={({ item }) => (
            <ArticleRow
              article={item}
              sourceName={reader.sourceName(item)}
              timeZone={timeZone}
              now={minute}
              time={reader.rowTime}
              onOpen={open}
              onToggleRead={toggleRead}
              onLongPress={showMenu}
              excerpt={reader.excerptOf(item.id)}
              terms={reader.terms}
              groups={groups}
            />
          )}
          ListHeaderComponent={
            <View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: theme.spacing.lg, paddingHorizontal: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.outline }}>
                {reader.readToggle ? <Toggle label="既読も表示" value={ref.includeRead} onChange={(on) => setFilter("read", "1", on)} /> : null}
                {reader.importanceFilter ? <Toggle label="重要度4以上だけ" value={ref.importantOnly} onChange={(on) => setFilter("min", "4", on)} /> : null}
                {searchRef ? (
                  <>
                    <Button label={`絞り込み：${narrowedTo}`} variant="quiet" onPress={() => setNarrowing(true)} />
                    <Toggle label="未読だけ" value={searchRef.unread} onChange={(on) => setFilter("unread", "true", on)} />
                  </>
                ) : null}
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
      <Sheet title="絞り込み" visible={narrowing} onClose={() => setNarrowing(false)}>
        {/* Many categories and feeds scroll inside the sheet, which keeps the screen above it in view. */}
        <ScrollView style={{ maxHeight: windowHeight * 0.6 }} contentContainerStyle={{ gap: theme.spacing.sm }}>
          <Button label="すべて" onPress={() => narrow({})} />
          {(categories.data ?? []).map((entry) => (
            <Button key={`c${entry.id}`} label={entry.name} onPress={() => narrow({ category: entry.id })} />
          ))}
          {(feeds.data ?? []).map((entry) => (
            <Button key={`f${entry.id}`} label={entry.title} onPress={() => narrow({ feed: entry.id })} />
          ))}
        </ScrollView>
        <Button label="閉じる" variant="quiet" onPress={() => setNarrowing(false)} />
      </Sheet>
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
