import type { ArticleSummary } from "@smarternews/core/api";
import type { ListTarget } from "./nav.ts";

/** The time a list is ordered by, newest first. */
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
 * time it had, so that it stays where it was.
 */
export function mergeKept(fetched: ArticleSummary[], kept: ArticleSummary[], key: SortKey = byUpdate): ArticleSummary[] {
  if (kept.length === 0) return fetched;
  const byId = new Map(fetched.map((item) => [item.id, item]));
  for (const item of kept) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
}
