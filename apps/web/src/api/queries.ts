import type {
  AnnotationList,
  Article,
  ArticleList,
  ArticleListQuery,
  ArticleNote,
  ArticleSearchQuery,
  ArticleSummary,
  Highlight,
  HighlightCreate,
  ListSort,
  ListViews,
} from "@smarternews/core/api";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { createTermMatcher, type TermMatcher } from "@smarternews/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * The term groups in their order. Changing them on the settings page sets this anew, so lists and articles
 * take the new colours without a reload.
 */
export function useTermGroups() {
  const { api } = useApp();
  return useQuery({ queryKey: ["term-groups"], queryFn: () => api.termGroups() });
}

/** Finds the terms of the term groups in a text. Has no terms until the groups have arrived. */
export function useTermMatcher(): TermMatcher {
  const groups = useTermGroups().data;
  return useMemo(() => createTermMatcher(groups ?? []), [groups]);
}

/**
 * The list views of the entries: the order each lists its articles in. Fetched when the page loads and not
 * again by itself, so that a change on another device does not reorder the list being read.
 */
export function useListViews() {
  const { api } = useApp();
  return useQuery({ queryKey: ["list-views"], queryFn: () => api.listViews(), staleTime: Number.POSITIVE_INFINITY });
}

/**
 * Changes the order of an entry. The screen takes it at once, and goes back to the order it had when the
 * server cannot store it; `onFailed` then says so.
 */
export function useListSortChange(onFailed: () => void) {
  const { api } = useApp();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, sort }: { key: string; sort: ListSort }) => api.updateListView(key, { sort }),
    onMutate: ({ key, sort }) => {
      const before = client.getQueryData<ListViews>(["list-views"]);
      const others = (before?.items ?? []).filter((view) => view.key !== key);
      client.setQueryData<ListViews>(["list-views"], { items: sort === "newest" ? others : [...others, { key, sort }] });
      return { before };
    },
    onError: (_error, _variables, context) => {
      client.setQueryData<ListViews>(["list-views"], context?.before ?? { items: [] });
      onFailed();
    },
  });
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

/**
 * The articles of a name found in articles, a page at a time. Kept under "articles", as search results are, and,
 * like them, not fetched again by itself.
 */
export function useMentionArticles(name: string, enabled = true) {
  const { api } = useApp();
  return useInfiniteQuery({
    queryKey: ["articles", "mention", name],
    queryFn: ({ pageParam }) => api.mentionArticles({ name, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
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
/**
 * Shows articles read or unread in every list and in their detail, before or without a request: the rows the
 * list was scrolled past, and those rows again when the request failed.
 */
export function useReadPatch(): (ids: readonly number[], isRead: boolean) => void {
  const client = useQueryClient();
  return useCallback(
    (ids, isRead) => {
      for (const id of ids) patchArticle(client, id, { isRead });
    },
    [client],
  );
}

/**
 * Records that an article's body is shown, for an article without an open time. The time that comes back goes
 * into every cached copy, so the same article is not sent again. A failure is not shown: the next opening sends
 * it again.
 */
export function useRecordOpened() {
  const { api } = useApp();
  const client = useQueryClient();
  const sending = useRef(new Set<number>());
  return useCallback(
    (article: Pick<Article, "id" | "openedAt">) => {
      if (article.openedAt !== null || sending.current.has(article.id)) return;
      sending.current.add(article.id);
      api.openArticle(article.id).then(
        ({ openedAt }) => patchArticle(client, article.id, { openedAt }),
        () => sending.current.delete(article.id),
      );
    },
    [api, client],
  );
}

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

/** The annotations of every article, the last made first, a page at a time. */
export function useAnnotationList() {
  const { api } = useApp();
  return useInfiniteQuery({
    queryKey: ["annotations"],
    queryFn: ({ pageParam }) => api.annotations({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

type AnnotationPages = InfiniteData<AnnotationList>;

/**
 * Writing annotations. What the server answers goes into the article and into the list of annotations at once,
 * without fetching them again. An annotation also decides whether filters hide a feed article and what search
 * finds, so the lists, the counts, the filters and search results are marked stale; search results are read
 * again when they are opened.
 */
export function useAnnotationActions() {
  const { api } = useApp();
  const client = useQueryClient();

  const stale = () => {
    for (const key of ["counts", "filters", "feeds"]) void client.invalidateQueries({ queryKey: [key] });
    // A list on screen takes in or lets go of the article now; search results only when they are opened again.
    void client.invalidateQueries({ queryKey: ["articles"], predicate: (query) => query.queryKey[1] !== "search" });
    void client.invalidateQueries({ queryKey: ["articles", "search"], refetchType: "none" });
  };
  const patchArticle = (articleId: number, change: (annotations: Article["annotations"]) => Article["annotations"]) =>
    client.setQueryData<Article>(["article", articleId], (article) => (article ? { ...article, annotations: change(article.annotations) } : article));
  const patchList = (change: (items: AnnotationList["items"]) => AnnotationList["items"]) =>
    client.setQueryData<AnnotationPages>(["annotations"], (data) =>
      data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: change(page.items) })) } : data,
    );
  /** The row of the list for an annotation of an article, with the titles of the article as the cache has it. */
  const rowOf = (articleId: number, annotation: { id: number; createdAt: string; quote: string | null; note: string | null }, kind: "highlight" | "note") => {
    const article = client.getQueryData<Article>(["article", articleId]);
    return article
      ? {
          kind,
          id: annotation.id,
          articleId,
          origin: article.origin,
          title: article.title,
          translatedTitle: article.translatedTitle,
          quote: annotation.quote,
          note: annotation.note,
          createdAt: annotation.createdAt,
        }
      : null;
  };
  const prepend = (row: AnnotationList["items"][number] | null) => {
    if (!row) return void client.invalidateQueries({ queryKey: ["annotations"] });
    client.setQueryData<AnnotationPages>(["annotations"], (data) =>
      data ? { ...data, pages: data.pages.map((page, index) => (index === 0 ? { ...page, items: [row, ...page.items.filter((item) => item.id !== row.id)] } : page)) } : data,
    );
  };

  return {
    async addHighlight(articleId: number, input: HighlightCreate): Promise<Highlight> {
      const highlight = await api.addHighlight(articleId, input);
      patchArticle(articleId, (annotations) => ({ ...annotations, highlights: [...annotations.highlights, highlight] }));
      prepend(rowOf(articleId, highlight, "highlight"));
      stale();
      return highlight;
    },
    async updateHighlight(highlight: Highlight, note: string | null): Promise<Highlight> {
      const changed = await api.updateHighlight(highlight.id, note);
      patchArticle(highlight.articleId, (annotations) => ({
        ...annotations,
        highlights: annotations.highlights.map((item) => (item.id === changed.id ? changed : item)),
      }));
      patchList((items) => items.map((item) => (item.id === changed.id ? { ...item, note: changed.note } : item)));
      stale();
      return changed;
    },
    async deleteHighlight(highlight: Highlight): Promise<void> {
      await api.deleteHighlight(highlight.id);
      patchArticle(highlight.articleId, (annotations) => ({ ...annotations, highlights: annotations.highlights.filter((item) => item.id !== highlight.id) }));
      patchList((items) => items.filter((item) => item.id !== highlight.id));
      stale();
    },
    async saveNote(articleId: number, text: string): Promise<ArticleNote> {
      const note = await api.saveArticleNote(articleId, text);
      patchArticle(articleId, (annotations) => ({ ...annotations, note }));
      const listed = client
        .getQueryData<AnnotationPages>(["annotations"])
        ?.pages.some((page) => page.items.some((item) => item.id === note.id));
      if (listed) patchList((items) => items.map((item) => (item.id === note.id ? { ...item, note: note.text } : item)));
      else prepend(rowOf(articleId, { id: note.id, createdAt: note.createdAt, quote: null, note: note.text }, "note"));
      stale();
      return note;
    },
    async deleteNote(articleId: number): Promise<void> {
      const before = client.getQueryData<Article>(["article", articleId])?.annotations.note ?? null;
      await api.deleteArticleNote(articleId);
      patchArticle(articleId, (annotations) => ({ ...annotations, note: null }));
      patchList((items) => items.filter((item) => !(item.kind === "note" && item.articleId === articleId) && item.id !== before?.id));
      stale();
    },
  };
}
