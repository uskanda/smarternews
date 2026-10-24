import type { Article, ArticleList, ArticleListQuery, ArticleSearchQuery, ArticleSummary } from "@smarternews/core/api";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";

/** How often lists and counts are fetched again while the app is in the foreground. */
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

/** The subscribed feeds: their names, and which category each belongs to. */
export function useFeeds() {
  const { api } = useApp();
  return useQuery({ queryKey: ["feeds"], queryFn: () => api.feeds(), refetchInterval: REFRESH_MS });
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
  return useQuery({ queryKey: ["article", id], queryFn: () => api.article(id!), enabled: id !== null });
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
 * put into the article and into the lists, which show the translated title. `active` is false for a page
 * drawn beside the one in view: that article is not open yet, and nothing is asked for it.
 */
export function useArticleTranslation(article: Article | undefined, active: boolean) {
  const { api } = useApp();
  const client = useQueryClient();
  const id = article?.id ?? null;
  const wanted = active && article !== undefined && article.translatable && (article.translation === null || article.translatedTitle === null);
  return useQuery({
    // The full content, once it arrives, is translated anew: the server dropped the translation of the excerpt.
    queryKey: ["article-translation", id, article?.fullContent?.fetchedAt ?? null],
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

/**
 * Fetching the full content of feed articles from their pages. `fetch` asks the server and waits for the page;
 * a second press for an article under way does nothing. What arrives, full content or the reason it failed, is
 * put into the article, which is then fetched again. `requestFailed` is for a request that got no answer.
 */
export function useFullContentFetch() {
  const { api } = useApp();
  const client = useQueryClient();
  const underWay = useRef(new Set<number>());
  const [fetching, setFetching] = useState<ReadonlySet<number>>(new Set());
  const [unanswered, setUnanswered] = useState<ReadonlySet<number>>(new Set());
  const fetch = useCallback(
    (id: number) => {
      if (underWay.current.has(id)) return;
      underWay.current.add(id);
      setFetching(new Set(underWay.current));
      setUnanswered((current) => new Set([...current].filter((other) => other !== id)));
      api
        .fetchFullContent(id)
        .then((result) => {
          client.setQueryData<Article>(["article", id], (current) => {
            if (!current) return current;
            if (result.status === "failed") return { ...current, fullContentStatus: "failed", fullContentError: result.error };
            // Storing the full content dropped the translation of what the feed delivered.
            const translation = current.fullContentStatus === "fetched" ? current.translation : null;
            return { ...current, fullContent: result.fullContent, fullContentStatus: "fetched", fullContentError: null, translation };
          });
          void client.invalidateQueries({ queryKey: ["article", id] });
        })
        .catch(() => setUnanswered((current) => new Set([...current, id])))
        .finally(() => {
          underWay.current.delete(id);
          setFetching(new Set(underWay.current));
        });
    },
    [api, client],
  );
  return { fetch, isFetching: (id: number) => fetching.has(id), requestFailed: (id: number) => unanswered.has(id) };
}

/** How often an open article is fetched again while its summary is on its way, and for how long. */
const SUMMARY_POLL_MS = 5_000;
const SUMMARY_POLL_TRIES = 36;

/**
 * Asks for the summary of an open article that waits for one, then looks for it every few seconds: the
 * server writes it right away, ahead of the articles nobody has open. `state` says what to tell the reader.
 */
export function useSummaryRequest(article: Article | undefined, active: boolean): "none" | "waiting" | "limit" | "late" {
  const { api } = useApp();
  const client = useQueryClient();
  const id = article?.id ?? null;
  const wanted = active && article !== undefined && article.autoSummary === null && article.autoSummaryPending;
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
      // the row it changed until the reader refreshes.
      else if (variables.isRead !== undefined) void client.invalidateQueries({ queryKey: ["articles", { recentlyRead: "true" }] });
    },
  });
}

/** Runs are fetched every few seconds while one is waiting or in progress, and every minute otherwise. */
export function useRuns() {
  const { api } = useApp();
  return useQuery({
    queryKey: ["runs"],
    queryFn: () => api.runs({ limit: 100 }),
    refetchInterval: (query) => (query.state.data?.some((run) => run.status === "queued" || run.status === "running") ? 3000 : REFRESH_MS),
  });
}
