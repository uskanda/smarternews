import { listKey } from "@smarternews/client";
import type { Article } from "@smarternews/core/api";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useArticle } from "../api/queries";
import { useBack } from "../lib/back";
import { openSource } from "../lib/links";
import { useTheme } from "../theme/theme";
import { IconButton } from "../ui/controls";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Txt } from "../ui/Txt";
import { ArticlePage } from "./ArticlePage";
import { listParams, useReaderList } from "./useReaderList";

/**
 * The article the user opened, as one page among the articles of the list it was opened from: swiping left or
 * right moves to the neighbour in the list's order.
 */
export function ArticleScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; list?: string; read?: string; min?: string }>();
  const openedId = Number(params.id);
  const ref = { key: params.list ?? "unread", includeRead: params.read === "1", importantOnly: params.min === "4" };
  const reader = useReaderList(ref);
  const back = useBack({ pathname: "/list/[key]", params: { key: ref.key, ...listParams(ref) } });

  // The pages keep the order the list had when the article was opened. A refresh in the background must not
  // move what the user is reading.
  const frozen = useRef<number[] | null>(null);
  if (frozen.current === null && reader.list.isSuccess) {
    const ids = reader.items.map((item) => item.id);
    frozen.current = ids.includes(openedId) ? ids : [openedId];
  }
  const ids = useMemo(() => frozen.current ?? [openedId], [openedId, reader.list.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = Math.max(0, ids.indexOf(openedId));
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState<number | null>(null);
  // Until the user swipes, the page in view is the article that was opened, wherever the list puts it.
  const position = Math.min(index ?? start, ids.length - 1);
  const currentId = ids[position] ?? openedId;
  const current = useArticle(currentId).data;

  // The page in view is read off the scroll position whenever a scroll comes to rest, however it was started:
  // a fling, a slow drag, or a screen reader's scroll.
  function settled(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== position && next >= 0 && next < ids.length) setIndex(next);
  }

  /** Moves one article on or back without a swipe. */
  function step(by: number) {
    const next = position + by;
    if (next < 0 || next >= ids.length) return;
    pager.current?.scrollTo({ x: width * next, animated: true });
    setIndex(next);
  }

  // The pages are drawn again only when their own article changes, so what they call stays the same function.
  const latest = useRef({ reader, ref, router });
  latest.current = { reader, ref, router };
  const onRead = useCallback((article: Article) => latest.current.reader.setRead(article, true), []);
  const openArticle = useCallback((id: number) => {
    const { ref: list, router: to } = latest.current;
    to.push({ pathname: "/article/[id]", params: { id: String(id), list: list.key, ...listParams(list) } });
  }, []);
  // The copy is opened in the list of its feed, read articles included: it was most likely read with this one.
  const openCopy = useCallback((copy: Article["otherFeeds"][number]) => {
    const list = { key: listKey({ type: "feed", feedId: copy.feedId }), includeRead: true, importantOnly: false };
    latest.current.router.push({ pathname: "/article/[id]", params: { id: String(copy.articleId), list: list.key, ...listParams(list) } });
  }, []);
  const sourceName = reader.sourceName;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ScreenHeader
        title={current ? sourceName(current) : ""}
        left={<IconButton label="一覧へ戻る" icon="back" onPress={back} />}
        right={
          ids.length > 1 ? (
            <Txt
              variant="label-sm"
              color="on-surface-muted"
              accessibilityLabel={`${ids.length}件のうち${position + 1}件目`}
              // Said when the page changes, so that a move without a swipe is not silent.
              accessibilityLiveRegion="polite"
              style={{ paddingHorizontal: theme.spacing.md, fontVariant: ["tabular-nums"] }}
            >
              {position + 1} / {ids.length}
            </Txt>
          ) : null
        }
      />
      <ScrollView
        testID="article-pager"
        ref={pager}
        // The pages are fixed once the list is known; a new key lays them out from the opened article.
        key={ids.length > 1 ? "list" : "single"}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: width * start, y: 0 }}
        // Laid out again (first layout, or the window changed size): stay on the page in view.
        onLayout={() => pager.current?.scrollTo({ x: width * position, animated: false })}
        onMomentumScrollEnd={settled}
        onScrollEndDrag={settled}
        // Swiping is not the only way: a screen reader offers these two as actions of the article.
        accessibilityActions={
          ids.length > 1
            ? [
                { name: "next", label: "次の記事" },
                { name: "previous", label: "前の記事" },
              ]
            : undefined
        }
        onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "next" ? 1 : -1)}
      >
        {ids.map((id, at) =>
          // Only the page in view and its two neighbours are drawn; the others hold their place.
          Math.abs(at - position) <= 1 ? (
            // An article is marked as read only once the list is known, so that it can be kept in that list.
            <ArticlePage
              key={id}
              id={id}
              active={at === position && !reader.list.isPending}
              width={width}
              sourceName={sourceName(reader.items.find((item) => item.id === id) ?? { origin: "generated", feedId: null, categoryId: null })}
              onRead={onRead}
              onOpenArticle={openArticle}
              onOpenCopy={openCopy}
            />
          ) : (
            <View key={id} style={{ width }} />
          ),
        )}
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-around",
          paddingBottom: insets.bottom,
          borderTopWidth: 1,
          borderTopColor: theme.colors.outline,
          backgroundColor: theme.colors.surface,
        }}
      >
        <IconButton
          label={current?.starred ? "スターを外す" : "スターを付ける"}
          icon="star"
          filled={current?.starred ?? false}
          disabled={!current}
          onPress={() => current && reader.toggleStar(current)}
        />
        <IconButton
          label={current?.isRead ? "未読に戻す" : "既読にする"}
          icon="unread"
          filled={current ? !current.isRead : false}
          disabled={!current}
          onPress={() => current && reader.setRead(current, !current.isRead)}
        />
        <IconButton
          label="出典を開く"
          icon="open"
          disabled={!current?.primaryUrl}
          onPress={() => current?.primaryUrl && void openSource(current.primaryUrl)}
        />
      </View>
    </View>
  );
}
