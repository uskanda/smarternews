// Shapes shared by the server, the web app and the mobile app. This module must stay free of Node imports
// so that browser and React Native bundles can load it.
import { z } from "zod";

export const kindSchema = z.enum(["news", "event"]);
export type Kind = z.infer<typeof kindSchema>;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase letters, digits and hyphens")
  .max(64);
const languageSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "must be a language tag such as en or ja");
const regionSchema = z.string().regex(/^[A-Z]{2}$/, "must be a two-letter region such as US or JP");
const importanceSchema = z.number().int().min(1).max(5);

export const searchLocaleSchema = z.object({ language: languageSchema, region: regionSchema });
export type SearchLocale = z.infer<typeof searchLocaleSchema>;

// ---- settings ----------------------------------------------------------------------------------

export const settingsSchema = z.object({
  readerInfo: z.string().max(4000),
  outputLanguage: languageSchema,
  timeZone: z.string().min(1),
  search: searchLocaleSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsUpdateSchema = settingsSchema.partial();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

// ---- categories --------------------------------------------------------------------------------

export const categorySchema = z.object({
  id: z.number().int(),
  slug: slugSchema,
  name: z.string(),
  kind: kindSchema,
  schedule: z.array(timeOfDaySchema),
  minImportance: importanceSchema,
  maxArticlesPerRun: z.number().int(),
  windowHours: z.number().int().nullable(),
  windowDays: z.number().int().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;

const categoryFields = {
  name: z.string().trim().min(1).max(100),
  schedule: z.array(timeOfDaySchema).max(24),
  minImportance: importanceSchema,
  maxArticlesPerRun: z.number().int().min(1).max(50),
  windowHours: z.number().int().min(1).max(720),
  windowDays: z.number().int().min(1).max(90),
  enabled: z.boolean(),
};

export const categoryCreateSchema = z.object({
  name: categoryFields.name,
  slug: slugSchema.optional(),
  // "status" is accepted by the schema so that the server can answer with a specific refusal.
  kind: z.enum(["news", "event", "status"]),
  schedule: categoryFields.schedule.optional(),
  minImportance: categoryFields.minImportance.optional(),
  maxArticlesPerRun: categoryFields.maxArticlesPerRun.optional(),
  windowHours: categoryFields.windowHours.optional(),
  windowDays: categoryFields.windowDays.optional(),
  enabled: categoryFields.enabled.optional(),
});
export type CategoryCreate = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z.object(categoryFields).partial();
export type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;

// ---- topics ------------------------------------------------------------------------------------

export const topicSourcesSchema = z.object({
  feeds: z.array(z.url({ protocol: /^https?$/ })).max(50),
  newsSearch: z.boolean(),
  llmSearch: z.boolean(),
});
export type TopicSources = z.infer<typeof topicSourcesSchema>;

const queriesSchema = z.array(z.string().trim().min(1).max(200)).max(8);

export const topicSchema = z.object({
  id: z.number().int(),
  categoryId: z.number().int(),
  text: z.string(),
  enabled: z.boolean(),
  interpreted: z.boolean(),
  queries: z.array(z.string()),
  criteria: z.string(),
  sources: topicSourcesSchema,
  sourcesSetByUser: z.boolean(),
  search: searchLocaleSchema.nullable(),
  createdAt: z.string(),
});
export type Topic = z.infer<typeof topicSchema>;

const topicText = z.string().trim().min(1).max(2000);

export const topicCreateSchema = z.object({
  text: topicText,
  enabled: z.boolean().optional(),
  sources: topicSourcesSchema.partial().optional(),
  search: searchLocaleSchema.nullable().optional(),
  interpretation: z.object({ queries: queriesSchema, criteria: z.string().max(4000) }).optional(),
});
export type TopicCreate = z.infer<typeof topicCreateSchema>;

export const topicUpdateSchema = z.object({
  text: topicText.optional(),
  enabled: z.boolean().optional(),
  sources: topicSourcesSchema.partial().optional(),
  search: searchLocaleSchema.nullable().optional(),
  queries: queriesSchema.optional(),
});
export type TopicUpdate = z.infer<typeof topicUpdateSchema>;

// ---- articles ----------------------------------------------------------------------------------

export const articleRefSchema = z.object({
  url: z.string(),
  siteName: z.string(),
  title: z.string(),
  publishedAt: z.string().nullable(),
});
export type ArticleRef = z.infer<typeof articleRefSchema>;

export const registrationSchema = z.enum(["required", "not_required", "unknown"]);
export type Registration = z.infer<typeof registrationSchema>;

export const articleEventSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  venue: z.string().nullable(),
  fee: z.string().nullable(),
  registration: registrationSchema,
});
export type ArticleEvent = z.infer<typeof articleEventSchema>;

export const articleSummarySchema = z.object({
  id: z.number().int(),
  categoryId: z.number().int(),
  kind: kindSchema,
  title: z.string(),
  summary: z.string(),
  impact: z.string().nullable(),
  importance: importanceSchema,
  unconfirmed: z.boolean(),
  firstPublishedAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int(),
  isRead: z.boolean(),
  starred: z.boolean(),
  primaryUrl: z.string().nullable(),
  refCount: z.number().int(),
  event: articleEventSchema.nullable(),
});
export type ArticleSummary = z.infer<typeof articleSummarySchema>;

export const articleSchema = articleSummarySchema.extend({
  body: z.string(),
  bodyHtml: z.string(),
  snippetOnly: z.boolean(),
  previousArticleId: z.number().int().nullable(),
  refs: z.array(articleRefSchema),
  topics: z.array(z.object({ id: z.number().int(), text: z.string() })),
});
export type Article = z.infer<typeof articleSchema>;

export const articleListQuerySchema = z.object({
  category: z.coerce.number().int().optional(),
  kind: kindSchema.optional(),
  unread: z.enum(["true", "false"]).optional(),
  starred: z.enum(["true", "false"]).optional(),
  includeEnded: z.enum(["true", "false"]).optional(),
  minImportance: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type ArticleListQuery = z.infer<typeof articleListQuerySchema>;

export const articleListSchema = z.object({
  items: z.array(articleSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ArticleList = z.infer<typeof articleListSchema>;

export const articleUpdateSchema = z.object({ isRead: z.boolean().optional(), starred: z.boolean().optional() });
export type ArticleUpdate = z.infer<typeof articleUpdateSchema>;

export const markReadSchema = z.object({
  categoryId: z.number().int().optional(),
  minImportance: importanceSchema.optional(),
  before: z.iso.datetime({ offset: true }),
});
export type MarkRead = z.infer<typeof markReadSchema>;

export const markReadResultSchema = z.object({ updated: z.number().int(), ids: z.array(z.number().int()) });
export type MarkReadResult = z.infer<typeof markReadResultSchema>;

export const markUnreadSchema = z.object({ ids: z.array(z.number().int()).max(5000) });
export type MarkUnread = z.infer<typeof markUnreadSchema>;

export const countsSchema = z.object({
  unread: z.number().int(),
  starred: z.number().int(),
  categories: z.array(z.object({ categoryId: z.number().int(), unread: z.number().int(), total: z.number().int() })),
});
export type Counts = z.infer<typeof countsSchema>;

// ---- runs --------------------------------------------------------------------------------------

export const runStatusSchema = z.enum(["queued", "running", "succeeded", "partial", "failed", "stopped_by_limit"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runFailureSchema = z.object({
  stage: z.string(),
  target: z.string().nullable(),
  message: z.string(),
});
export type RunFailure = z.infer<typeof runFailureSchema>;

export const runSchema = z.object({
  id: z.number().int(),
  categoryId: z.number().int(),
  trigger: z.enum(["schedule", "manual"]),
  slot: z.string().nullable(),
  status: runStatusSchema,
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  collected: z.number().int(),
  rejected: z.number().int(),
  articlesCreated: z.number().int(),
  articlesUpdated: z.number().int(),
  llmCalls: z.number().int(),
  failures: z.array(runFailureSchema),
});
export type Run = z.infer<typeof runSchema>;

export const sourceKindSchema = z.enum(["feed", "news-search", "llm-search"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const candidateSchema = z.object({
  id: z.number().int(),
  runId: z.number().int().nullable(),
  url: z.string(),
  title: z.string(),
  siteName: z.string(),
  publishedAt: z.string().nullable(),
  sourceKind: sourceKindSchema,
  status: z.enum(["rejected", "pending", "accepted"]),
  reason: z.string(),
  importance: z.number().int().nullable(),
  topics: z.array(z.object({ id: z.number().int(), text: z.string() })),
});
export type Candidate = z.infer<typeof candidateSchema>;

// ---- providers ---------------------------------------------------------------------------------

export const taskNameSchema = z.enum(["interpret", "search", "judge", "cluster", "write"]);
export type TaskName = z.infer<typeof taskNameSchema>;

export const providerStatusSchema = z.object({
  providers: z.array(
    z.object({ name: z.string(), adapter: z.string(), model: z.string(), webSearch: z.boolean() }),
  ),
  tasks: z.record(taskNameSchema, z.string()),
  llmCallsToday: z.number().int(),
  limits: z.object({ llmCallsPerRun: z.number().int(), llmCallsPerDay: z.number().int() }),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

// ---- settings file -----------------------------------------------------------------------------

const settingsFileTopicSchema = z.object({
  text: topicText,
  enabled: z.boolean().optional(),
  sources: topicSourcesSchema.partial().optional(),
  search: searchLocaleSchema.optional(),
  interpretation: z.object({ queries: queriesSchema, criteria: z.string().max(4000) }).optional(),
});

const settingsFileCategorySchema = z.object({
  slug: slugSchema,
  name: categoryFields.name,
  kind: kindSchema,
  schedule: categoryFields.schedule.optional(),
  minImportance: categoryFields.minImportance.optional(),
  maxArticlesPerRun: categoryFields.maxArticlesPerRun.optional(),
  windowHours: categoryFields.windowHours.optional(),
  windowDays: categoryFields.windowDays.optional(),
  enabled: categoryFields.enabled.optional(),
  topics: z.array(settingsFileTopicSchema).default([]),
});

export const settingsFileSchema = z.object({
  version: z.literal(1),
  settings: settingsSchema.partial().optional(),
  categories: z.array(settingsFileCategorySchema).default([]),
});
export type SettingsFile = z.infer<typeof settingsFileSchema>;

export const importResultSchema = z.object({
  categoriesCreated: z.number().int(),
  categoriesUpdated: z.number().int(),
  topicsCreated: z.number().int(),
  topicsUpdated: z.number().int(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

// ---- errors ------------------------------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(["unauthorized", "invalid_input", "not_found", "conflict", "internal"]),
    message: z.string(),
    fields: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
