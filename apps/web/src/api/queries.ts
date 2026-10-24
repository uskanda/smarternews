import type { Article, ArticleList, ArticleListQuery, ArticleSearchQuery, ArticleSummary } from "@smarternews/core/api";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApp } from "../app/context.ts";

/** How often lists and counts are fetched again while the page is open. */
export const REFRESH_MS = 60_000;
const PAGE_SIZE = 50;

export function useSettings() {
  const { api } = useApp();
  return useQuery({ queryKey: ["settings"], queryFn: () => api.settings() });
}

/** The time zone every date is shown in. UTC until the settings have arrived. */
export function useTimeZone(): string {
  return useSettings().data?.timeZone ?? "UTC";
}

export function useCategories() {
  const { api } = useApp();
  return useQuery({ queryKey: ["categories"], queryFn: () => api.categories() });
}

/** The subscribed feeds. Fetched again like the counts: a fetch on the server changes their state and titles. */
export function useFeeds() {
  const { api } = useApp();
  return useQuery({ queryKey: ["feeds"], queryFn: () => api.feeds(), refetchInterval: REFRESH_MS });
}

/** The filters with what each hides now. Asked for again whenever a filter, a feed or a category changes. */
export function useFilters() {
  const { api } = useApp();
  return useQuery({ queryKey: ["filters"], queryFn: () => api.filters() });
}

/**
 * How many filters have the given feed or category as their scope, enabled or not: what goes with it when it
 * is deleted. Undefined until the filters have arrived.
 */
export function useScopedFilterCount(target: { feedId: number } | { categoryId: number } | null): number | undefined {
  const filters = useFilters().data;
  if (!filters || target === null) return undefined;
  return filters.filter((filter) =>
    "feedId" in target
      ? filter.scope.type === "feed" && filter.scope.feedId === target.feedId
      : filter.scope.type === "category" && filter.scope.categoryId === target.categoryId,
  ).length;
}

export function useCounts() {
  const { api } = useApp();
  return useQuery({ queryKey: ["counts"], queryFn: () => api.counts(), refetchInterval: REFRESH_MS });
}

export function useArticleList(filter: ArticleListQuery, enabled = true) {
  const { api } = useApp();
  return useInfiniteQuery({
    queryKey: ["articles", filter],
    queryFn: ({ pageParam }) => api.articles({ ...filter, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: REFRESH_MS,
    enabled,
  });
}

/**
 * Search results, a page at a time. Kept under "articles", so that a change of an article's flags reaches
 * them as it reaches the lists. Not fetched again by itself: results do not move while the reader goes through them.
 */
export function useArticleSearch(query: Omit<ArticleSearchQuery, "limit" | "cursor">, enabled = true) {
  const { api } = useApp();
  return useInfiniteQuery({
    queryKey: ["articles", "search", query],
    queryFn: ({ pageParam }) => api.search({ ...query, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useArticle(id: number | null) {
  const { api } = useApp();
  return useQuery({
    queryKey: ["article", id],
    queryFn: () => api.article(id!),
    enabled: id !== null,
    retry: false,
    // An article is fetched once, except while its summary is being made: then it is asked for again until the wait is over.
    refetchInterval: (query) => (query.state.data?.autoSummaryPending ? REFRESH_MS : false),
  });
}

/** Applies a change to one article wherever it is cached: in every list and in its own entry. */
function patchArticle(client: QueryClient, id: number, patch: Partial<ArticleSummary>): void {
  client.setQueriesData<InfiniteData<ArticleList>>({ queryKey: ["articles"] }, (data) =>
    data
      ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })) }
      : data,
  );
  client.setQueryData<Article>(["article", id], (article) => (article ? { ...article, ...patch } : article));
}

/**
 * The translation of a feed article's content. It is asked for when an article of a feed that translates is
 * opened without one; the server makes and stores it, so this happens once for an article. What arrives is
 * put into the article and into the lists, which show the translated title.
 */
export function useArticleTranslation(article: Article | undefined) {
  const { api } = useApp();
  const client = useQueryClient();
  const id = article?.id ?? null;
  const wanted = article !== undefined && article.translatable && (article.translation === null || article.translatedTitle === null);
  return useQuery({
    queryKey: ["article-translation", id],
    queryFn: async () => {
      const translation = await api.translateArticle(id!);
      patchArticle(client, id!, { translatedTitle: translation.translatedTitle });
      client.setQueryData<Article>(["article", id], (current) => (current ? { ...current, translation, sourceLanguage: translation.sourceLanguage } : current));
      return translation;
    },
    enabled: wanted,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** How much the translation API was used this month. */
export function useTranslationStatus() {
  const { api } = useApp();
  return useQuery({ queryKey: ["translation-status"], queryFn: () => api.translation() });
}

/** How often an open article is fetched again while its summary is on its way, and for how long. */
const SUMMARY_POLL_MS = 5_000;
const SUMMARY_POLL_TRIES = 36;

/**
 * Asks for the summary of an open article that waits for one, then looks for it every few seconds: the
 * server writes it right away, ahead of the articles nobody has open. `state` says what to tell the reader.
 */
export function useSummaryRequest(article: Article | undefined): "none" | "waiting" | "limit" | "late" {
  const { api } = useApp();
  const client = useQueryClient();
  const id = article?.id ?? null;
  const wanted = article !== undefined && article.autoSummary === null && article.autoSummaryPending;
  const request = useQuery({
    queryKey: ["article-summary-request", id],
    queryFn: () => api.requestSummary(id!),
    enabled: wanted,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const queued = wanted && request.data?.status === "queued";
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!queued) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > SUMMARY_POLL_TRIES) {
        clearInterval(timer);
        setLate(true);
        return;
      }
      void client.invalidateQueries({ queryKey: ["article", id] });
    }, SUMMARY_POLL_MS);
    return () => clearInterval(timer);
  }, [queued, id, client]);
  if (!wanted) return "none";
  if (request.data?.status === "limit") return "limit";
  if (request.data?.status === "none") return "none";
  return late ? "late" : "waiting";
}

/** Sets the read state or the star of an article. The screen changes at once and is put back on failure. */
export function useArticleFlags() {
  const { api } = useApp();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; isRead?: boolean; starred?: boolean }) => api.updateArticle(id, patch),
    onMutate: ({ id, ...patch }) => {
      const before = client.getQueryData<Article>(["article", id]);
      patchArticle(client, id, patch);
      return { before };
    },
    onError: (_error, { id }, context) => {
      if (context?.before) patchArticle(client, id, { isRead: context.before.isRead, starred: context.before.starred });
    },
    onSettled: (_data, _error, variables) => {
      void client.invalidateQueries({ queryKey: ["counts"] });
      // A star changes which articles the starred list holds.
      if (variables.starred !== undefined) void client.invalidateQueries({ queryKey: ["articles"] });
      // A read state changes which articles the recently read list holds. While that list is shown, it keeps
      // the row it changed until the reader refreshes; it shows the new list once the reader comes back to it.
      else if (variables.isRead !== undefined) void client.invalidateQueries({ queryKey: ["articles", { recentlyRead: "true" }] });
    },
  });
}

export function useTopics(categoryId: number | null) {
  const { api } = useApp();
  return useQuery({ queryKey: ["topics", categoryId], queryFn: () => api.topics(categoryId!), enabled: categoryId !== null });
}

export function useProviders() {
  const { api } = useApp();
  return useQuery({ queryKey: ["providers"], queryFn: () => api.providers(), refetchInterval: REFRESH_MS });
}

/** Runs are fetched every few seconds while one is waiting or in progress, and every minute otherwise. */
export function useRuns(category?: number) {
  const { api } = useApp();
  return useQuery({
    queryKey: ["runs", category ?? null],
    queryFn: () => api.runs({ category, limit: 100 }),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "queued" || run.status === "running") ? 3000 : REFRESH_MS,
  });
}

export function useRun(id: number | null) {
  const { api } = useApp();
  return useQuery({
    queryKey: ["run", id],
    queryFn: () => api.run(id!),
    enabled: id !== null,
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "queued" || query.state.data?.status === "running" ? 3000 : false),
  });
}
