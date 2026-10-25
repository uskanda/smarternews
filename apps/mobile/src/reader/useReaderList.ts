import {
  GENERATED_LABEL,
  hasListControls,
  hasReadToggle,
  hasSortMenu,
  listKey as keyOf,
  listSortOf,
  mergeKept,
  parseListKey,
  RECENTLY_READ_LABEL,
  ANNOTATIONS_LABEL,
  sortKeyFor,
  targetFilter,
  targetScope,
  UNCATEGORIZED_LABEL,
  type ListTarget,
} from "@smarternews/client";
import type { ArticleListQuery, ArticleSummary, Category, Feed, ListSort } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useArticleFlags, useArticleList, useArticleSearch, useCategories, useFeeds, useListSortChange, useListViews, useMentionArticles, useReadPatch } from "../api/queries";
import { useToast } from "../ui/toast";
import { advanceCheckedAt } from "../notifications/store";
import { useReaderSession } from "./session";

export type View = ListTarget["type"];

/** The key of the search results, which are no list of the drawer. */
export const SEARCH_KEY = "search";

/** The key of the articles of a name found in articles, which are no list of the drawer either. */
export const MENTION_KEY = "mention";

/** A search: the words, and the narrowing to a category, a feed or unread articles. */
export interface SearchRef {
  q: string;
  category?: number;
  feed?: number;
  unread: boolean;
}

export interface ListRef {
  /** The key of a list, as `listKey` of the shared client writes it: "unread", "category-3", "feed-7" and so on. */
  key: string;
  includeRead: boolean;
  importantOnly: boolean;
  /** Set for the search results, whose key is `SEARCH_KEY`. */
  search?: SearchRef;
  /** Set for the articles of a name, whose key is `MENTION_KEY`. */
  mention?: { name: string };
}

const idParam = (value: string | undefined) => (value !== undefined && /^\d{1,15}$/.test(value) ? Number(value) : undefined);

/** The list a screen shows, from the key of the list and the search parameters of the screen. */
export function listRefOf(
  key: string,
  params: { read?: string; min?: string; q?: string; category?: string; feed?: string; unread?: string; name?: string },
): ListRef {
  return {
    key,
    includeRead: params.read === "1",
    importantOnly: params.min === "4",
    ...(key === SEARCH_KEY
      ? {
          search: {
            q: (params.q ?? "").trim(),
            ...(idParam(params.category) !== undefined ? { category: idParam(params.category) } : {}),
            ...(idParam(params.feed) !== undefined ? { feed: idParam(params.feed) } : {}),
            unread: params.unread === "true",
          },
        }
      : {}),
    ...(key === MENTION_KEY ? { mention: { name: (params.name ?? "").trim() } } : {}),
  };
}

const TITLES: Record<Exclude<View, "category" | "feed">, string> = {
  unread: "未読",
  all: "すべて",
  starred: "スター",
  generated: GENERATED_LABEL,
  uncategorized: UNCATEGORIZED_LABEL,
  recentlyRead: RECENTLY_READ_LABEL,
  // Not in the drawer: the app shows annotations in the article only.
  annotations: ANNOTATIONS_LABEL,
};
const EMPTY: ArticleSummary[] = [];

/** The search parameters that carry a list's filters from the list screen to the article screen and back. */
export function listParams(ref: ListRef): Record<string, string> {
  if (ref.mention) return { name: ref.mention.name };
  if (ref.search) {
    const { q, category, feed, unread } = ref.search;
    return { q, ...(category !== undefined ? { category: String(category) } : {}), ...(feed !== undefined ? { feed: String(feed) } : {}), ...(unread ? { unread: "true" } : {}) };
  }
  return { ...(ref.includeRead ? { read: "1" } : {}), ...(ref.importantOnly ? { min: "4" } : {}) };
}

/**
 * One list of articles, as both the list screen and the article screen see it: what the server returned plus
 * the articles read during this visit, and the operations on them.
 */
export function useReaderList(ref: ListRef) {
  const client = useQueryClient();
  const session = useReaderSession();
  const flags = useArticleFlags();
  const categories = useCategories();
  const feeds = useFeeds();

  // A key that names no list is read as the unread list, where the app starts.
  const target = useMemo<ListTarget>(() => parseListKey(ref.key) ?? { type: "unread" }, [ref.key]);
  const search = ref.search;
  const isSearch = search !== undefined;
  const mention = ref.mention;
  const isMention = mention !== undefined;
  // Search results and the articles of a name are found articles: no list of the drawer, and nothing to finish.
  const found = isSearch || isMention;
  const view: View = target.type;
  const category: Category | undefined = target.type === "category" ? categories.data?.find((entry) => entry.id === target.categoryId) : undefined;
  const feed: Feed | undefined = target.type === "feed" ? feeds.data?.find((entry) => entry.id === target.feedId) : undefined;
  const isEvents = target.type === "category" && !target.generatedOnly && category?.kind === "event";
  const readToggle = !found && hasReadToggle(target) && !isEvents;
  // Found articles never offer marking everything read: they are not a list to finish.
  const listControls = !found && hasListControls(target);
  // Feed articles have no importance, so the filter is offered only where generated articles can be.
  const importanceFilter = view !== "feed" && view !== "uncategorized" && listControls;
  const importantOnly = importanceFilter && ref.importantOnly;
  // The order the entry keeps. The list waits for the views, so that it is not fetched first in the wrong order.
  const toast = useToast();
  const listViews = useListViews();
  const viewsSettled = listViews.isSuccess || listViews.isError;
  const sortMenu = !found && hasSortMenu(target, categories.data);
  const sort: ListSort = sortMenu ? listSortOf(target, listViews.data?.items, categories.data) : "newest";
  const sortChange = useListSortChange(() => toast({ message: "並び順を保存できませんでした。もう一度試してください。" }));
  /** True when the list names a category or a feed that does not exist. */
  const missing = !found && ((target.type === "category" && categories.isSuccess && !category) || (target.type === "feed" && feeds.isSuccess && !feed));

  const filter = useMemo<ArticleListQuery>(() => {
    if (isEvents) return { category: category!.id, kind: "event" };
    return {
      ...(importantOnly ? { minImportance: 4 } : {}),
      ...targetFilter(target, sort),
      ...(readToggle && !ref.includeRead ? { unread: "true" as const } : {}),
    };
  }, [target, category, isEvents, readToggle, ref.includeRead, importantOnly, sort]);
  const searchQuery = useMemo(
    () => ({
      q: search?.q ?? "",
      ...(search?.category !== undefined ? { category: search.category } : {}),
      ...(search?.feed !== undefined ? { feed: search.feed } : {}),
      ...(search?.unread ? { unread: "true" as const } : {}),
    }),
    [search?.q, search?.category, search?.feed, search?.unread],
  );
  const unreadOnly = isSearch ? searchQuery.unread === "true" : !isMention && filter.unread === "true";
  // The recently read articles stop being listed once put back to unread: such a row is kept like a read one in an unread list.
  const recentlyRead = !found && filter.recentlyRead === "true";
  // A change of order is the same list: what was kept moves to its place in the new order.
  const mentionName = mention?.name ?? "";
  const listKey = JSON.stringify(isSearch ? { search: searchQuery } : isMention ? { mention: mentionName } : { ...filter, order: undefined });

  const articleList = useArticleList(filter, !missing && !found && viewsSettled);
  const results = useArticleSearch(searchQuery, isSearch && searchQuery.q.length > 0);
  const mentionList = useMentionArticles(mentionName, isMention && mentionName.length > 0);
  const list = isSearch ? results : isMention ? mentionList : articleList;
  const fetched = useMemo<ArticleSummary[]>(
    () => (isSearch ? results.data : isMention ? mentionList.data : articleList.data)?.pages.flatMap((page) => page.items) ?? EMPTY,
    [isSearch, isMention, results.data, mentionList.data, articleList.data],
  );
  const excerpts = useMemo(
    () => new Map(results.data?.pages.flatMap((page) => page.items.map((item) => [item.id, item] as const)) ?? []),
    [results.data],
  );
  // What was listed on screen has been seen: the periodic check does not notify it later. Only generated
  // articles are ever notified, so only they move the mark: a newer feed article must not hide from the
  // check a generated article that is in another list.
  useEffect(() => {
    const newest = fetched.reduce((latest, item) => (item.origin === "generated" && item.updatedAt > latest ? item.updatedAt : latest), "");
    if (newest !== "") void advanceCheckedAt(newest);
  }, [fetched]);
  const kept = session.keptFor(listKey);
  const items = useMemo(() => mergeKept(fetched, kept, found ? undefined : sortKeyFor(target), sort), [fetched, kept, target, found, sort]);

  const setRead = useCallback(
    (target: { id: number }, isRead: boolean) => {
      // Put back to unread by the user: scrolling past it does not read it again in this visit to the list.
      if (!isRead) session.exclude(listKey, target.id);
      const summary = items.find((item) => item.id === target.id);
      if ((unreadOnly || recentlyRead) && summary) session.keep(listKey, { ...summary, isRead });
      flags.mutate({ id: target.id, isRead });
    },
    [items, unreadOnly, recentlyRead, session, listKey, flags],
  );
  const readPatch = useReadPatch();
  /** Shows rows read, or unread again, as the list was scrolled past them: before or without a request. */
  const showRead = useCallback(
    (rows: readonly ArticleSummary[], isRead: boolean) => {
      for (const row of rows) {
        if (unreadOnly) session.keep(listKey, { ...row, isRead });
        else session.patch(row.id, { isRead });
      }
      readPatch(
        rows.map((row) => row.id),
        isRead,
      );
    },
    [unreadOnly, session, listKey, readPatch],
  );
  const toggleStar = useCallback(
    (target: { id: number; starred: boolean }) => {
      session.patch(target.id, { starred: !target.starred });
      flags.mutate({ id: target.id, starred: !target.starred });
    },
    [session, flags],
  );
  const refresh = useCallback(async () => {
    session.reset(listKey);
    // The term groups too: they are changed on the web page, and a pull is how the app hears of it.
    await Promise.all([
      client.invalidateQueries({ queryKey: ["articles"] }),
      client.invalidateQueries({ queryKey: ["counts"] }),
      client.invalidateQueries({ queryKey: ["term-groups"] }),
    ]);
  }, [session, listKey, client]);

  const categoryName = (categoryId: number | null) => categories.data?.find((entry) => entry.id === categoryId)?.name ?? "";
  const feedName = (feedId: number | null) => feeds.data?.find((entry) => entry.id === feedId)?.title ?? "";
  const title = isSearch
    ? searchQuery.q.length > 0
      ? `「${searchQuery.q}」の検索結果`
      : "検索"
    : isMention
      ? mentionName.length > 0
        ? `「${mentionName}」を含む記事`
        : "名前を含む記事"
      : target.type === "category"
      ? category
        ? target.generatedOnly
          ? `${category.name}の${GENERATED_LABEL}`
          : category.name
        : ""
      : target.type === "feed"
        ? (feed?.title ?? "")
        : TITLES[target.type];

  return {
    view,
    target,
    /** True for the search results. */
    isSearch,
    /** The name of the articles of a name, or undefined for any other list. */
    mention: isMention ? mentionName : undefined,
    /** The words the server matched, normalized: what a search result marks. Undefined outside the search results. */
    terms: isSearch ? results.data?.pages[0]?.terms : undefined,
    /** The excerpt of a search result, or null when only its title matched or it is no search result. */
    excerptOf: (id: number) => excerpts.get(id)?.excerpt ?? null,
    /** Whether the excerpt of a search result was taken from a note of the reader's. */
    excerptFromNote: (id: number) => excerpts.get(id)?.excerptFromNote ?? false,
    title,
    category,
    missing,
    /** What to say when the list does not exist. */
    missingText: target.type === "feed" ? "この購読フィードはありません。" : "このカテゴリはありません。",
    isEvents,
    /** True when the list shows unread articles only until the reader asks for the read ones too. */
    readToggle,
    /** False where mark all as read and the importance toggle are never offered: the recently read articles. */
    listControls,
    importanceFilter,
    /** Which time a row shows: when it was read in the recently read articles, else when it was last updated. */
    rowTime: (recentlyRead ? "read" : "updated") as "read" | "updated",
    importantOnly,
    /** Whether the list offers the menu of its order: not the events, the recently read or the search results. */
    sortMenu,
    /** The order the list is shown in. */
    sort,
    /** Lists the entry in the other order, from its start, and stores the order on the server. */
    changeSort: (next: ListSort) => sortChange.mutate({ key: keyOf(target), sort: next }),
    /** When the server read the first page: what a mark-all-read covers, whatever the order and the pages loaded. */
    asOf: articleList.data?.pages[0]?.asOf,
    /** What a mark-all-read of this list covers. */
    scope: targetScope(target),
    filter,
    list,
    fetched,
    items,
    /** False while there is nothing to read from at all: no category and no subscribed feed. */
    hasSources: (categories.data?.length ?? 1) > 0 || (feeds.data?.length ?? 0) > 0,
    categoryName,
    /** What stands beside the time of an article: the feed of a feed article, the category of a generated one. */
    sourceName: (article: { origin: ArticleSummary["origin"]; feedId: number | null; categoryId: number | null }) =>
      article.origin === "feed" ? feedName(article.feedId) : categoryName(article.categoryId),
    setRead,
    toggleStar,
    refresh,
    /** Which list this is, for what is kept and excluded during a visit to it. */
    listKey,
    /** False where scrolling past a row never reads it: the recently read articles, found articles and events. */
    scrollReadable: !found && !recentlyRead && !isEvents,
    showRead,
    excluded: session.excludedFor(listKey),
    /** Says that this list is the one shown, which ends the visit to the last one. */
    visit: session.visit,
  };
}
