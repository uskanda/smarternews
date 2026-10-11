import type { Category, CategoryCreate, CategoryUpdate } from "../api.ts";
import type { Clock } from "../clock.ts";
import { DomainError, notFound } from "../errors.ts";
import { transaction, type Database } from "./database.ts";
import { releaseFeedsOfCategory } from "./feeds.ts";
import { bool, json, num, numOrNull, str, type Row } from "./rows.ts";

const DEFAULTS = {
  schedule: ["05:00"],
  minImportance: 3,
  maxArticlesPerRun: 5,
  windowHours: 24,
  windowDays: 7,
};

function toCategory(row: Row): Category {
  return {
    id: num(row.id),
    slug: str(row.slug),
    name: str(row.name),
    kind: str(row.kind) as Category["kind"],
    schedule: json<string[]>(row.schedule),
    minImportance: num(row.min_importance),
    maxArticlesPerRun: num(row.max_articles_per_run),
    windowHours: numOrNull(row.window_hours),
    windowDays: numOrNull(row.window_days),
    enabled: bool(row.enabled),
    createdAt: str(row.created_at),
  };
}

export function listCategories(db: Database): Category[] {
  return db.prepare("SELECT * FROM categories ORDER BY position, id").all().map(toCategory);
}

export function findCategory(db: Database, id: number): Category | null {
  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  return row ? toCategory(row) : null;
}

export function getCategory(db: Database, id: number): Category {
  const category = findCategory(db, id);
  if (!category) throw notFound("category", id);
  return category;
}

export function findCategoryBySlug(db: Database, slug: string): Category | null {
  const row = db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug);
  return row ? toCategory(row) : null;
}

function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "category";
}

function freeSlug(db: Database, base: string): string {
  let slug = base;
  for (let n = 2; findCategoryBySlug(db, slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

export function createCategory(db: Database, input: CategoryCreate, clock: Clock): Category {
  if (input.kind === "status") {
    throw new DomainError("invalid", 'the kind "status" is reserved and not available yet', [
      { path: "kind", message: 'use "news" or "event"' },
    ]);
  }
  if (input.slug !== undefined && findCategoryBySlug(db, input.slug)) {
    throw new DomainError("conflict", `the slug "${input.slug}" is already used by another category`, [
      { path: "slug", message: "already in use" },
    ]);
  }
  const slug = input.slug ?? freeSlug(db, slugFromName(input.name));
  const isEvent = input.kind === "event";
  const result = db
    .prepare(
      `INSERT INTO categories
         (slug, name, kind, schedule, min_importance, max_articles_per_run, window_hours, window_days, enabled, created_at, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM categories))`,
    )
    .run(
      slug,
      input.name,
      input.kind,
      JSON.stringify(input.schedule ?? DEFAULTS.schedule),
      input.minImportance ?? DEFAULTS.minImportance,
      input.maxArticlesPerRun ?? DEFAULTS.maxArticlesPerRun,
      isEvent ? null : (input.windowHours ?? DEFAULTS.windowHours),
      isEvent ? (input.windowDays ?? DEFAULTS.windowDays) : null,
      (input.enabled ?? true) ? 1 : 0,
      clock().toISOString(),
    );
  return getCategory(db, num(result.lastInsertRowid));
}

export function updateCategory(db: Database, id: number, patch: CategoryUpdate): Category {
  const current = getCategory(db, id);
  const isEvent = current.kind === "event";
  const next = {
    ...current,
    ...patch,
    windowHours: isEvent ? null : (patch.windowHours ?? current.windowHours),
    windowDays: isEvent ? (patch.windowDays ?? current.windowDays) : null,
  };
  db.prepare(
    `UPDATE categories
        SET name = ?, schedule = ?, min_importance = ?, max_articles_per_run = ?, window_hours = ?, window_days = ?, enabled = ?
      WHERE id = ?`,
  ).run(
    next.name,
    JSON.stringify(next.schedule),
    next.minImportance,
    next.maxArticlesPerRun,
    next.windowHours,
    next.windowDays,
    next.enabled ? 1 : 0,
    id,
  );
  return getCategory(db, id);
}

/** Stores the order of all categories: the given ones first, in that order, then the rest as they were. */
export function orderCategories(db: Database, ids: number[]): void {
  const first = new Set(ids);
  const all = [...ids, ...listCategories(db).map((category) => category.id).filter((id) => !first.has(id))];
  const set = db.prepare("UPDATE categories SET position = ? WHERE id = ?");
  transaction(db, () => all.forEach((id, index) => set.run(index + 1, id)));
}

/** Puts one category before another, or last when `before` is null. The others keep their order. */
export function moveCategory(db: Database, id: number, before: number | null): Category[] {
  getCategory(db, id);
  if (before !== null && !findCategory(db, before)) {
    throw new DomainError("invalid", `category ${before} does not exist`, [{ path: "before", message: "no such category" }]);
  }
  if (before !== id) {
    const others = listCategories(db)
      .map((category) => category.id)
      .filter((other) => other !== id);
    const at = before === null ? others.length : others.indexOf(before);
    orderCategories(db, [...others.slice(0, at), id, ...others.slice(at)]);
  }
  return listCategories(db);
}

/**
 * Deletes the category. Its topics, generated articles, candidates and runs go with it (ON DELETE CASCADE).
 * Its subscribed feeds stay, with their articles, and belong to no category afterwards.
 */
export function deleteCategory(db: Database, id: number): void {
  getCategory(db, id);
  transaction(db, () => {
    releaseFeedsOfCategory(db, id);
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  });
}
