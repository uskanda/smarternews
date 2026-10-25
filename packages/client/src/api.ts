// The only code in the web app and the Android app that talks to the server. Every answer is checked against
// the shared schema, so a drift between an app and the API fails here and not somewhere in a component.
import {
  annotationListSchema,
  articleNoteSchema,
  highlightSchema,
  type AnnotationList,
  type AnnotationListQuery,
  type ArticleNote,
  type Highlight,
  type HighlightCreate,
  articleListSchema,
  articlePageSchema,
  articleSearchResultSchema,
  articleSchema,
  articleTranslationSchema,
  fullContentResultSchema,
  summaryRequestResultSchema,
  candidateSchema,
  categorySchema,
  countsSchema,
  feedDiscoveryResultSchema,
  feedFetchResultSchema,
  feedSchema,
  feedStatsSchema,
  importResultSchema,
  listViewSchema,
  listViewsSchema,
  markReadResultSchema,
  opmlImportResultSchema,
  providerStatusSchema,
  runSchema,
  settingsSchema,
  filterDeleteResultSchema,
  filterPreviewResultSchema,
  filterSchema,
  filterUpdateResultSchema,
  termGroupSchema,
  topicSchema,
  translationStatusSchema,
  type Article,
  type ArticleList,
  type ArticleListQuery,
  type ArticlePage,
  type ArticleSearchQuery,
  type ArticleSearchResult,
  type ArticleTranslation,
  type FullContentResult,
  type SummaryRequestResult,
  type ArticleUpdate,
  type Candidate,
  type Category,
  type CategoryCreate,
  type CategoryUpdate,
  type Counts,
  type Feed,
  type FeedCreate,
  type FeedDiscoveryResult,
  type FeedFetchResult,
  type FeedMove,
  type FeedStats,
  type FeedUpdate,
  type ImportResult,
  type ListView,
  type ListViews,
  type ListViewUpdate,
  type MarkRead,
  type MarkReadResult,
  type SeenArticle,
  type OpmlImportResult,
  type ProviderStatus,
  type Run,
  type Settings,
  type SettingsUpdate,
  type Filter,
  type FilterArticlesQuery,
  type FilterCreate,
  type FilterDeleteResult,
  type FilterPreview,
  type FilterPreviewResult,
  type FilterUpdate,
  type FilterUpdateResult,
  type HighlightTermCreate,
  type TermGroup,
  type TermGroupCreate,
  type TermGroupUpdate,
  type Topic,
  type TopicCreate,
  type TopicUpdate,
  type TranslationStatus,
} from "@smarternews/core/api";
import { z } from "zod";

export type ApiErrorKind = "unauthorized" | "invalid" | "not_found" | "conflict" | "unavailable" | "network" | "server";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly fields: Array<{ path: string; message: string }>;

  constructor(kind: ApiErrorKind, status: number | null, message: string, fields: Array<{ path: string; message: string }> = []) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.fields = fields;
  }
}

export type Fetch = (input: string, init?: RequestInit) => Response | Promise<Response>;

export interface ApiOptions {
  /** Where the server is, such as `http://news.example:8787`. Empty when the page itself comes from the server. */
  baseUrl?: string;
  fetchImpl?: Fetch;
  getToken: () => string | null;
  /** Called when the server rejects the stored token. */
  onUnauthorized: () => void;
}

const API_PATH = "/api/v1";

function kindOf(status: number): ApiErrorKind {
  if (status === 400) return "invalid";
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 503) return "unavailable";
  return "server";
}

export function createApi(options: ApiOptions) {
  const fetchImpl: Fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = `${(options.baseUrl ?? "").replace(/\/+$/, "")}${API_PATH}`;

  async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
      });
    } catch {
      throw new ApiError("network", null, "the server cannot be reached");
    }
    if (response.ok) return response;
    let message = `HTTP status ${response.status}`;
    let fields: ApiError["fields"] = [];
    try {
      const body = (await response.json()) as { error?: { message?: string; fields?: ApiError["fields"] } };
      message = body.error?.message ?? message;
      fields = body.error?.fields ?? [];
    } catch {
      // an error without a JSON body keeps the status as its message
    }
    throw new ApiError(kindOf(response.status), response.status, message, fields);
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await send(path, init, options.getToken());
    } catch (error) {
      if (error instanceof ApiError && error.kind === "unauthorized") options.onUnauthorized();
      throw error;
    }
  }

  async function json<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
    const response = await request(path, init);
    return schema.parse(await response.json());
  }

  const body = (method: string, value: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });

  function query(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) search.set(name, String(value));
    }
    const text = search.toString();
    return text.length > 0 ? `?${text}` : "";
  }

  return {
    /** True when the server accepts this token. The stored token is not involved. */
    async verifyToken(token: string): Promise<boolean> {
      try {
        await send("/settings", {}, token);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthorized") return false;
        throw error;
      }
    },

    settings: (): Promise<Settings> => json(settingsSchema, "/settings"),
    updateSettings: (patch: SettingsUpdate): Promise<Settings> => json(settingsSchema, "/settings", body("PATCH", patch)),
    exportSettings: async (): Promise<string> => (await request("/settings/export")).text(),
    importSettings: (text: string): Promise<ImportResult> =>
      json(importResultSchema, "/settings/import", { method: "POST", headers: { "content-type": "application/yaml" }, body: text }),

    categories: (): Promise<Category[]> => json(z.array(categorySchema), "/categories"),
    createCategory: (input: CategoryCreate): Promise<Category> => json(categorySchema, "/categories", body("POST", input)),
    updateCategory: (id: number, patch: CategoryUpdate): Promise<Category> =>
      json(categorySchema, `/categories/${id}`, body("PATCH", patch)),
    /** Puts the category before another one, or last. Answers with all categories in their order. */
    moveCategory: (id: number, before: number | null): Promise<Category[]> =>
      json(z.array(categorySchema), `/categories/${id}/move`, body("POST", { before })),
    deleteCategory: async (id: number): Promise<void> => void (await request(`/categories/${id}`, { method: "DELETE" })),

    topics: (categoryId: number): Promise<Topic[]> => json(z.array(topicSchema), `/categories/${categoryId}/topics`),
    createTopic: (categoryId: number, input: TopicCreate): Promise<Topic> =>
      json(topicSchema, `/categories/${categoryId}/topics`, body("POST", input)),
    updateTopic: (id: number, patch: TopicUpdate): Promise<Topic> => json(topicSchema, `/topics/${id}`, body("PATCH", patch)),
    deleteTopic: async (id: number): Promise<void> => void (await request(`/topics/${id}`, { method: "DELETE" })),

    articles: (filter: ArticleListQuery = {}): Promise<ArticleList> =>
      json(articleListSchema, `/articles${query(filter as Record<string, string | number | undefined>)}`),
    /** The articles that have every term of `q`, newest first, a page at a time, with excerpts and the terms matched. */
    search: (params: ArticleSearchQuery): Promise<ArticleSearchResult> =>
      json(
        articleSearchResultSchema,
        `/search${query({ q: params.q, category: params.category, feed: params.feed, unread: params.unread, cursor: params.cursor, limit: params.limit })}`,
      ),
    article: (id: number): Promise<Article> => json(articleSchema, `/articles/${id}`),
    updateArticle: (id: number, patch: ArticleUpdate): Promise<Article> =>
      json(articleSchema, `/articles/${id}`, body("PATCH", patch)),
    /**
     * The translation of a feed article's content. The server makes it when there is none yet, so the first
     * call for an article takes as long as translating does. Fails as `unavailable` when nothing can translate now.
     */
    /** Says that the article is open and its summary is wanted now. The answer tells whether one is on its way. */
    requestSummary: (id: number): Promise<SummaryRequestResult> => json(summaryRequestResultSchema, `/articles/${id}/summary`, { method: "POST" }),
    translateArticle: (id: number): Promise<ArticleTranslation> => json(articleTranslationSchema, `/articles/${id}/translation`, { method: "POST" }),
    /** Fetches the full content of a feed article from its page. Answers once the fetch is over, which can take seconds. */
    fetchFullContent: (id: number): Promise<FullContentResult> => json(fullContentResultSchema, `/articles/${id}/full-content`, { method: "POST" }),
    /**
     * Records that the article's body is shown to the reader. Only a screen that shows the body sends it; marking
     * read is a separate request. Answers with the time of the first opening.
     */
    openArticle: (id: number): Promise<{ openedAt: string }> =>
      json(z.object({ openedAt: z.string() }), `/articles/${id}/open`, { method: "POST" }),
    /** The annotations of every article, the last made first, a page at a time. */
    annotations: (page: AnnotationListQuery = {}): Promise<AnnotationList> => json(annotationListSchema, `/annotations${query(page)}`),
    /** Highlights a part of an article's body, with a note or none. */
    addHighlight: (articleId: number, input: HighlightCreate): Promise<Highlight> =>
      json(highlightSchema, `/articles/${articleId}/highlights`, body("POST", input)),
    /** Puts a note on a highlight in place of the one it has; null removes the note and keeps the highlight. */
    updateHighlight: (id: number, note: string | null): Promise<Highlight> => json(highlightSchema, `/highlights/${id}`, body("PATCH", { note })),
    deleteHighlight: async (id: number): Promise<void> => void (await request(`/highlights/${id}`, { method: "DELETE" })),
    /** Writes the note on a whole article, or replaces the one it has. */
    saveArticleNote: (articleId: number, text: string): Promise<ArticleNote> => json(articleNoteSchema, `/articles/${articleId}/note`, body("PUT", { text })),
    deleteArticleNote: async (articleId: number): Promise<void> => void (await request(`/articles/${articleId}/note`, { method: "DELETE" })),
    markRead: (input: MarkRead): Promise<MarkReadResult> => json(markReadResultSchema, "/articles/mark-read", body("POST", input)),
    /**
     * Marks read the articles as a screen showed them, each with the `updatedAt` it had on screen: one that a
     * follow-up updated since stays unread. `keepalive` lets the request finish after the page has gone.
     */
    markSeenRead: (articles: SeenArticle[], options: { keepalive?: boolean } = {}): Promise<MarkReadResult> =>
      json(markReadResultSchema, "/articles/mark-read", {
        ...body("POST", { articles }),
        ...(options.keepalive ? { keepalive: true } : {}),
      }),
    markUnread: (ids: number[]): Promise<{ updated: number }> =>
      json(z.object({ updated: z.number() }), "/articles/mark-unread", body("POST", { ids })),
    counts: (): Promise<Counts> => json(countsSchema, "/counts"),

    feeds: (): Promise<Feed[]> => json(z.array(feedSchema), "/feeds"),
    /** Subscribes to a feed. The server fetches the URL first, so this takes as long as that site does. */
    createFeed: (input: FeedCreate): Promise<Feed> => json(feedSchema, "/feeds", body("POST", input)),
    discoverFeeds: (url: string): Promise<FeedDiscoveryResult> => json(feedDiscoveryResultSchema, "/feeds/discover", body("POST", { url })),
    updateFeed: (id: number, patch: FeedUpdate): Promise<Feed> => json(feedSchema, `/feeds/${id}`, body("PATCH", patch)),
    /** Puts the feed into a category, before another feed there or last. Answers with all feeds in their order. */
    moveFeed: (id: number, to: FeedMove): Promise<Feed[]> => json(z.array(feedSchema), `/feeds/${id}/move`, body("POST", to)),
    deleteFeed: async (id: number): Promise<void> => void (await request(`/feeds/${id}`, { method: "DELETE" })),
    /** What became of the articles the feed delivered in the last 30 days. */
    feedStats: (id: number): Promise<FeedStats> => json(feedStatsSchema, `/feeds/${id}/stats`),
    fetchFeed: (id: number): Promise<FeedFetchResult> => json(feedFetchResultSchema, `/feeds/${id}/fetch`, { method: "POST" }),
    exportOpml: async (): Promise<string> => (await request("/feeds/opml")).text(),
    importOpml: (text: string): Promise<OpmlImportResult> =>
      json(opmlImportResultSchema, "/feeds/opml", { method: "POST", headers: { "content-type": "text/x-opml" }, body: text }),

    filters: (): Promise<Filter[]> => json(z.array(filterSchema), "/filters"),
    createFilter: (input: FilterCreate): Promise<Filter> => json(filterSchema, "/filters", body("POST", input)),
    /** Changes a filter or switches it. Says how many articles came back to the lists. */
    updateFilter: (id: number, patch: FilterUpdate): Promise<FilterUpdateResult> => json(filterUpdateResultSchema, `/filters/${id}`, body("PATCH", patch)),
    deleteFilter: (id: number): Promise<FilterDeleteResult> => json(filterDeleteResultSchema, `/filters/${id}`, { method: "DELETE" }),
    /** The feed articles a filter hides, newest first, a page at a time. */
    filterArticles: (id: number, page: FilterArticlesQuery = {}): Promise<ArticlePage> =>
      json(articlePageSchema, `/filters/${id}/articles${query(page)}`),
    /** How many articles a filter would hide, without saving it. With `id`, as a change to that filter. */
    previewFilter: (input: FilterPreview): Promise<FilterPreviewResult> => json(filterPreviewResultSchema, "/filters/preview", body("POST", input)),

    /** The entries whose list view differs from the defaults. Any other entry is newest first. */
    listViews: (): Promise<ListViews> => json(listViewsSchema, "/list-views"),
    /** Changes the list view of the entry a key of `listKey` names. Answers with the entry's view. */
    updateListView: (key: string, patch: ListViewUpdate): Promise<ListView> =>
      json(listViewSchema, `/list-views/${encodeURIComponent(key)}`, body("PATCH", patch)),

    /** The term groups in their order, each with its terms. */
    termGroups: (): Promise<TermGroup[]> => json(z.array(termGroupSchema), "/term-groups"),
    createTermGroup: (input: TermGroupCreate): Promise<TermGroup> => json(termGroupSchema, "/term-groups", body("POST", input)),
    updateTermGroup: (id: number, patch: TermGroupUpdate): Promise<TermGroup> => json(termGroupSchema, `/term-groups/${id}`, body("PATCH", patch)),
    deleteTermGroup: async (id: number): Promise<void> => void (await request(`/term-groups/${id}`, { method: "DELETE" })),
    /** Puts the term group before another one, or last. Answers with all term groups in their order. */
    moveTermGroup: (id: number, before: number | null): Promise<TermGroup[]> =>
      json(z.array(termGroupSchema), `/term-groups/${id}/move`, body("POST", { before })),
    /** Adds a term to a group. Answers with the group. */
    addHighlightTerm: (groupId: number, input: HighlightTermCreate): Promise<TermGroup> =>
      json(termGroupSchema, `/term-groups/${groupId}/terms`, body("POST", input)),
    deleteHighlightTerm: async (groupId: number, termId: number): Promise<void> =>
      void (await request(`/term-groups/${groupId}/terms/${termId}`, { method: "DELETE" })),

    runCategory: (categoryId: number): Promise<Run> => json(runSchema, `/categories/${categoryId}/runs`, { method: "POST" }),
    runs: (filter: { category?: number; limit?: number } = {}): Promise<Run[]> => json(z.array(runSchema), `/runs${query(filter)}`),
    run: (id: number): Promise<Run> => json(runSchema, `/runs/${id}`),
    runCandidates: (id: number, status: Candidate["status"] | "all" = "rejected"): Promise<Candidate[]> =>
      json(z.array(candidateSchema), `/runs/${id}/candidates${query({ status })}`),

    providers: (): Promise<ProviderStatus> => json(providerStatusSchema, "/providers"),
    /** How much the translation API was used this month, and whether it has a key. */
    translation: (): Promise<TranslationStatus> => json(translationStatusSchema, "/translation"),
  };
}

export type Api = ReturnType<typeof createApi>;
