import { parse, stringify } from "yaml";
import type { z } from "zod";
import { settingsFileSchema, type ImportResult, type SettingsFile } from "./api.ts";
import type { Clock } from "./clock.ts";
import { createCategory, findCategoryBySlug, listCategories, updateCategory } from "./db/categories.ts";
import { transaction, type Database } from "./db/database.ts";
import { getSettings, updateSettings } from "./db/settings.ts";
import { createTopic, listTopics, updateTopic, applyInterpretation } from "./db/topics.ts";
import { DomainError, type FieldError } from "./errors.ts";

export function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/** Writes categories, topics, reader information and global settings as YAML. Holds no secrets and no articles. */
export function exportSettings(db: Database): string {
  const file: SettingsFile = {
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
    })),
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
 * Applies a settings file. Categories are matched by slug and topics by text; whatever the file does not
 * mention stays as it is. Nothing is stored when any part of the file is refused.
 */
export function importSettings(db: Database, text: string, clock: Clock): ImportResult {
  const file = parseFile(text);
  const result: ImportResult = { categoriesCreated: 0, categoriesUpdated: 0, topicsCreated: 0, topicsUpdated: 0 };
  transaction(db, () => {
    if (file.settings) updateSettings(db, file.settings);
    file.categories.forEach((entry, index) => {
      const { topics, slug, kind, ...fields } = entry;
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
    });
  });
  return result;
}
