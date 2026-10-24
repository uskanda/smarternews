import { parse, stringify } from "yaml";
import type { z } from "zod";
import {
  settingsFileSchema,
  type Feed,
  type FilterCondition,
  type FilterCreate,
  type FilterScope,
  type ImportResult,
  type SettingsFile,
  type SettingsFileFilter,
  type SettingsFileFilterScope,
  type SettingsFileInput,
  type SettingsFileSubscription,
} from "./api.ts";
import type { Clock } from "./clock.ts";
import { createCategory, findCategory, findCategoryBySlug, listCategories, orderCategories, updateCategory } from "./db/categories.ts";
import { transaction, type Database } from "./db/database.ts";
import { findFeed, findFeedByUrl, insertFeed, listFeeds, orderFeeds, updateFeed } from "./db/feeds.ts";
import { createFilter, findSameFilter, listFilters, updateFilter } from "./db/filters.ts";
import { getSettings, updateSettings } from "./db/settings.ts";
import { createTopic, listTopics, updateTopic, applyInterpretation } from "./db/topics.ts";
import { DomainError, type FieldError } from "./errors.ts";
import { conditionProblems } from "./filters/match.ts";

export function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function toSubscription(feed: Feed): SettingsFileSubscription {
  return {
    url: feed.url,
    title: feed.title,
    ...(feed.intervalMinutes === null ? {} : { intervalMinutes: feed.intervalMinutes }),
    enabled: feed.enabled,
    // Written only when it is on: a file without the line leaves the setting of a known feed as it is.
    ...(feed.autoSummarize ? { autoSummarize: true } : {}),
    ...(feed.translate ? { translate: true } : {}),
  };
}

/** A filter's scope as the file names it: a category by its slug, a feed by its URL. */
function toFileScope(db: Database, scope: FilterScope): SettingsFileFilterScope {
  if (scope.type === "category") return { category: findCategory(db, scope.categoryId)!.slug };
  if (scope.type === "feed") return { feed: findFeed(db, scope.feedId)!.url };
  return "all";
}

function toFileFilters(db: Database): SettingsFileFilter[] {
  return listFilters(db).map((filter) => ({
    action: filter.action,
    scope: toFileScope(db, filter.scope),
    // Written only when it is off: a filter is enabled unless the file says otherwise.
    ...(filter.enabled ? {} : { enabled: false }),
    conditions: filter.conditions,
  }));
}

/**
 * Writes categories, topics, subscribed feeds, filters, reader information and global settings as YAML.
 * Holds no secrets, no articles and no fetch state.
 */
export function exportSettings(db: Database): string {
  const feeds = listFeeds(db);
  const subscriptionsOf = (categoryId: number | null) => {
    const list = feeds.filter((feed) => feed.categoryId === categoryId).map(toSubscription);
    return list.length > 0 ? { subscriptions: list } : {};
  };
  const filters = toFileFilters(db);
  const file: SettingsFileInput = {
    version: 1,
    settings: getSettings(db),
    categories: listCategories(db).map((category) => ({
      slug: category.slug,
      name: category.name,
      kind: category.kind,
      schedule: category.schedule,
      minImportance: category.minImportance,
      maxArticlesPerRun: category.maxArticlesPerRun,
      ...(category.kind === "event"
        ? { windowDays: category.windowDays ?? undefined }
        : { windowHours: category.windowHours ?? undefined }),
      enabled: category.enabled,
      topics: listTopics(db, category.id).map((topic) => ({
        text: topic.text,
        enabled: topic.enabled,
        sources: topic.sources,
        ...(topic.search ? { search: topic.search } : {}),
        ...(topic.interpreted ? { interpretation: { queries: topic.queries, criteria: topic.criteria } } : {}),
      })),
      ...subscriptionsOf(category.id),
    })),
    ...subscriptionsOf(null),
    ...(filters.length > 0 ? { filters } : {}),
  };
  return stringify(file, { lineWidth: 0 });
}

function parseFile(text: string): SettingsFile {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new DomainError("invalid", `the settings file is not valid YAML: ${(error as Error).message}`);
  }
  const parsed = settingsFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("invalid", "the settings file does not match the expected format", zodFieldErrors(parsed.error));
  }
  return parsed.data;
}

/**
 * Stores the subscriptions a settings file lists for one category, or for none. A feed whose URL is already
 * subscribed is updated and moved there; the others are registered without being fetched.
 */
function importSubscriptions(
  db: Database,
  subscriptions: SettingsFileSubscription[],
  categoryId: number | null,
  path: string,
  result: ImportResult,
  clock: Clock,
): void {
  // The file's order becomes the order of the list; feeds the file does not mention follow.
  const listed: number[] = [];
  subscriptions.forEach((entry, index) => {
    try {
      const existing = findFeedByUrl(db, entry.url);
      if (existing) {
        listed.push(existing.id);
        updateFeed(
          db,
          existing.id,
          {
            categoryId,
            // The file says what the interval is: without one, the feed follows the base interval.
            intervalMinutes: entry.intervalMinutes ?? null,
            ...(entry.title !== undefined && entry.title !== existing.title ? { title: entry.title } : {}),
            ...(entry.enabled !== undefined ? { enabled: entry.enabled } : {}),
            // Switching summaries on here starts them at this moment: the articles the feed already has stay as they are.
            ...(entry.autoSummarize !== undefined ? { autoSummarize: entry.autoSummarize } : {}),
            ...(entry.translate !== undefined ? { translate: entry.translate } : {}),
          },
          clock,
        );
        result.feedsUpdated += 1;
        return;
      }
      const created = insertFeed(
        db,
        {
          url: entry.url,
          title: entry.title ?? new URL(entry.url).host,
          titleSetByUser: entry.title !== undefined,
          categoryId,
          intervalMinutes: entry.intervalMinutes,
          enabled: entry.enabled,
          autoSummarize: entry.autoSummarize,
          translate: entry.translate,
        },
        clock,
      );
      listed.push(created.id);
      result.feedsCreated += 1;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      throw new DomainError("invalid", error.message, [{ path: `${path}.${index}`, message: error.message }]);
    }
  });
  if (listed.length > 0) orderFeeds(db, categoryId, listed);
}

/** A stop word of a file written before filters, as the hide filter over everything it became. */
function fromStopWord(word: SettingsFile["stopWords"][number]): SettingsFileFilter {
  const fields: FilterCondition["fields"] = word.scope === "title_and_content" ? ["title", "content"] : ["title"];
  return { action: "hide", scope: "all", conditions: [{ fields, match: "contains", value: word.text }] };
}

function refuseFilter(path: string, message: string): DomainError {
  return new DomainError("invalid", `${path}: ${message}`, [{ path, message }]);
}

/**
 * Stores the filters of the file, once its categories and feeds are stored. A scope is tied to the category
 * of that slug, or the feed of that URL, on the server. A filter that is registered already only takes the
 * file's switch; a stop word of an older file that is registered already is left as it is.
 */
function importFilters(db: Database, file: SettingsFile, result: ImportResult, clock: Clock): void {
  const entries = [
    ...file.filters.map((filter, index) => ({ filter, path: `filters.${index}`, switchable: true })),
    ...file.stopWords.map((word, index) => ({ filter: fromStopWord(word), path: `stopWords.${index}`, switchable: false })),
  ];
  for (const { filter, path, switchable } of entries) {
    const problems = conditionProblems(filter.conditions, `${path}.conditions`);
    if (problems.length > 0) throw new DomainError("invalid", `${problems[0]!.path}: ${problems[0]!.message}`, problems);
    let scope: FilterScope = { type: "all" };
    if (filter.scope !== "all" && "category" in filter.scope) {
      const category = findCategoryBySlug(db, filter.scope.category);
      if (!category) throw refuseFilter(`${path}.scope.category`, `no category "${filter.scope.category}" in the file or on the server`);
      scope = { type: "category", categoryId: category.id };
    } else if (filter.scope !== "all") {
      const feed = findFeedByUrl(db, filter.scope.feed);
      if (!feed) throw refuseFilter(`${path}.scope.feed`, `no feed ${filter.scope.feed} in the file or on the server`);
      scope = { type: "feed", feedId: feed.id };
    }
    const input: FilterCreate = { action: filter.action, scope, conditions: filter.conditions, enabled: filter.enabled ?? true };
    const same = findSameFilter(db, input);
    if (same) {
      if (switchable && same.enabled !== input.enabled) updateFilter(db, same.id, { enabled: input.enabled });
      continue;
    }
    createFilter(db, input, clock);
    result.filtersCreated += 1;
  }
}

/**
 * Applies a settings file. Categories are matched by slug, topics by text, subscribed feeds by URL and
 * filters by action, scope and conditions; whatever the file does not mention stays as it is. Nothing is
 * stored when any part of the file is refused.
 */
export function importSettings(db: Database, text: string, clock: Clock): ImportResult {
  const file = parseFile(text);
  const result: ImportResult = {
    categoriesCreated: 0,
    categoriesUpdated: 0,
    topicsCreated: 0,
    topicsUpdated: 0,
    feedsCreated: 0,
    feedsUpdated: 0,
    filtersCreated: 0,
  };
  transaction(db, () => {
    if (file.settings) updateSettings(db, file.settings);
    const listed: number[] = [];
    file.categories.forEach((entry, index) => {
      const { topics, subscriptions, slug, kind, ...fields } = entry;
      const existing = findCategoryBySlug(db, slug);
      if (existing && existing.kind !== kind) {
        throw new DomainError("invalid", `the category "${slug}" already exists with another kind`, [
          { path: `categories.${index}.kind`, message: `is "${existing.kind}" on this server` },
        ]);
      }
      const category = existing
        ? updateCategory(db, existing.id, fields)
        : createCategory(db, { slug, kind, ...fields }, clock);
      if (existing) result.categoriesUpdated += 1;
      else result.categoriesCreated += 1;
      listed.push(category.id);

      const current = listTopics(db, category.id);
      for (const topic of topics) {
        const match = current.find((candidate) => candidate.text === topic.text);
        if (!match) {
          createTopic(db, category.id, topic, clock);
          result.topicsCreated += 1;
          continue;
        }
        updateTopic(db, match.id, { enabled: topic.enabled, sources: topic.sources, search: topic.search });
        if (topic.interpretation) {
          const updated = listTopics(db, category.id).find((candidate) => candidate.id === match.id)!;
          applyInterpretation(db, match.id, {
            ...topic.interpretation,
            suggestedSources: { newsSearch: updated.sources.newsSearch, llmSearch: updated.sources.llmSearch },
          });
        }
        result.topicsUpdated += 1;
      }
      importSubscriptions(db, subscriptions, category.id, `categories.${index}.subscriptions`, result, clock);
    });
    if (listed.length > 0) orderCategories(db, listed);
    importSubscriptions(db, file.subscriptions, null, "subscriptions", result, clock);

    importFilters(db, file, result, clock);
  });
  return result;
}
