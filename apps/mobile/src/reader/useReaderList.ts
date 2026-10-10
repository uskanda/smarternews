import { mergeKept } from "@smarternews/client";
import type { ArticleListQuery, ArticleSummary, Category } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useArticleFlags, useArticleList, useCategories } from "../api/queries";
import { advanceCheckedAt } from "../notifications/store";
import { useReaderSession } from "./session";

export type View = "unread" | "all" | "starred" | "category";

export interface ListRef {
  /** "unread", "all", "starred", or "c-" followed by a category's slug. */
  key: string;
  includeRead: boolean;
  importantOnly: boolean;
}

const TITLES: Record<Exclude<View, "category">, string> = { unread: "未読", all: "すべて", starred: "スター" };
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

  const view: View = ref.key === "unread" || ref.key === "all" || ref.key === "starred" ? ref.key : "category";
  const slug = view === "category" ? ref.key.replace(/^c-/, "") : null;
  const category: Category | undefined = slug === null ? undefined : categories.data?.find((entry) => entry.slug === slug);
  const isEvents = category?.kind === "event";

  const filter = useMemo<ArticleListQuery>(() => {
    const base: ArticleListQuery = ref.importantOnly ? { minImportance: 4 } : {};
    if (view === "unread") return { ...base, unread: "true" };
    if (view === "starred") return { ...base, starred: "true" };
    if (view === "all") return base;
    if (isEvents) return { category: category!.id, kind: "event" };
    return { ...base, category: category?.id, ...(ref.includeRead ? {} : { unread: "true" }) };
  }, [view, category, isEvents, ref.includeRead, ref.importantOnly]);
  const unreadOnly = filter.unread === "true";
  const listKey = JSON.stringify(filter);

  const list = useArticleList(filter, view !== "category" || category !== undefined);
  const fetched = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? EMPTY, [list.data]);
  // What was listed on screen has been seen: the periodic check does not notify it later.
  useEffect(() => {
    const newest = fetched.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), "");
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

  return {
    view,
    title: view === "category" ? (category?.name ?? "") : TITLES[view],
    category,
    /** True when the list names a category that does not exist. */
    missing: view === "category" && categories.isSuccess && !category,
    isEvents,
    filter,
    list,
    fetched,
    items,
    categories: categories.data ?? [],
    categoryName: (categoryId: number) => categories.data?.find((entry) => entry.id === categoryId)?.name ?? "",
    setRead,
    toggleStar,
    refresh,
  };
}
