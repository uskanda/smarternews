import type { ArticleSummary, ListSort } from "@smarternews/core/api";
import type { ListTarget } from "./nav.ts";

/** The time a list is ordered by. */
export type SortKey = (item: ArticleSummary) => string;

const byUpdate: SortKey = (item) => item.updatedAt;
const byReadTime: SortKey = (item) => item.readAt ?? "";
const byStarTime: SortKey = (item) => item.starredAt ?? "";
const byRank: SortKey = (item) => item.rankAt;

/**
 * What the list of the target is ordered by: read time for the recently read articles, star time for the
 * starred articles in that order, else last update.
 */
export function sortKeyFor(target: ListTarget, sort: ListSort = "newest"): SortKey {
  if (target.type === "recentlyRead") return byReadTime;
  return sort === "starred" ? byStarTime : byUpdate;
}

/**
 * The list to show: what the server returned, plus the articles the user read during this visit to the list.
 * An unread list stops returning an article once it is read; keeping it lets the user go back to it. The
 * list of recently read articles orders by read time, and keeps an article put back to unread with the read
 * time it had, so that it stays where it was. A list oldest first puts what it keeps in the same order; one by
 * star time puts it last starred first, as newest first does. A list by relevance orders by `rankAt`, highest
 * first, as the server does.
 *
 * An article the list still returns shows as the list returns it, title and read time included, with the read
 * state and the star of the kept copy: a list fetched before the change reached the server does not undo it. When
 * the list has it updated after the kept copy, a follow-up rewrote it and made it unread again on the server, so
 * it shows as the list returns it.
 */
export function mergeKept(fetched: ArticleSummary[], kept: ArticleSummary[], key: SortKey = byUpdate, sort: ListSort = "newest"): ArticleSummary[] {
  if (kept.length === 0) return fetched;
  const byId = new Map(fetched.map((item) => [item.id, item]));
  for (const item of kept) {
    const listed = byId.get(item.id);
    if (listed === undefined) byId.set(item.id, item);
    else if (listed.updatedAt <= item.updatedAt) byId.set(item.id, { ...listed, isRead: item.isRead, starred: item.starred });
  }
  const by = sort === "relevance" ? byRank : key;
  const newestFirst = (a: ArticleSummary, b: ArticleSummary) => by(b).localeCompare(by(a)) || b.id - a.id;
  return [...byId.values()].sort(sort === "oldest" ? (a, b) => newestFirst(b, a) : newestFirst);
}
