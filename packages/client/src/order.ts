// The order of the entries: which list comes next after one is read, and where a dragged category or feed
// goes. The web app and the Android app measure their rows and leave the decision to this file.
import type { Category, Feed } from "@smarternews/core/api";
import { listKey, type ListTarget, type NavEntry, type NavGroup, type NavModel } from "./nav.ts";

/** How long a dragged feed has to stay over another category before it can be put there. */
export const DWELL_MS = 500;

/**
 * The list to open after the current one is marked as read: the next one below it that has unread articles.
 * A category leads to a category. A feed, or the generated articles of a category, leads to the next of
 * those, in whatever category it is. The views at the top lead nowhere.
 */
export function nextTarget(model: NavModel, current: ListTarget): ListTarget | null {
  const key = listKey(current);
  const after = (entries: NavEntry[]): ListTarget | null => {
    const index = entries.findIndex((entry) => listKey(entry.target) === key);
    if (index === -1) return null;
    return entries.slice(index + 1).find((entry) => entry.unread > 0)?.target ?? null;
  };
  if (current.type === "uncategorized" || (current.type === "category" && !current.generatedOnly)) {
    return after(model.groups.map((group) => group.entry));
  }
  if (current.type === "feed" || current.type === "category") return after(model.groups.flatMap((group) => group.children));
  return null;
}

/** What a reader can move: a category among the categories, a feed among the feeds. */
export type Movable = { kind: "category"; id: number } | { kind: "feed"; id: number };

/** A move as the API takes it: before another entry, or last when `before` is null. */
export type Move =
  | { kind: "category"; id: number; before: number | null }
  | { kind: "feed"; id: number; categoryId: number | null; before: number | null };

export function movableOf(target: ListTarget): Movable | null {
  if (target.type === "category" && !target.generatedOnly) return { kind: "category", id: target.categoryId };
  if (target.type === "feed") return { kind: "feed", id: target.feedId };
  return null;
}

const categoryIdOf = (group: NavGroup): number | null => (group.entry.target.type === "category" ? group.entry.target.categoryId : null);
const feedIdOf = (entry: NavEntry): number | null => (entry.target.type === "feed" ? entry.target.feedId : null);
const feedIdsOf = (group: NavGroup): number[] => group.children.map(feedIdOf).filter((id): id is number => id !== null);
const isCategory = (group: NavGroup): boolean => group.entry.target.type === "category";

/** One place up (-1) or down (1) among the entries of its kind, or null at the end of them. */
export function stepMove(model: NavModel, item: Movable, step: -1 | 1): Move | null {
  const group = item.kind === "feed" ? model.groups.find((candidate) => feedIdsOf(candidate).includes(item.id)) : undefined;
  const ids = item.kind === "category" ? model.groups.filter(isCategory).map((entry) => categoryIdOf(entry)!) : group ? feedIdsOf(group) : [];
  const index = ids.indexOf(item.id);
  if (index === -1 || index + step < 0 || index + step >= ids.length) return null;
  const before = step === -1 ? ids[index - 1]! : (ids[index + 2] ?? null);
  return item.kind === "category" ? { kind: "category", id: item.id, before } : { kind: "feed", id: item.id, categoryId: categoryIdOf(group!), before };
}

/** Where a row of the list is on screen. The key is `listKey` of what the row opens. */
export interface Row {
  key: string;
  top: number;
  bottom: number;
}

interface Span {
  group: NavGroup;
  key: string;
  top: number;
  bottom: number;
}

/** The groups that are on screen, each from its own row to the last row below it. */
function spans(model: NavModel, rows: Row[]): Span[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const out: Span[] = [];
  for (const group of model.groups) {
    const key = listKey(group.entry.target);
    const head = byKey.get(key);
    if (!head) continue;
    const below = group.children.map((child) => byKey.get(listKey(child.target))).filter((row): row is Row => row !== undefined);
    out.push({ group, key, top: head.top, bottom: Math.max(head.bottom, ...below.map((row) => row.bottom)) });
  }
  return out;
}

function spanAt(all: Span[], y: number): Span | undefined {
  return all.find((span) => y < span.bottom) ?? all.at(-1);
}

/** The key of the group at a height: the nearest one when the height is above or below all of them. */
export function groupAt(model: NavModel, rows: Row[], y: number): string | null {
  return spanAt(spans(model, rows), y)?.key ?? null;
}

export interface Drop {
  move: Move;
  /** Where to draw the line that shows the place. */
  lineY: number;
  /** The key of the group a feed would go into; null for a category. */
  group: string | null;
}

/**
 * Where the dragged entry goes when it is let go at height `y`, or null when it cannot go there. A feed goes
 * into its own category at once, and into another one only when that one is armed — the caller arms a group
 * after the feed stayed over it for `DWELL_MS`.
 */
export function dropAt(input: { model: NavModel; rows: Row[]; dragged: Movable; y: number; armed: string | null }): Drop | null {
  const { model, rows, dragged, y, armed } = input;
  const all = spans(model, rows);
  const middle = (box: { top: number; bottom: number }) => (box.top + box.bottom) / 2;

  if (dragged.kind === "category") {
    const others = all.filter((span) => isCategory(span.group) && categoryIdOf(span.group) !== dragged.id);
    const next = others.find((span) => y < middle(span));
    // Below the last category is where the feeds without a category start, and they stay last.
    const lineY = next ? next.top : (others.at(-1)?.bottom ?? y);
    return { move: { kind: "category", id: dragged.id, before: next ? categoryIdOf(next.group) : null }, lineY, group: null };
  }

  const span = spanAt(all, y);
  if (!span || !span.group.acceptsFeeds) return null;
  const own = feedIdsOf(span.group).includes(dragged.id);
  if (!own && armed !== span.key) return null;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const feedRows = span.group.children
    .filter((child) => feedIdOf(child) !== null && feedIdOf(child) !== dragged.id)
    .map((child) => ({ id: feedIdOf(child)!, row: byKey.get(listKey(child.target)) }))
    .filter((entry): entry is { id: number; row: Row } => entry.row !== undefined);
  const next = feedRows.find((entry) => y < middle(entry.row));
  return {
    move: { kind: "feed", id: dragged.id, categoryId: categoryIdOf(span.group), before: next?.id ?? null },
    lineY: next ? next.row.top : span.bottom,
    group: span.key,
  };
}

function placed<T extends { id: number }>(list: T[], item: T, before: number | null): T[] {
  const others = list.filter((entry) => entry.id !== item.id);
  const index = before === null ? -1 : others.findIndex((entry) => entry.id === before);
  return index === -1 ? [...others, item] : [...others.slice(0, index), item, ...others.slice(index)];
}

/** The lists as the server will return them after the move, to show the result before the answer arrives. */
export function applyMove(lists: { categories: Category[]; feeds: Feed[] }, move: Move): { categories: Category[]; feeds: Feed[] } {
  if (move.kind === "category") {
    const item = lists.categories.find((category) => category.id === move.id);
    return item ? { ...lists, categories: placed(lists.categories, item, move.before) } : lists;
  }
  const item = lists.feeds.find((feed) => feed.id === move.id);
  if (!item) return lists;
  const moved = { ...item, categoryId: move.categoryId };
  // Last means last in its category, which is last overall here: the lists are filtered by category when shown.
  return { ...lists, feeds: placed(lists.feeds, moved, move.before) };
}

/** A dragged entry this near to the top or the bottom of the list makes the list scroll. */
export const EDGE_PX = 48;
const EDGE_STEP_PX = 14;

/**
 * How far to scroll for one frame while an entry is held at height `y`: nothing away from the edges, more
 * the nearer the edge, and never past the ends of the content.
 */
export function edgeScroll(input: { y: number; top: number; height: number; offset: number; max: number }): number {
  const { y, top, height, offset, max } = input;
  const fromTop = y - top;
  const fromBottom = top + height - y;
  const speed = (distance: number) => Math.ceil(EDGE_STEP_PX * Math.min(1, Math.max(0, (EDGE_PX - distance) / EDGE_PX)));
  if (fromBottom < EDGE_PX) return Math.min(speed(fromBottom), Math.max(0, max - offset));
  if (fromTop < EDGE_PX) return 0 - Math.min(speed(fromTop), Math.max(0, offset));
  return 0;
}
