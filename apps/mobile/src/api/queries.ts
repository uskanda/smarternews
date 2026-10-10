import type { Article, ArticleList, ArticleListQuery, ArticleSummary } from "@smarternews/core/api";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
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
