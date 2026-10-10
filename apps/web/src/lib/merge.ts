import type { ArticleSummary } from "@smarternews/core/api";

/**
 * The list to show: what the server returned, plus the articles the user read during this visit to the list.
 * An unread list stops returning an article once it is read; keeping it lets the user go back to it.
 */
export function mergeKept(fetched: ArticleSummary[], kept: ArticleSummary[]): ArticleSummary[] {
  if (kept.length === 0) return fetched;
  const byId = new Map(fetched.map((item) => [item.id, item]));
  for (const item of kept) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
}
