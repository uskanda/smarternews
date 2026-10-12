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
/** How often a subscribed feed is fetched, in minutes: five minutes to one day. */
const intervalMinutesSchema = z.number().int().min(5, "must be between 5 and 1440 minutes").max(1440, "must be between 5 and 1440 minutes");

export const searchLocaleSchema = z.object({ language: languageSchema, region: regionSchema });
export type SearchLocale = z.infer<typeof searchLocaleSchema>;

// ---- settings ----------------------------------------------------------------------------------

export const settingsSchema = z.object({
  readerInfo: z.string().max(4000),
  outputLanguage: languageSchema,
  timeZone: z.string().min(1),
  search: searchLocaleSchema,
  /** The base fetch interval of subscribed feeds. */
  feedIntervalMinutes: intervalMinutesSchema,
  /** Whether a reader opens the next list with unread articles after marking a list as read. */
  advanceAfterMarkAll: z.boolean(),
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

/** Where an article comes from: written by the model from candidates, or delivered by a subscribed feed. */
export const originSchema = z.enum(["generated", "feed"]);
export type Origin = z.infer<typeof originSchema>;

export const autoSummarySourceSchema = z.enum(["page", "feed"]);
export type AutoSummarySource = z.infer<typeof autoSummarySourceSchema>;

export const translationMethodSchema = z.enum(["google", "llm"]);
export type TranslationMethod = z.infer<typeof translationMethodSchema>;

/** The content of a feed article in the output language, as pairs of translation and original. */
export const articleTranslationSchema = z.object({
  /** Null only between a rewrite of the title by the feed and its next translation. */
  translatedTitle: z.string().nullable(),
  /** The language of the original as the translation API found it. Null when a model translated. */
  sourceLanguage: z.string().nullable(),
  segments: z.array(
    z.object({
      /** Markdown, as in the content. */
      original: z.string(),
      /** Markdown. Null for a segment shown as it is: code, images, and what lies past the translated length. */
      translated: z.string().nullable(),
      originalHtml: z.string(),
      translatedHtml: z.string().nullable(),
    }),
  ),
  method: translationMethodSchema,
  /** True when the end of the content was left untranslated because of its length. */
  truncated: z.boolean(),
  createdAt: z.string(),
});
export type ArticleTranslation = z.infer<typeof articleTranslationSchema>;

export const articleSummarySchema = z.object({
  id: z.number().int(),
  /** Null for an article of a feed that belongs to no category. */
  categoryId: z.number().int().nullable(),
  origin: originSchema,
  feedId: z.number().int().nullable(),
  author: z.string().nullable(),
  kind: kindSchema,
  title: z.string(),
  /** The title of a feed article in the output language. Null when there is no translation. */
  translatedTitle: z.string().nullable(),
  summary: z.string(),
  impact: z.string().nullable(),
  /** Null for a feed article. */
  importance: importanceSchema.nullable(),
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
  /** The summary a model wrote of a feed article. Null when there is none, and for a generated article. */
  autoSummary: z
    .object({
      text: z.string(),
      /** Written from the article's page, or only from what the feed delivered because the page could not be read. */
      source: autoSummarySourceSchema,
      createdAt: z.string(),
    })
    .nullable(),
  /** True while a feed article waits for its summary. */
  autoSummaryPending: z.boolean(),
  /** True for an article of a feed that translates. Only such an article can be translated. */
  translatable: z.boolean(),
  /** The language of the original as the translation API found it. Null when it is not known. */
  sourceLanguage: z.string().nullable(),
  /** The stored translation of the content. Null until the article is translated. */
  translation: articleTranslationSchema.nullable(),
  snippetOnly: z.boolean(),
  previousArticleId: z.number().int().nullable(),
  refs: z.array(articleRefSchema),
  topics: z.array(z.object({ id: z.number().int(), text: z.string() })),
});
export type Article = z.infer<typeof articleSchema>;

export const articleListQuerySchema = z.object({
  category: z.coerce.number().int().optional(),
  /** Only articles of feeds without a category. */
  uncategorized: z.enum(["true"]).optional(),
  origin: originSchema.optional(),
  feed: z.coerce.number().int().optional(),
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
  uncategorized: z.literal(true).optional(),
  origin: originSchema.optional(),
  feedId: z.number().int().optional(),
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
  generatedUnread: z.number().int(),
  uncategorizedUnread: z.number().int(),
  categories: z.array(
    z.object({
      categoryId: z.number().int(),
      unread: z.number().int(),
      total: z.number().int(),
      generatedUnread: z.number().int(),
      /** Generated articles of the category, read or not: what goes when the category is deleted. */
      generatedTotal: z.number().int(),
    }),
  ),
  feeds: z.array(z.object({ feedId: z.number().int(), unread: z.number().int() })),
});
export type Counts = z.infer<typeof countsSchema>;

// ---- subscribed feeds --------------------------------------------------------------------------

const feedUrlSchema = z.url({ protocol: /^https?$/ }).max(2000);
const feedTitleSchema = z.string().trim().min(1).max(200);

export const feedSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  title: z.string(),
  siteUrl: z.string().nullable(),
  categoryId: z.number().int().nullable(),
  /** Null means the base interval of the settings. */
  intervalMinutes: z.number().int().nullable(),
  enabled: z.boolean(),
  /** Whether the articles this feed delivers from now on are summarised by a model. */
  autoSummarize: z.boolean(),
  /** Whether the titles and contents of this feed's articles are translated into the output language. */
  translate: z.boolean(),
  lastFetchedAt: z.string().nullable(),
  lastSucceededAt: z.string().nullable(),
  lastError: z.string().nullable(),
  failureCount: z.number().int(),
  /** When the feed is fetched next. Null while it is disabled. */
  nextFetchAt: z.string().nullable(),
  articleCount: z.number().int(),
  starredCount: z.number().int(),
  createdAt: z.string(),
});
export type Feed = z.infer<typeof feedSchema>;

export const feedCreateSchema = z.object({
  url: feedUrlSchema,
  title: feedTitleSchema.optional(),
  categoryId: z.number().int().nullable().optional(),
  intervalMinutes: intervalMinutesSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  autoSummarize: z.boolean().optional(),
  translate: z.boolean().optional(),
});
export type FeedCreate = z.infer<typeof feedCreateSchema>;

export const feedUpdateSchema = feedCreateSchema.omit({ url: true });
export type FeedUpdate = z.infer<typeof feedUpdateSchema>;

/** Where a category goes: before another one, or last. */
export const categoryMoveSchema = z.object({ before: z.number().int().nullable() });
export type CategoryMove = z.infer<typeof categoryMoveSchema>;

/** Where a feed goes: into a category or none, before another feed there, or last. */
export const feedMoveSchema = z.object({ categoryId: z.number().int().nullable(), before: z.number().int().nullable() });
export type FeedMove = z.infer<typeof feedMoveSchema>;

export const feedDiscoverSchema = z.object({ url: feedUrlSchema });
export const feedDiscoveryResultSchema = z.object({ feeds: z.array(z.object({ url: z.string(), title: z.string() })) });
export type FeedDiscoveryResult = z.infer<typeof feedDiscoveryResultSchema>;

/** What one fetch of a feed did, and the feed as it is afterwards. */
export const feedFetchResultSchema = z.object({
  status: z.enum(["updated", "not_modified", "failed"]),
  created: z.number().int(),
  error: z.string().optional(),
  feed: feedSchema,
});
export type FeedFetchResult = z.infer<typeof feedFetchResultSchema>;

export const opmlImportResultSchema = z.object({
  feedsCreated: z.number().int(),
  feedsSkipped: z.number().int(),
  categoriesCreated: z.number().int(),
});
export type OpmlImportResult = z.infer<typeof opmlImportResultSchema>;

// ---- stop words --------------------------------------------------------------------------------

export const stopWordScopeSchema = z.enum(["title", "title_and_content"]);
export type StopWordScope = z.infer<typeof stopWordScopeSchema>;

const stopWordTextSchema = z.string().trim().min(1).max(100);

export const stopWordSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  scope: stopWordScopeSchema,
  /** Feed articles this word hides now. An article that matches several words counts for the oldest one. */
  hiddenCount: z.number().int(),
  createdAt: z.string(),
});
export type StopWord = z.infer<typeof stopWordSchema>;

export const stopWordCreateSchema = z.object({ text: stopWordTextSchema, scope: stopWordScopeSchema.optional() });
export type StopWordCreate = z.infer<typeof stopWordCreateSchema>;

export const stopWordUpdateSchema = z.object({ scope: stopWordScopeSchema });
export type StopWordUpdate = z.infer<typeof stopWordUpdateSchema>;

export const stopWordDeleteResultSchema = z.object({ restored: z.number().int() });
export type StopWordDeleteResult = z.infer<typeof stopWordDeleteResultSchema>;

// ---- runs --------------------------------------------------------------------------------------

export const runStatusSchema = z.enum(["queued", "running", "succeeded", "partial", "failed", "stopped_by_limit"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runFailureSchema = z.object({
  stage: z.string(),
  target: z.string().nullable(),
  message: z.string(),
});
export type RunFailure = z.infer<typeof runFailureSchema>;

/** Why a failed run is not retried: the retries are used up, a later scheduled run came first, the category
 * is disabled or has no enabled topic, or the run was started by hand. */
export const retrySkippedSchema = z.enum(["limit", "superseded", "disabled", "manual"]);
export type RetrySkipped = z.infer<typeof retrySkippedSchema>;

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
  /** Which retry this run is. 0 for a run that is not a retry. */
  attempt: z.number().int(),
  /** The scheduled run this one retries. Null for a run that is not a retry, and once that run was deleted. */
  retryOf: z.number().int().nullable(),
  /** When the retry of this failed run is due. Null when none is planned, and once the retry was queued. */
  retryAt: z.string().nullable(),
  retrySkipped: retrySkippedSchema.nullable(),
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

export const taskNameSchema = z.enum(["interpret", "search", "judge", "cluster", "write", "summarize", "translate"]);
export type TaskName = z.infer<typeof taskNameSchema>;

export const providerStatusSchema = z.object({
  providers: z.array(
    z.object({ name: z.string(), adapter: z.string(), model: z.string(), webSearch: z.boolean() }),
  ),
  tasks: z.record(taskNameSchema, z.string()),
  /** Calls made today for runs. Summaries of feed articles are counted apart. */
  llmCallsToday: z.number().int(),
  summariesToday: z.number().int(),
  limits: z.object({ llmCallsPerRun: z.number().int(), llmCallsPerDay: z.number().int(), summariesPerDay: z.number().int() }),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

// ---- translation -------------------------------------------------------------------------------

/** How much the translation API was used this month. Holds no key. */
export const translationStatusSchema = z.object({
  /** The current month in the configured time zone, as YYYY-MM. */
  month: z.string(),
  /** Characters sent to the translation API in that month. */
  chars: z.number().int(),
  monthlyChars: z.number().int(),
  /** False when no key is set: a model translates then, and only what is opened. */
  apiKeyConfigured: z.boolean(),
});
export type TranslationStatus = z.infer<typeof translationStatusSchema>;

// ---- settings file -----------------------------------------------------------------------------

const settingsFileTopicSchema = z.object({
  text: topicText,
  enabled: z.boolean().optional(),
  sources: topicSourcesSchema.partial().optional(),
  search: searchLocaleSchema.optional(),
  interpretation: z.object({ queries: queriesSchema, criteria: z.string().max(4000) }).optional(),
});

const settingsFileSubscriptionSchema = z.object({
  url: feedUrlSchema,
  title: feedTitleSchema.optional(),
  intervalMinutes: intervalMinutesSchema.optional(),
  enabled: z.boolean().optional(),
  /** Left out, a new feed has no summaries and a known one keeps what it has. */
  autoSummarize: z.boolean().optional(),
  /** Left out, a new feed is not translated and a known one keeps what it has. */
  translate: z.boolean().optional(),
});
export type SettingsFileSubscription = z.infer<typeof settingsFileSubscriptionSchema>;

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
  subscriptions: z.array(settingsFileSubscriptionSchema).default([]),
});

export const settingsFileSchema = z.object({
  version: z.literal(1),
  settings: settingsSchema.partial().optional(),
  categories: z.array(settingsFileCategorySchema).default([]),
  /** Subscribed feeds that belong to no category. */
  subscriptions: z.array(settingsFileSubscriptionSchema).default([]),
  stopWords: z.array(z.object({ text: stopWordTextSchema, scope: stopWordScopeSchema.optional() })).default([]),
});
export type SettingsFile = z.infer<typeof settingsFileSchema>;
/** The file as it is written: lists that are empty may be left out. */
export type SettingsFileInput = z.input<typeof settingsFileSchema>;

export const importResultSchema = z.object({
  categoriesCreated: z.number().int(),
  categoriesUpdated: z.number().int(),
  topicsCreated: z.number().int(),
  topicsUpdated: z.number().int(),
  feedsCreated: z.number().int(),
  feedsUpdated: z.number().int(),
  stopWordsCreated: z.number().int(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

// ---- errors ------------------------------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(["unauthorized", "invalid_input", "not_found", "conflict", "unavailable", "internal"]),
    message: z.string(),
    fields: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
