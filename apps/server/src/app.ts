import { createHash, timingSafeEqual } from "node:crypto";
import {
  articleListQuerySchema,
  articleUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  createCategory,
  createTopic,
  deleteCategory,
  deleteTopic,
  DomainError,
  exportSettings,
  findCategoryBySlug,
  getArticle,
  getCategory,
  getCounts,
  getRun,
  getSettings,
  getTopic,
  importSettings,
  listArticles,
  listCategories,
  listFeedArticles,
  listRunCandidates,
  listRuns,
  listTopics,
  markArticlesRead,
  markArticlesUnread,
  markReadSchema,
  markUnreadSchema,
  notFound,
  renderRss,
  requestInterpretation,
  setArticleFlags,
  settingsUpdateSchema,
  topicCreateSchema,
  topicUpdateSchema,
  updateCategory,
  updateSettings,
  updateTopic,
  zodFieldErrors,
  type ApiError,
  type Candidate,
  type Clock,
  type Database,
  type ProviderStatus,
  type RunQueue,
  type TaskRunner,
} from "@smarternews/core";
import { Hono, type Context } from "hono";
import type { z } from "zod";
import { serveWeb } from "./web.ts";

export interface AppDeps {
  db: Database;
  clock: Clock;
  queue: RunQueue;
  runner: TaskRunner;
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
function idParam(c: Context, what: string): number {
  const raw = c.req.param("id") ?? "";
  if (!/^\d{1,15}$/.test(raw)) throw notFound(what, raw);
  return Number(raw);
}

export function createApp(deps: AppDeps): Hono {
  const { db, clock, queue, runner } = deps;
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof DomainError) {
      const [status, code] =
        error.code === "invalid" ? ([400, "invalid_input"] as const) : error.code === "not_found" ? ([404, "not_found"] as const) : ([409, "conflict"] as const);
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
    const ids = markArticlesRead(db, parse(markReadSchema, await jsonBody(c)));
    return c.json({ updated: ids.length, ids });
  });
  api.post("/articles/mark-unread", async (c) =>
    c.json({ updated: markArticlesUnread(db, parse(markUnreadSchema, await jsonBody(c)).ids) }),
  );
  api.get("/counts", (c) => c.json(getCounts(db, clock().toISOString())));
  api.get("/articles/:id", (c) => c.json(getArticle(db, idParam(c, "article"))));
  api.patch("/articles/:id", async (c) =>
    c.json(setArticleFlags(db, idParam(c, "article"), parse(articleUpdateSchema, await jsonBody(c)))),
  );

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
    const status: ProviderStatus = { ...runner.describe(), llmCallsToday: runner.callsToday(), limits: runner.limits };
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
