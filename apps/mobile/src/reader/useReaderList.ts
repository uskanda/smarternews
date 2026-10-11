import { GENERATED_LABEL, hasReadToggle, mergeKept, parseListKey, targetFilter, targetScope, UNCATEGORIZED_LABEL, type ListTarget } from "@smarternews/client";
import type { ArticleListQuery, ArticleSummary, Category, Feed } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useArticleFlags, useArticleList, useCategories, useFeeds } from "../api/queries";
import { advanceCheckedAt } from "../notifications/store";
import { useReaderSession } from "./session";

export type View = ListTarget["type"];

export interface ListRef {
  /** The key of a list, as `listKey` of the shared client writes it: "unread", "category-3", "feed-7" and so on. */
  key: string;
  includeRead: boolean;
  importantOnly: boolean;
}

const TITLES: Record<Exclude<View, "category" | "feed">, string> = {
  unread: "未読",
  all: "すべて",
  starred: "スター",
  generated: GENERATED_LABEL,
  uncategorized: UNCATEGORIZED_LABEL,
};
const EMPTY: ArticleSummary[] = [];

/** The search parameters that carry a list's filters from the list screen to the article screen and back. */
export function listParams(ref: ListRef): Record<string, string> {
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
  const view: View = target.type;
  const category: Category | undefined = target.type === "category" ? categories.data?.find((entry) => entry.id === target.categoryId) : undefined;
  const feed: Feed | undefined = target.type === "feed" ? feeds.data?.find((entry) => entry.id === target.feedId) : undefined;
  const isEvents = target.type === "category" && !target.generatedOnly && category?.kind === "event";
  const readToggle = hasReadToggle(target) && !isEvents;
  // Feed articles have no importance, so the filter is offered only where generated articles can be.
  const importanceFilter = view !== "feed" && view !== "uncategorized";
  const importantOnly = importanceFilter && ref.importantOnly;
  /** True when the list names a category or a feed that does not exist. */
  const missing = (target.type === "category" && categories.isSuccess && !category) || (target.type === "feed" && feeds.isSuccess && !feed);

  const filter = useMemo<ArticleListQuery>(() => {
    if (isEvents) return { category: category!.id, kind: "event" };
    return {
      ...(importantOnly ? { minImportance: 4 } : {}),
      ...targetFilter(target),
      ...(readToggle && !ref.includeRead ? { unread: "true" as const } : {}),
    };
  }, [target, category, isEvents, readToggle, ref.includeRead, importantOnly]);
  const unreadOnly = filter.unread === "true";
  const listKey = JSON.stringify(filter);

  const list = useArticleList(filter, !missing);
  const fetched = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? EMPTY, [list.data]);
  // What was listed on screen has been seen: the periodic check does not notify it later. Only generated
  // articles are ever notified, so only they move the mark: a newer feed article must not hide from the
  // check a generated article that is in another list.
  useEffect(() => {
    const newest = fetched.reduce((latest, item) => (item.origin === "generated" && item.updatedAt > latest ? item.updatedAt : latest), "");
    if (newest !== "") void advanceCheckedAt(newest);
  }, [fetched]);
  const kept = session.keptFor(listKey);
  const items = useMemo(() => mergeKept(fetched, kept), [fetched, kept]);

  const setRead = useCallback(
    (target: { id: number }, isRead: boolean) => {
      const summary = items.find((item) => item.id === target.id);
      if (unreadOnly && summary) session.keep(listKey, { ...summary, isRead });
      flags.mutate({ id: target.id, isRead });
    },
    [items, unreadOnly, session, listKey, flags],
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
    await Promise.all([client.invalidateQueries({ queryKey: ["articles"] }), client.invalidateQueries({ queryKey: ["counts"] })]);
  }, [session, listKey, client]);

  const categoryName = (categoryId: number | null) => categories.data?.find((entry) => entry.id === categoryId)?.name ?? "";
  const feedName = (feedId: number | null) => feeds.data?.find((entry) => entry.id === feedId)?.title ?? "";
  const title =
    target.type === "category"
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
    title,
    category,
    missing,
    /** What to say when the list does not exist. */
    missingText: target.type === "feed" ? "この購読フィードはありません。" : "このカテゴリはありません。",
    isEvents,
    /** True when the list shows unread articles only until the reader asks for the read ones too. */
    readToggle,
    importanceFilter,
    importantOnly,
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
  };
}
