// Shapes shared by the server, the web app and the mobile app. This module must stay free of Node imports
// so that browser and React Native bundles can load it.
import { z } from "zod";

// Normalizing and matching search terms: the apps mark matches as the server finds them.
export * from "./search/text.ts";

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
  /**
   * Whether a feed article that another feed delivered within seven days is hidden from the lists over
   * everything and over categories, as a duplicate of the one stored first.
   */
  removeDuplicates: z.boolean(),
  /** After how many days without a new item an enabled feed counts as stale. */
  staleFeedDays: z.number().int("must be a whole number of days").min(1, "must be between 1 and 365 days").max(365, "must be between 1 and 365 days"),
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

/**
 * The answer to a reader who asks for the summary of the article they opened: it is on its way, the day has
 * no summaries left, or this article does not get one.
 */
export const summaryRequestResultSchema = z.object({ status: z.enum(["queued", "limit", "none"]) });
export type SummaryRequestResult = z.infer<typeof summaryRequestResultSchema>;
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

/**
 * Why the full content of a feed article could not be had: the article has no page, robots.txt forbids it,
 * the destination is refused, the site answered with an HTTP failure or with something that is not HTML, it
 * did not answer in time, the request failed otherwise, no text could be taken out of the page, or what was
 * taken out was shorter than what the feed delivered. A screen turns the reason into a sentence.
 */
export const fullContentErrorReasonSchema = z.enum(["no-url", "robots", "blocked", "http", "not-html", "timeout", "error", "no-content", "shorter"]);
export type FullContentErrorReason = z.infer<typeof fullContentErrorReasonSchema>;

export const fullContentErrorSchema = z.object({
  reason: fullContentErrorReasonSchema,
  /** The HTTP status for `http`, the media type for `not-html`, the message for `error`; otherwise null. */
  detail: z.string().nullable(),
});
export type FullContentError = z.infer<typeof fullContentErrorSchema>;

/** The text of a feed article's page, rewritten as Markdown by the rules of delivered content. */
export const fullContentSchema = z.object({
  body: z.string(),
  bodyHtml: z.string(),
  fetchedAt: z.string(),
});
export type FullContent = z.infer<typeof fullContentSchema>;

/**
 * Where a feed article stands with its full content: not fetched, waiting to be fetched by its feed's setting,
 * fetched, or failed. A generated article is always `none`.
 */
export const fullContentStatusSchema = z.enum(["none", "waiting", "fetched", "failed"]);
export type FullContentStatus = z.infer<typeof fullContentStatusSchema>;

/** The answer to a request for the full content of one feed article, given once the fetch is over. */
export const fullContentResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("fetched"), fullContent: fullContentSchema }),
  z.object({ status: z.literal("failed"), error: fullContentErrorSchema }),
]);
export type FullContentResult = z.infer<typeof fullContentResultSchema>;

// ---- annotations -------------------------------------------------------------------------------

/** The longest quote and the longest note, in characters. */
export const MAX_ANNOTATION_CHARS = 5000;
/** At most this many characters before and after a quote are kept to tell its occurrences apart. */
export const ANCHOR_CONTEXT_CHARS = 32;

const EMPTY = "is empty";

/** A note: trimmed, and none when nothing is left. */
const noteSchema = z
  .string()
  .max(MAX_ANNOTATION_CHARS, `is too long: at most ${MAX_ANNOTATION_CHARS} characters`)
  .transform((note) => {
    const trimmed = note.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

/**
 * A highlight on the body of an article, as a screen finds it again: the text, the text right before and after
 * it, and where it starts. The text around it and the position are counted without spaces and line breaks.
 */
export const highlightSchema = z.object({
  id: z.number().int(),
  articleId: z.number().int(),
  quote: z.string(),
  /** Up to `ANCHOR_CONTEXT_CHARS` characters right before the quote, without spaces. */
  prefix: z.string(),
  /** Up to `ANCHOR_CONTEXT_CHARS` characters right after the quote, without spaces. */
  suffix: z.string(),
  /** Where the quote starts, in characters of the body without spaces. */
  position: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Highlight = z.infer<typeof highlightSchema>;

/** The note on a whole article. An article has one at most. */
export const articleNoteSchema = z.object({
  id: z.number().int(),
  articleId: z.number().int(),
  text: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ArticleNote = z.infer<typeof articleNoteSchema>;

/** The annotations of one article: its note, and its highlights oldest first. */
export const articleAnnotationsSchema = z.object({
  note: articleNoteSchema.nullable(),
  highlights: z.array(highlightSchema),
});
export type ArticleAnnotations = z.infer<typeof articleAnnotationsSchema>;

export const highlightCreateSchema = z.object({
  quote: z
    .string()
    .max(MAX_ANNOTATION_CHARS, `is too long: at most ${MAX_ANNOTATION_CHARS} characters`)
    .refine((quote) => quote.trim().length > 0, EMPTY),
  prefix: z.string().max(ANCHOR_CONTEXT_CHARS),
  suffix: z.string().max(ANCHOR_CONTEXT_CHARS),
  position: z.number().int().min(0),
  note: noteSchema.nullable().optional().transform((note) => note ?? null),
});
export type HighlightCreate = z.input<typeof highlightCreateSchema>;

/** A change of a highlight's note. Null, or a text of spaces only, removes the note and keeps the highlight. */
export const highlightUpdateSchema = z.object({ note: noteSchema.nullable().transform((note) => note ?? null) });
export type HighlightUpdate = z.input<typeof highlightUpdateSchema>;

/** The note on a whole article, written anew or in place of the one it has. */
export const articleNoteUpdateSchema = z.object({
  text: z
    .string()
    .max(MAX_ANNOTATION_CHARS, `is too long: at most ${MAX_ANNOTATION_CHARS} characters`)
    .trim()
    .min(1, EMPTY),
});
export type ArticleNoteUpdate = z.infer<typeof articleNoteUpdateSchema>;

export const annotationKindSchema = z.enum(["highlight", "note"]);
export type AnnotationKind = z.infer<typeof annotationKindSchema>;

/** One annotation of the list over every article, with the article it belongs to. */
export const annotationListItemSchema = z.object({
  kind: annotationKindSchema,
  id: z.number().int(),
  articleId: z.number().int(),
  origin: originSchema,
  title: z.string(),
  translatedTitle: z.string().nullable(),
  /** Null for a note on the whole article. */
  quote: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type AnnotationListItem = z.infer<typeof annotationListItemSchema>;

export const annotationListSchema = z.object({
  items: z.array(annotationListItemSchema),
  nextCursor: z.string().nullable(),
});
export type AnnotationList = z.infer<typeof annotationListSchema>;

export const annotationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type AnnotationListQuery = z.infer<typeof annotationListQuerySchema>;

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
  /** When the article was last marked read. Null for an unread article, and for one read before read times were kept. */
  readAt: z.string().nullable(),
  /**
   * When the article's body was first shown to a reader. Marking it read or unread leaves it as it is. Null for an
   * article never opened, and for one opened before open times were kept.
   */
  openedAt: z.string().nullable(),
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
  /** The full content taken from the feed article's page, apart from what the feed delivered. Null when there is none. */
  fullContent: fullContentSchema.nullable(),
  fullContentStatus: fullContentStatusSchema,
  /** Why the full content could not be had. Null unless the status is `failed`. */
  fullContentError: fullContentErrorSchema.nullable(),
  snippetOnly: z.boolean(),
  previousArticleId: z.number().int().nullable(),
  /**
   * The other feeds that delivered a feed article, in the order their copies were stored: one entry per
   * copy recorded as a duplicate of this article. Empty for an article without duplicates.
   */
  otherFeeds: z.array(z.object({ articleId: z.number().int(), feedId: z.number().int(), feedTitle: z.string() })),
  refs: z.array(articleRefSchema),
  topics: z.array(z.object({ id: z.number().int(), text: z.string() })),
  /** The reader's highlights and note on the article. A screen finds the highlights in the body it draws. */
  annotations: articleAnnotationsSchema,
});
export type Article = z.infer<typeof articleSchema>;

/** The order of an article list: by the time lists sort by, newest first or oldest first. */
export const listSortSchema = z.enum(["newest", "oldest"]);
export type ListSort = z.infer<typeof listSortSchema>;

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
  /**
   * Only the articles read in the last seven days, last read first, ended events included. Refused together
   * with any other narrowing of the list.
   */
  recentlyRead: z.enum(["true"]).optional(),
  /**
   * Newest first when left out. Refused with `kind=event` and `recentlyRead=true`, whose order is fixed, even
   * as `newest`.
   */
  order: listSortSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type ArticleListQuery = z.infer<typeof articleListQuerySchema>;

/** A page of articles and the cursor to the next one. */
export const articlePageSchema = z.object({
  items: z.array(articleSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ArticlePage = z.infer<typeof articlePageSchema>;

export const articleListSchema = articlePageSchema.extend({
  /**
   * When the server read the list. Given as `before` to mark all as read, it covers the articles updated
   * until then, whatever the order and however many pages were loaded.
   */
  asOf: z.string(),
});
export type ArticleList = z.infer<typeof articleListSchema>;

/**
 * A search of the articles. Without narrowing it covers every article, generated and delivered, read or not,
 * ended events included; what filters hide is left out, and so are hidden duplicates unless a feed is named.
 */
export const articleSearchQuerySchema = z.object({
  /** The terms, separated by spaces. Checked by `parseSearchTerms`: not empty, at most 200 characters. */
  q: z.string(),
  category: z.coerce.number().int().optional(),
  feed: z.coerce.number().int().optional(),
  unread: z.enum(["true"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type ArticleSearchQuery = z.infer<typeof articleSearchQuerySchema>;

export const articleSearchHitSchema = articleSummarySchema.extend({
  /**
   * The text around the first match in the summary, automatic summary, body, impact or venue, on one line and
   * without Markdown; when none of them matches, around the first match in a note of the reader's. Null when
   * only the title or a highlighted text matches.
   */
  excerpt: z.string().nullable(),
  /** True when the excerpt was taken from a note of the reader's. */
  excerptFromNote: z.boolean(),
});
export type ArticleSearchHit = z.infer<typeof articleSearchHitSchema>;

export const articleSearchResultSchema = z.object({
  items: z.array(articleSearchHitSchema),
  nextCursor: z.string().nullable(),
  /** When the server read the result, as in the article list. */
  asOf: z.string(),
  /** The terms as they were matched: normalized, each once. A screen marks them with `matchRanges`. */
  terms: z.array(z.string()),
});
export type ArticleSearchResult = z.infer<typeof articleSearchResultSchema>;

export const articleUpdateSchema = z.object({ isRead: z.boolean().optional(), starred: z.boolean().optional() });
export type ArticleUpdate = z.infer<typeof articleUpdateSchema>;

export const markReadSchema = z.object({
  categoryId: z.number().int().optional(),
  uncategorized: z.literal(true).optional(),
  origin: originSchema.optional(),
  feedId: z.number().int().optional(),
  minImportance: importanceSchema.optional(),
  before: z.iso.datetime({ offset: true }),
  /** Belongs to the other shape: a body with both is refused. */
  articles: z.never().optional(),
});
export type MarkRead = z.infer<typeof markReadSchema>;

/** How many articles one request may name with the versions a screen showed. */
export const MAX_MARK_SEEN = 500;

/** An article as a screen showed it: `updatedAt` is the version on screen, so a later follow-up stays unread. */
export const seenArticleSchema = z.object({ id: z.number().int(), updatedAt: z.iso.datetime({ offset: true }) });
export type SeenArticle = z.infer<typeof seenArticleSchema>;

export const markSeenSchema = z.strictObject({
  articles: z
    .array(seenArticleSchema)
    .min(1, "name at least one article")
    .max(MAX_MARK_SEEN, `too many articles: at most ${MAX_MARK_SEEN}`),
});
export type MarkSeen = z.infer<typeof markSeenSchema>;

/** The body of `POST /articles/mark-read`: a range, or the articles a screen showed. */
export const markReadBodySchema = z.union([markSeenSchema, markReadSchema]);

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

// ---- list views --------------------------------------------------------------------------------

/**
 * An entry of the left pane and the drawer that keeps its own list view: a fixed entry, a category, the
 * generated articles of a category, or a subscribed feed. The recently read articles keep none.
 */
export type ListViewTarget =
  | { list: "unread" | "all" | "starred" | "generated" | "uncategorized" }
  | { list: "category" | "category_generated"; categoryId: number }
  | { list: "feed"; feedId: number };

/**
 * The entry a key names, in the form the apps make for a route: `unread`, `all`, `starred`, `generated`,
 * `uncategorized`, `category-3`, `category-3-generated`, `feed-12`. Null for `recently-read`, which keeps no
 * list view, and for anything else.
 */
export function parseListViewKey(key: string): ListViewTarget | null {
  if (key === "unread" || key === "all" || key === "starred" || key === "generated" || key === "uncategorized") return { list: key };
  const category = /^category-(\d{1,15})(-generated)?$/.exec(key);
  if (category) return { list: category[2] === undefined ? "category" : "category_generated", categoryId: Number(category[1]) };
  const feed = /^feed-(\d{1,15})$/.exec(key);
  return feed ? { list: "feed", feedId: Number(feed[1]) } : null;
}

/** The key of an entry, as `parseListViewKey` reads it. */
export function listViewKey(target: ListViewTarget): string {
  if (target.list === "category") return `category-${target.categoryId}`;
  if (target.list === "category_generated") return `category-${target.categoryId}-generated`;
  if (target.list === "feed") return `feed-${target.feedId}`;
  return target.list;
}

/** How one entry shows its articles. An entry the server does not answer has every default: newest first. */
export const listViewSchema = z.object({ key: z.string(), sort: listSortSchema });
export type ListView = z.infer<typeof listViewSchema>;

/** The entries whose view differs from the defaults. */
export const listViewsSchema = z.object({ items: z.array(listViewSchema) });
export type ListViews = z.infer<typeof listViewsSchema>;

/** A change to one entry's view. What is left out stays as it is. */
export const listViewUpdateSchema = z.object({ sort: listSortSchema }).partial();
export type ListViewUpdate = z.infer<typeof listViewUpdateSchema>;

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
  /** Whether the full content of the articles this feed delivers from now on is fetched from their pages. */
  fetchFullContent: z.boolean(),
  lastFetchedAt: z.string().nullable(),
  lastSucceededAt: z.string().nullable(),
  lastError: z.string().nullable(),
  failureCount: z.number().int(),
  /** When the feed is fetched next. Null while it is disabled. */
  nextFetchAt: z.string().nullable(),
  articleCount: z.number().int(),
  starredCount: z.number().int(),
  /** The articles of this feed with an annotation, each counted once: they go with the feed when it is deleted. */
  annotatedCount: z.number().int(),
  createdAt: z.string(),
  /**
   * When a fetch last found an item the feed had never listed, stored as an article or not. Null until one is
   * found; a feed without one is judged from `createdAt`.
   */
  lastNewItemAt: z.string().nullable(),
  /** Whether the feed is enabled and no new item came for more than `staleFeedDays` of the settings. */
  stale: z.boolean(),
  /** The articles of this feed stored within the last 30 days: `received` of its stats. */
  recentArticleCount: z.number().int(),
});
export type Feed = z.infer<typeof feedSchema>;

/** How many days the stats of a feed look back, counted from when its articles were stored. */
export const FEED_STATS_DAYS = 30;

/** What became of the articles a feed delivered within the last `FEED_STATS_DAYS` days. */
export const feedStatsSchema = z.object({
  /** The start of the period: articles stored at or after it are counted. */
  since: z.string(),
  /** Every article stored, hidden ones included. */
  received: z.number().int(),
  /** The ones with an open time. */
  opened: z.number().int(),
  /** The ones with a star now. */
  starred: z.number().int(),
  /** The ones the filters hide now, without the starred and annotated ones. */
  hiddenByFilters: z.number().int(),
  /** The ones recorded as duplicates, while duplicate removal is on; 0 while it is off. */
  hiddenAsDuplicates: z.number().int(),
  lastNewItemAt: z.string().nullable(),
});
export type FeedStats = z.infer<typeof feedStatsSchema>;

export const feedCreateSchema = z.object({
  url: feedUrlSchema,
  title: feedTitleSchema.optional(),
  categoryId: z.number().int().nullable().optional(),
  intervalMinutes: intervalMinutesSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  autoSummarize: z.boolean().optional(),
  translate: z.boolean().optional(),
  fetchFullContent: z.boolean().optional(),
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

// ---- filters -----------------------------------------------------------------------------------

/** A hide filter hides the feed articles that meet it; a keep filter hides those of its scope that meet none. */
export const filterActionSchema = z.enum(["hide", "keep"]);
export type FilterAction = z.infer<typeof filterActionSchema>;

export const filterFieldSchema = z.enum(["title", "content", "author", "url"]);
export type FilterField = z.infer<typeof filterFieldSchema>;

export const filterMatchSchema = z.enum(["contains", "regex"]);
export type FilterMatch = z.infer<typeof filterMatchSchema>;

/** The most conditions one filter holds, and the longest value a condition holds. */
export const MAX_FILTER_CONDITIONS = 10;
export const MAX_FILTER_VALUE_CHARS = 200;

/** An article meets a condition when any of the chosen fields matches the value. */
export const filterConditionSchema = z.object({
  fields: z
    .array(filterFieldSchema)
    .min(1, "choose at least one field")
    .refine((fields) => new Set(fields).size === fields.length, "a field is chosen twice"),
  match: filterMatchSchema,
  value: z.string().trim().min(1).max(MAX_FILTER_VALUE_CHARS),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const filterScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("category"), categoryId: z.number().int() }),
  z.object({ type: z.literal("feed"), feedId: z.number().int() }),
]);
export type FilterScope = z.infer<typeof filterScopeSchema>;

export const filterSchema = z.object({
  id: z.number().int(),
  action: filterActionSchema,
  scope: filterScopeSchema,
  conditions: z.array(filterConditionSchema),
  enabled: z.boolean(),
  /** Feed articles without a star this filter hides now. An article several filters hide counts for each. 0 while disabled. */
  hiddenCount: z.number().int(),
  createdAt: z.string(),
});
export type Filter = z.infer<typeof filterSchema>;

const KEEP_EVERYWHERE = "a keep filter cannot apply to everything";

const filterFields = {
  action: filterActionSchema,
  scope: filterScopeSchema,
  conditions: z.array(filterConditionSchema).min(1, "a filter needs at least one condition").max(MAX_FILTER_CONDITIONS),
  enabled: z.boolean(),
};

export const filterCreateSchema = z
  .object({ ...filterFields, enabled: filterFields.enabled.optional() })
  .refine((filter) => !(filter.action === "keep" && filter.scope.type === "all"), { message: KEEP_EVERYWHERE, path: ["scope"] });
export type FilterCreate = z.infer<typeof filterCreateSchema>;

/** A change to a filter. A keep filter over everything is refused once the change is applied. */
export const filterUpdateSchema = z
  .object(filterFields)
  .partial()
  .refine((filter) => !(filter.action === "keep" && filter.scope?.type === "all"), { message: KEEP_EVERYWHERE, path: ["scope"] });
export type FilterUpdate = z.infer<typeof filterUpdateSchema>;

/** A changed filter, and how many feed articles came back to the lists with the change. */
export const filterUpdateResultSchema = filterSchema.extend({ restored: z.number().int() });
export type FilterUpdateResult = z.infer<typeof filterUpdateResultSchema>;

export const filterDeleteResultSchema = z.object({ restored: z.number().int() });
export type FilterDeleteResult = z.infer<typeof filterDeleteResultSchema>;

/** A filter to try without saving it. With `id`, the stored filter of that id is left out of the count. */
export const filterPreviewSchema = z
  .object({ ...filterFields, enabled: filterFields.enabled.optional(), id: z.number().int().optional() })
  .refine((filter) => !(filter.action === "keep" && filter.scope.type === "all"), { message: KEEP_EVERYWHERE, path: ["scope"] });
export type FilterPreview = z.infer<typeof filterPreviewSchema>;

export const filterPreviewResultSchema = z.object({ hiddenCount: z.number().int() });
export type FilterPreviewResult = z.infer<typeof filterPreviewResultSchema>;

/** A page of the feed articles a filter hides. The answer has the shape of the article list. */
export const filterArticlesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type FilterArticlesQuery = z.infer<typeof filterArticlesQuerySchema>;

// ---- term highlights ---------------------------------------------------------------------------

/** The colours a term group can take. Their values are in DESIGN.md, one for each colour scheme. */
export const termColorSchema = z.enum(["green", "purple", "pink", "orange"]);
export type TermColor = z.infer<typeof termColorSchema>;
export const TERM_COLORS = termColorSchema.options;

const termGroupNameSchema = z.string().trim().min(1, "a name is required").max(100);
const highlightTermTextSchema = z.string().trim().min(1, "a term is required").max(100);

/** A word marked in lists and article texts wherever it occurs, as stop words were matched. */
export const highlightTermSchema = z.object({ id: z.number().int(), text: z.string() });
export type HighlightTerm = z.infer<typeof highlightTermSchema>;

/** Terms under one name and one colour. Groups are kept in an order: where two match one place, the upper one colours it. */
export const termGroupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: termColorSchema,
  terms: z.array(highlightTermSchema),
});
export type TermGroup = z.infer<typeof termGroupSchema>;

export const termGroupCreateSchema = z.object({ name: termGroupNameSchema, color: termColorSchema.optional() });
export type TermGroupCreate = z.infer<typeof termGroupCreateSchema>;

export const termGroupUpdateSchema = z.object({ name: termGroupNameSchema, color: termColorSchema }).partial();
export type TermGroupUpdate = z.infer<typeof termGroupUpdateSchema>;

/** Where a term group goes: before another one, or last. */
export const termGroupMoveSchema = z.object({ before: z.number().int().nullable() });
export type TermGroupMove = z.infer<typeof termGroupMoveSchema>;

export const highlightTermCreateSchema = z.object({ text: highlightTermTextSchema });
export type HighlightTermCreate = z.infer<typeof highlightTermCreateSchema>;

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
  /** Left out, a new feed does not fetch full content and a known one keeps what it has. */
  fetchFullContent: z.boolean().optional(),
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

/** A filter's scope in the file: a category by its slug, a feed by its URL. */
const settingsFileFilterScopeSchema = z.union([
  z.literal("all"),
  z.object({ category: slugSchema }).strict(),
  z.object({ feed: feedUrlSchema }).strict(),
]);
export type SettingsFileFilterScope = z.infer<typeof settingsFileFilterScopeSchema>;

const settingsFileFilterSchema = z
  .object({
    action: filterActionSchema,
    scope: settingsFileFilterScopeSchema,
    /** Left out when the filter is enabled. */
    enabled: z.boolean().optional(),
    conditions: filterFields.conditions,
  })
  .refine((filter) => !(filter.action === "keep" && filter.scope === "all"), { message: KEEP_EVERYWHERE, path: ["scope"] });
export type SettingsFileFilter = z.infer<typeof settingsFileFilterSchema>;

/** The format before filters: a word that hid the feed articles containing it in the title, or in the title or content. */
const settingsFileStopWordSchema = z.object({
  text: z.string().trim().min(1).max(100),
  scope: z.enum(["title", "title_and_content"]).optional(),
});

/** A term group in the file, matched by its name. */
const settingsFileTermGroupSchema = z.object({
  name: termGroupNameSchema,
  color: termColorSchema,
  terms: z.array(highlightTermTextSchema).default([]),
});
export type SettingsFileTermGroup = z.infer<typeof settingsFileTermGroupSchema>;

/**
 * The entry of a list view in the file: a fixed entry by its name, a category by its slug, the generated
 * articles of a category with `generatedOnly`, a feed by its URL.
 */
const settingsFileListViewTargetSchema = z.union([
  z.enum(["unread", "all", "starred", "generated", "uncategorized"]),
  z.object({ category: slugSchema, generatedOnly: z.boolean().optional() }).strict(),
  z.object({ feed: feedUrlSchema }).strict(),
]);
export type SettingsFileListViewTarget = z.infer<typeof settingsFileListViewTargetSchema>;

/** A list view in the file. A setting left out keeps the stored value; the defaults are left out when written. */
const settingsFileListViewSchema = z.object({
  list: settingsFileListViewTargetSchema,
  sort: listSortSchema.optional(),
});
export type SettingsFileListView = z.infer<typeof settingsFileListViewSchema>;

export const settingsFileSchema = z.object({
  version: z.literal(1),
  settings: settingsSchema.partial().optional(),
  categories: z.array(settingsFileCategorySchema).default([]),
  /** Subscribed feeds that belong to no category. */
  subscriptions: z.array(settingsFileSubscriptionSchema).default([]),
  filters: z.array(settingsFileFilterSchema).default([]),
  /** Read for files written before filters, and turned into hide filters over everything. Never written. */
  stopWords: z.array(settingsFileStopWordSchema).default([]),
  /** In the order of the groups. Left out when there are none. */
  termGroups: z.array(settingsFileTermGroupSchema).default([]),
  /** The entries whose list view differs from the defaults. Left out when there are none. */
  listViews: z.array(settingsFileListViewSchema).default([]),
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
  filtersCreated: z.number().int(),
  termGroupsCreated: z.number().int(),
  highlightTermsCreated: z.number().int(),
  /** The entries of `listViews` that were applied. */
  listViewsUpdated: z.number().int(),
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

// ---- relayed images ----------------------------------------------------------------------------

/**
 * Where the server relays images: `<this path><signature>/<original URL in base64url>`. The API gives image
 * URLs in this form, as paths without an origin; a screen loads an image only when its URL is one of them.
 */
export const IMAGE_PROXY_PATH = "/api/v1/image-proxy/";

/** Whether an image URL is a path of the server's relay, the only kind of image a screen loads. */
export function isImageProxyPath(url: string): boolean {
  return url.startsWith(IMAGE_PROXY_PATH);
}
