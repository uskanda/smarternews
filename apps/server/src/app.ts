import { createHash, timingSafeEqual } from "node:crypto";
import {
  addHighlight,
  annotationListQuerySchema,
  articleNoteUpdateSchema,
  deleteArticleNote,
  deleteHighlight,
  highlightCreateSchema,
  highlightUpdateSchema,
  listAnnotations,
  saveArticleNote,
  updateHighlightNote,
  articleListQuerySchema,
  articleSearchQuerySchema,
  listMentionArticles,
  mentionArticlesQuerySchema,
  articleUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  createCategory,
  createTopic,
  deleteCategory,
  deleteFeed,
  deleteFilter,
  deleteTopic,
  discoverFeeds,
  DomainError,
  createFilter,
  exportOpml,
  exportSettings,
  feedCreateSchema,
  feedDiscoverSchema,
  feedUpdateSchema,
  feedStats,
  findCategoryBySlug,
  getArticle,
  ImageFetchError,
  verifyImageProxyPath,
  relayArticleImages,
  relayFullContent,
  relayTranslation,
  getCategory,
  getCounts,
  getFeed,
  getRun,
  getSettings,
  getTopic,
  importOpml,
  importSettings,
  listArticles,
  listCategories,
  listFeedArticles,
  listFeeds,
  listListViews,
  listViewUpdateSchema,
  listRunCandidates,
  listFilters,
  listFilterArticles,
  listRuns,
  listTopics,
  markArticlesRead,
  moveCategory,
  moveFeed,
  categoryMoveSchema,
  feedMoveSchema,
  pageCandidatesRequestSchema,
  pagePreviewRequestSchema,
  previewSelectors,
  proposeSelectors,
  markArticlesUnread,
  markReadBodySchema,
  markSeenArticlesRead,
  markUnreadSchema,
  notFound,
  renderRss,
  requestAutoSummary,
  requestInterpretation,
  searchArticles,
  setArticleFlags,
  settingsUpdateSchema,
  filterArticlesQuerySchema,
  filterCreateSchema,
  filterPreviewSchema,
  filterUpdateSchema,
  previewFilter,
  recordArticleOpened,
  addHighlightTerm,
  createTermGroup,
  deleteHighlightTerm,
  deleteTermGroup,
  highlightTermCreateSchema,
  listTermGroups,
  moveTermGroup,
  termGroupCreateSchema,
  termGroupMoveSchema,
  termGroupUpdateSchema,
  updateTermGroup,
  subscribe,
  topicCreateSchema,
  topicUpdateSchema,
  updateCategory,
  updateFeed,
  updateSettings,
  updateFilter,
  updateListView,
  updateTopic,
  zodFieldErrors,
  type ApiError,
  type Candidate,
  type Clock,
  type Database,
  type FeedFetchResult,
  type FeedPoller,
  type Fetcher,
  type FullContentWorker,
  type ImageProxy,
  type ProviderStatus,
  type RunQueue,
  type SummaryWorker,
  type TaskRunner,
  type TranslationService,
} from "@smarternews/core";
import { Hono, type Context } from "hono";
import type { z } from "zod";
import { serveWeb } from "./web.ts";

export interface AppDeps {
  db: Database;
  clock: Clock;
  queue: RunQueue;
  runner: TaskRunner;
  /** Talks to other sites when a feed is subscribed or looked for. */
  fetcher: Fetcher;
  poller: FeedPoller;
  /** Translates the articles of the feeds that ask for it. */
  translation: TranslationService;
  /** Writes the summaries of feed articles. Woken when a reader opens an article that waits for one. */
  summarizer: SummaryWorker;
  /** Fetches the full content of feed articles, one at a time; an article a reader asks for goes first. */
  fullContent: FullContentWorker;
  /** The relay of images: the key that signs their URLs, and what fetches and keeps them. */
  images: { key: Uint8Array; proxy: ImageProxy };
  tokens: { api: string; feed: string };
  version: string;
  /** Directory of the built web app. The page is served from it when it holds an index.html. */
  webDir?: string;
}

const FEED_SIZE = 50;

function sameToken(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function errorBody(code: ApiError["error"]["code"], message: string, fields?: ApiError["error"]["fields"]): ApiError {
  return { error: { code, message, ...(fields && fields.length > 0 ? { fields } : {}) } };
}

/** Validates input against a schema, turning a mismatch into a 400 that names each field. */
function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError("invalid", "the input is invalid", zodFieldErrors(result.error));
  return result.data;
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new DomainError("invalid", "the request body is not JSON");
  }
}

/** A numeric identifier from the path. Anything else cannot name an existing object. */
function idParam(c: Context, what: string, name = "id"): number {
  const raw = c.req.param(name) ?? "";
  if (!/^\d{1,15}$/.test(raw)) throw notFound(what, raw);
  return Number(raw);
}

/** What every answer of the image relay carries: a body that is never taken for anything but what it says. */
const RELAY_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };

export function createApp(deps: AppDeps): Hono {
  const { db, clock, queue, runner, fetcher, poller, translation, summarizer, fullContent, images } = deps;
  /** An article as it is answered: the images of a feed article's content load through the relay. */
  const answered = (article: ReturnType<typeof getArticle>) => relayArticleImages(article, images.key);
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof DomainError) {
      const [status, code] = (
        {
          invalid: [400, "invalid_input"],
          not_found: [404, "not_found"],
          conflict: [409, "conflict"],
          // Nothing is wrong with the request: what it needs cannot be had now, and may be had later.
          unavailable: [503, "unavailable"],
        } as const
      )[error.code];
      return c.json(errorBody(code, error.message, error.fields), status);
    }
    console.error(error);
    return c.json(errorBody("internal", "internal error"), 500);
  });
  app.notFound((c) => c.json(errorBody("not_found", "no such path"), 404));

  // ---- RSS: read-only, with its own token in the URL --------------------------------------------

  app.get("/rss/:file", (c) => {
    if (!sameToken(c.req.query("token"), deps.tokens.feed)) return c.text("unauthorized\n", 401);
    const file = c.req.param("file");
    if (!file.endsWith(".xml")) throw notFound("feed", file);
    const slug = file.slice(0, -".xml".length);
    const category = slug === "all" ? null : findCategoryBySlug(db, slug);
    if (slug !== "all" && !category) throw notFound("feed", slug);
    const settings = getSettings(db);
    const xml = renderRss({
      title: category ? category.name : "smarternews",
      link: `${new URL(c.req.url).origin}/`,
      description: category ? `Articles of the category ${category.name}` : "Articles of every category",
      language: settings.outputLanguage,
      timeZone: settings.timeZone,
      articles: listFeedArticles(db, { categoryId: category?.id ?? null, now: clock().toISOString(), limit: FEED_SIZE }),
      categoryNames: new Map(listCategories(db).map((entry) => [entry.id, entry.name])),
    });
    return c.body(xml, 200, { "content-type": "application/rss+xml; charset=utf-8" });
  });

  // ---- API ---------------------------------------------------------------------------------------

  const api = new Hono();

  api.get("/health", (c) => c.json({ status: "ok", version: deps.version }));

  // An image element sends no token, so the signature of the URL stands in for it. A path that is not exactly
  // a signature and an address is refused like a wrong signature.
  api.get("/image-proxy/*", async (c) => {
    const parts = new URL(c.req.url).pathname.split("/").slice(4);
    const url = parts.length === 2 ? verifyImageProxyPath(images.key, parts[0]!, parts[1]!) : null;
    if (url === null) return c.text("invalid image signature\n", 403, RELAY_HEADERS);
    try {
      const image = await images.proxy.get(url);
      return c.body(image.bytes as Uint8Array<ArrayBuffer>, 200, {
        ...RELAY_HEADERS,
        "content-type": image.type,
        "cache-control": `private, max-age=${Math.floor(images.proxy.maxAgeMs / 1000)}`,
      });
    } catch (error) {
      if (error instanceof ImageFetchError) return c.text("the image could not be fetched\n", 502, RELAY_HEADERS);
      throw error;
    }
  });

  api.use("*", async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!sameToken(token, deps.tokens.api)) return c.json(errorBody("unauthorized", "a valid API token is required"), 401);
    return next();
  });

  // settings
  api.get("/settings", (c) => c.json(getSettings(db)));
  api.patch("/settings", async (c) => c.json(updateSettings(db, parse(settingsUpdateSchema, await jsonBody(c)))));
  api.get("/settings/export", (c) => c.body(exportSettings(db), 200, { "content-type": "application/yaml; charset=utf-8" }));
  api.post("/settings/import", async (c) => c.json(importSettings(db, await c.req.text(), clock)));

  // categories
  api.get("/categories", (c) => c.json(listCategories(db)));
  api.post("/categories", async (c) => c.json(createCategory(db, parse(categoryCreateSchema, await jsonBody(c)), clock), 201));
  api.get("/categories/:id", (c) => c.json(getCategory(db, idParam(c, "category"))));
  api.patch("/categories/:id", async (c) =>
    c.json(updateCategory(db, idParam(c, "category"), parse(categoryUpdateSchema, await jsonBody(c)))),
  );
  api.post("/categories/:id/move", async (c) =>
    c.json(moveCategory(db, idParam(c, "category"), parse(categoryMoveSchema, await jsonBody(c)).before)),
  );
  api.delete("/categories/:id", (c) => {
    deleteCategory(db, idParam(c, "category"));
    return c.body(null, 204);
  });

  // topics
  api.get("/categories/:id/topics", (c) => {
    const category = getCategory(db, idParam(c, "category"));
    return c.json(listTopics(db, category.id));
  });
  api.post("/categories/:id/topics", async (c) =>
    c.json(createTopic(db, idParam(c, "category"), parse(topicCreateSchema, await jsonBody(c)), clock), 201),
  );
  api.get("/topics/:id", (c) => c.json(getTopic(db, idParam(c, "topic"))));
  api.patch("/topics/:id", async (c) => c.json(updateTopic(db, idParam(c, "topic"), parse(topicUpdateSchema, await jsonBody(c)))));
  api.delete("/topics/:id", (c) => {
    deleteTopic(db, idParam(c, "topic"));
    return c.body(null, 204);
  });
  api.post("/topics/:id/interpret", (c) => c.json(requestInterpretation(db, idParam(c, "topic"))));

  // articles
  api.get("/articles", (c) => c.json(listArticles(db, parse(articleListQuerySchema, c.req.query()), clock().toISOString())));
  api.post("/articles/mark-read", async (c) => {
    const input = parse(markReadBodySchema, await jsonBody(c));
    const now = clock().toISOString();
    const ids = "articles" in input && input.articles ? markSeenArticlesRead(db, input.articles, now) : markArticlesRead(db, input, now);
    return c.json({ updated: ids.length, ids });
  });
  api.post("/articles/mark-unread", async (c) =>
    c.json({ updated: markArticlesUnread(db, parse(markUnreadSchema, await jsonBody(c)).ids) }),
  );
  // Plain matching against the search index: no model and no translation is involved.
  api.get("/search", (c) => c.json(searchArticles(db, parse(articleSearchQuerySchema, c.req.query()), clock().toISOString())));
  // The articles of a name found in them: plain matching of stored names, no model and no translation.
  api.get("/mentions/articles", (c) => c.json(listMentionArticles(db, parse(mentionArticlesQuerySchema, c.req.query()), clock().toISOString())));
  api.get("/counts", (c) => c.json(getCounts(db, clock().toISOString())));
  api.get("/articles/:id", (c) => c.json(answered(getArticle(db, idParam(c, "article")))));
  api.patch("/articles/:id", async (c) =>
    c.json(answered(setArticleFlags(db, idParam(c, "article"), parse(articleUpdateSchema, await jsonBody(c)), clock().toISOString()))),
  );
  // Sent by a screen that shows the article's body; marking read is a separate request.
  api.post("/articles/:id/open", (c) => c.json({ openedAt: recordArticleOpened(db, idParam(c, "article"), clock().toISOString()) }));
  // Translates the content when it has no translation yet, so the answer can take as long as that does.
  api.post("/articles/:id/summary", (c) => {
    if (!requestAutoSummary(db, idParam(c, "article"), clock().toISOString())) return c.json({ status: "none" });
    if (!runner.canSummarize()) return c.json({ status: "limit" });
    // The reader is looking at the article now: the summary does not wait for the next look.
    summarizer.tick();
    return c.json({ status: "queued" });
  });
  api.post("/articles/:id/translation", async (c) => c.json(relayTranslation(await translation.translateArticle(idParam(c, "article")), images.key)));
  // Answers once the page is fetched: no model is waited for, only the site and the interval per host.
  api.post("/articles/:id/full-content", async (c) => {
    const result = await fullContent.fetchFor(idParam(c, "article"));
    return c.json(result.status === "fetched" ? { ...result, fullContent: relayFullContent(result.fullContent, images.key) } : result);
  });
  api.get("/translation", (c) => c.json(translation.status()));

  // annotations: plain storage, no model and no translation is involved
  api.get("/annotations", (c) => c.json(listAnnotations(db, parse(annotationListQuerySchema, c.req.query()))));
  api.post("/articles/:id/highlights", async (c) => {
    const id = idParam(c, "article");
    return c.json(addHighlight(db, id, parse(highlightCreateSchema, await jsonBody(c)), clock().toISOString()), 201);
  });
  api.patch("/highlights/:id", async (c) => {
    const id = idParam(c, "highlight");
    return c.json(updateHighlightNote(db, id, parse(highlightUpdateSchema, await jsonBody(c)).note, clock().toISOString()));
  });
  api.delete("/highlights/:id", (c) => {
    deleteHighlight(db, idParam(c, "highlight"));
    return c.body(null, 204);
  });
  api.put("/articles/:id/note", async (c) => {
    const id = idParam(c, "article");
    return c.json(saveArticleNote(db, id, parse(articleNoteUpdateSchema, await jsonBody(c)).text, clock().toISOString()));
  });
  api.delete("/articles/:id/note", (c) => {
    deleteArticleNote(db, idParam(c, "article"));
    return c.body(null, 204);
  });

  // subscribed feeds
  api.get("/feeds", (c) => c.json(listFeeds(db, clock())));
  // Registering fetches the URL once, so the answer can take as long as that site does.
  api.post("/feeds", async (c) => {
    const input = parse(feedCreateSchema, await jsonBody(c));
    return c.json(await poller.exclusive(() => subscribe({ db, clock, fetcher, translation, pages: poller.pageFetcher() }, input)), 201);
  });
  // Candidates for the selectors of a page without a feed. The one place a web feed calls a model, and only when
  // the day has room; otherwise the server's own guess. Waits for the model, up to its time limit. Stores nothing.
  api.post("/feeds/page/candidates", async (c) => {
    const { url } = parse(pageCandidatesRequestSchema, await jsonBody(c));
    return c.json(await proposeSelectors({ db, runner, pages: poller.pageFetcher() }, url));
  });
  // What a set of selectors takes out of a page. No model is called and nothing is stored.
  api.post("/feeds/page/preview", async (c) => {
    const { url, selectors } = parse(pagePreviewRequestSchema, await jsonBody(c));
    return c.json(await previewSelectors({ db, pages: poller.pageFetcher() }, url, selectors));
  });
  api.post("/feeds/discover", async (c) => c.json({ feeds: await discoverFeeds(fetcher, parse(feedDiscoverSchema, await jsonBody(c)).url) }));
  api.get("/feeds/opml", (c) => c.body(exportOpml(db), 200, { "content-type": "text/x-opml; charset=utf-8" }));
  api.post("/feeds/opml", async (c) => c.json(importOpml(db, await c.req.text(), clock)));
  api.get("/feeds/:id", (c) => c.json(getFeed(db, idParam(c, "feed"), clock())));
  // Counted from what the articles are now: no model is involved.
  api.get("/feeds/:id/stats", (c) => c.json(feedStats(db, idParam(c, "feed"), clock())));
  api.patch("/feeds/:id", async (c) => c.json(updateFeed(db, idParam(c, "feed"), parse(feedUpdateSchema, await jsonBody(c)), clock)));
  api.post("/feeds/:id/move", async (c) => {
    moveFeed(db, idParam(c, "feed"), parse(feedMoveSchema, await jsonBody(c)));
    return c.json(listFeeds(db, clock()));
  });
  api.delete("/feeds/:id", (c) => {
    deleteFeed(db, idParam(c, "feed"));
    return c.body(null, 204);
  });
  api.post("/feeds/:id/fetch", async (c) => {
    const id = idParam(c, "feed");
    const outcome = await poller.fetchNow(id);
    const result: FeedFetchResult = { ...outcome, feed: getFeed(db, id, clock()) };
    return c.json(result);
  });

  // filters
  api.get("/filters", (c) => c.json(listFilters(db)));
  api.post("/filters", async (c) => c.json(createFilter(db, parse(filterCreateSchema, await jsonBody(c)), clock), 201));
  // Matches against the stored articles without saving anything. Before `/filters/:id`, which it is not.
  api.post("/filters/preview", async (c) => c.json(previewFilter(db, parse(filterPreviewSchema, await jsonBody(c)))));
  api.patch("/filters/:id", async (c) => c.json(updateFilter(db, idParam(c, "filter"), parse(filterUpdateSchema, await jsonBody(c)))));
  api.delete("/filters/:id", (c) => c.json(deleteFilter(db, idParam(c, "filter"))));
  api.get("/filters/:id/articles", (c) =>
    c.json(listFilterArticles(db, idParam(c, "filter"), parse(filterArticlesQuerySchema, c.req.query()))),
  );

  // list views: how each entry of the left pane and the drawer orders its articles, shared by both apps
  api.get("/list-views", (c) => c.json(listListViews(db)));
  api.patch("/list-views/:key", async (c) =>
    c.json(updateListView(db, c.req.param("key"), parse(listViewUpdateSchema, await jsonBody(c)))),
  );

  // term highlights: only stored and answered here; the apps match the terms against what they show
  api.get("/term-groups", (c) => c.json(listTermGroups(db)));
  api.post("/term-groups", async (c) => c.json(createTermGroup(db, parse(termGroupCreateSchema, await jsonBody(c)), clock), 201));
  api.patch("/term-groups/:id", async (c) => c.json(updateTermGroup(db, idParam(c, "term group"), parse(termGroupUpdateSchema, await jsonBody(c)))));
  api.delete("/term-groups/:id", (c) => {
    deleteTermGroup(db, idParam(c, "term group"));
    return c.body(null, 204);
  });
  api.post("/term-groups/:id/move", async (c) =>
    c.json(moveTermGroup(db, idParam(c, "term group"), parse(termGroupMoveSchema, await jsonBody(c)).before)),
  );
  api.post("/term-groups/:id/terms", async (c) =>
    c.json(addHighlightTerm(db, idParam(c, "term group"), parse(highlightTermCreateSchema, await jsonBody(c)), clock), 201),
  );
  api.delete("/term-groups/:id/terms/:termId", (c) => {
    deleteHighlightTerm(db, idParam(c, "term group"), idParam(c, "term", "termId"));
    return c.body(null, 204);
  });

  // runs
  api.post("/categories/:id/runs", (c) => c.json(queue.enqueue(idParam(c, "category"), "manual", null), 202));
  api.get("/runs", (c) => {
    const category = c.req.query("category");
    const limit = c.req.query("limit");
    return c.json(
      listRuns(db, {
        categoryId: category !== undefined && /^\d+$/.test(category) ? Number(category) : undefined,
        limit: limit !== undefined && /^\d+$/.test(limit) ? Number(limit) : undefined,
      }),
    );
  });
  api.get("/runs/:id", (c) => c.json(getRun(db, idParam(c, "run"))));
  api.get("/runs/:id/candidates", (c) => {
    const run = getRun(db, idParam(c, "run"));
    const status = c.req.query("status") ?? "rejected";
    if (!["rejected", "pending", "accepted", "all"].includes(status)) {
      throw new DomainError("invalid", "the input is invalid", [{ path: "status", message: "must be rejected, pending, accepted or all" }]);
    }
    return c.json(listRunCandidates(db, run.id, status === "all" ? undefined : (status as Candidate["status"])));
  });

  // providers
  api.get("/providers", (c) => {
    const status: ProviderStatus = { ...runner.describe(), llmCallsToday: runner.callsToday(), summariesToday: runner.summariesToday(), limits: runner.limits };
    return c.json(status);
  });

  app.route("/api/v1", api);

  // ---- web app: everything else that is a GET ---------------------------------------------------

  app.get("*", (c) => {
    const { pathname } = new URL(c.req.url);
    const reserved = pathname.startsWith("/api/") || pathname.startsWith("/rss/");
    const response = reserved ? null : serveWeb(deps.webDir, pathname, c.req.header("accept-encoding") ?? "");
    return response ?? c.json(errorBody("not_found", "no such path"), 404);
  });
  return app;
}
