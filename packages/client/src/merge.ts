import type { ArticleSummary, ListSort } from "@smarternews/core/api";
import type { ListTarget } from "./nav.ts";

/** The time a list is ordered by. */
export type SortKey = (item: ArticleSummary) => string;

const byUpdate: SortKey = (item) => item.updatedAt;
const byReadTime: SortKey = (item) => item.readAt ?? "";

/** What the list of the target is ordered by: read time for the recently read articles, else last update. */
export function sortKeyFor(target: ListTarget): SortKey {
  return target.type === "recentlyRead" ? byReadTime : byUpdate;
}

/**
 * The list to show: what the server returned, plus the articles the user read during this visit to the list.
 * An unread list stops returning an article once it is read; keeping it lets the user go back to it. The
 * list of recently read articles orders by read time, and keeps an article put back to unread with the read
 * time it had, so that it stays where it was. A list oldest first puts what it keeps in the same order.
 */
export function mergeKept(fetched: ArticleSummary[], kept: ArticleSummary[], key: SortKey = byUpdate, sort: ListSort = "newest"): ArticleSummary[] {
  if (kept.length === 0) return fetched;
  const byId = new Map(fetched.map((item) => [item.id, item]));
  for (const item of kept) byId.set(item.id, item);
  const newestFirst = (a: ArticleSummary, b: ArticleSummary) => key(b).localeCompare(key(a)) || b.id - a.id;
  return [...byId.values()].sort(sort === "oldest" ? (a, b) => newestFirst(b, a) : newestFirst);
}
