// The only code in the web app and the Android app that talks to the server. Every answer is checked against
// the shared schema, so a drift between an app and the API fails here and not somewhere in a component.
import {
  articleListSchema,
  articleSchema,
  candidateSchema,
  categorySchema,
  countsSchema,
  feedDiscoveryResultSchema,
  feedFetchResultSchema,
  feedSchema,
  importResultSchema,
  markReadResultSchema,
  opmlImportResultSchema,
  providerStatusSchema,
  runSchema,
  settingsSchema,
  stopWordDeleteResultSchema,
  stopWordSchema,
  topicSchema,
  type Article,
  type ArticleList,
  type ArticleListQuery,
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
  type FeedUpdate,
  type ImportResult,
  type MarkRead,
  type MarkReadResult,
  type OpmlImportResult,
  type ProviderStatus,
  type Run,
  type Settings,
  type SettingsUpdate,
  type StopWord,
  type StopWordCreate,
  type StopWordDeleteResult,
  type StopWordUpdate,
  type Topic,
  type TopicCreate,
  type TopicUpdate,
} from "@smarternews/core/api";
import { z } from "zod";

export type ApiErrorKind = "unauthorized" | "invalid" | "not_found" | "conflict" | "network" | "server";

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
    deleteCategory: async (id: number): Promise<void> => void (await request(`/categories/${id}`, { method: "DELETE" })),

    topics: (categoryId: number): Promise<Topic[]> => json(z.array(topicSchema), `/categories/${categoryId}/topics`),
    createTopic: (categoryId: number, input: TopicCreate): Promise<Topic> =>
      json(topicSchema, `/categories/${categoryId}/topics`, body("POST", input)),
    updateTopic: (id: number, patch: TopicUpdate): Promise<Topic> => json(topicSchema, `/topics/${id}`, body("PATCH", patch)),
    deleteTopic: async (id: number): Promise<void> => void (await request(`/topics/${id}`, { method: "DELETE" })),

    articles: (filter: ArticleListQuery = {}): Promise<ArticleList> =>
      json(articleListSchema, `/articles${query(filter as Record<string, string | number | undefined>)}`),
    article: (id: number): Promise<Article> => json(articleSchema, `/articles/${id}`),
    updateArticle: (id: number, patch: ArticleUpdate): Promise<Article> =>
      json(articleSchema, `/articles/${id}`, body("PATCH", patch)),
    markRead: (input: MarkRead): Promise<MarkReadResult> => json(markReadResultSchema, "/articles/mark-read", body("POST", input)),
    markUnread: (ids: number[]): Promise<{ updated: number }> =>
      json(z.object({ updated: z.number() }), "/articles/mark-unread", body("POST", { ids })),
    counts: (): Promise<Counts> => json(countsSchema, "/counts"),

    feeds: (): Promise<Feed[]> => json(z.array(feedSchema), "/feeds"),
    /** Subscribes to a feed. The server fetches the URL first, so this takes as long as that site does. */
    createFeed: (input: FeedCreate): Promise<Feed> => json(feedSchema, "/feeds", body("POST", input)),
    discoverFeeds: (url: string): Promise<FeedDiscoveryResult> => json(feedDiscoveryResultSchema, "/feeds/discover", body("POST", { url })),
    updateFeed: (id: number, patch: FeedUpdate): Promise<Feed> => json(feedSchema, `/feeds/${id}`, body("PATCH", patch)),
    deleteFeed: async (id: number): Promise<void> => void (await request(`/feeds/${id}`, { method: "DELETE" })),
    fetchFeed: (id: number): Promise<FeedFetchResult> => json(feedFetchResultSchema, `/feeds/${id}/fetch`, { method: "POST" }),
    exportOpml: async (): Promise<string> => (await request("/feeds/opml")).text(),
    importOpml: (text: string): Promise<OpmlImportResult> =>
      json(opmlImportResultSchema, "/feeds/opml", { method: "POST", headers: { "content-type": "text/x-opml" }, body: text }),

    stopWords: (): Promise<StopWord[]> => json(z.array(stopWordSchema), "/stop-words"),
    createStopWord: (input: StopWordCreate): Promise<StopWord> => json(stopWordSchema, "/stop-words", body("POST", input)),
    updateStopWord: (id: number, patch: StopWordUpdate): Promise<StopWord> => json(stopWordSchema, `/stop-words/${id}`, body("PATCH", patch)),
    deleteStopWord: (id: number): Promise<StopWordDeleteResult> => json(stopWordDeleteResultSchema, `/stop-words/${id}`, { method: "DELETE" }),

    runCategory: (categoryId: number): Promise<Run> => json(runSchema, `/categories/${categoryId}/runs`, { method: "POST" }),
    runs: (filter: { category?: number; limit?: number } = {}): Promise<Run[]> => json(z.array(runSchema), `/runs${query(filter)}`),
    run: (id: number): Promise<Run> => json(runSchema, `/runs/${id}`),
    runCandidates: (id: number, status: Candidate["status"] | "all" = "rejected"): Promise<Candidate[]> =>
      json(z.array(candidateSchema), `/runs/${id}/candidates${query({ status })}`),

    providers: (): Promise<ProviderStatus> => json(providerStatusSchema, "/providers"),
  };
}

export type Api = ReturnType<typeof createApi>;
