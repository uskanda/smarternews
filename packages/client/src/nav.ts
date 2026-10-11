// What the list of entries holds — the left pane of the web app, the drawer of the Android app — and which
// articles each entry opens. Both apps draw this one model, so they cannot disagree.
import type { ArticleListQuery, Category, Counts, Feed, MarkRead } from "@smarternews/core/api";

/** A list of articles a reader can open. */
export type ListTarget =
  | { type: "unread" | "all" | "starred" | "generated" | "uncategorized" }
  /** A category: everything in it, or only the articles the model wrote. */
  | { type: "category"; categoryId: number; generatedOnly: boolean }
  | { type: "feed"; feedId: number };

export interface NavEntry {
  target: ListTarget;
  label: string;
  /** Unread articles behind the entry. Zero for "すべて" and "スター", which do not count unread articles. */
  unread: number;
}

export interface NavGroup {
  /** A category, or "未分類" for the feeds that belong to none. */
  entry: NavEntry;
  /** Empty for a category without subscribed feeds: it then looks as it did before feeds existed. */
  children: NavEntry[];
}

export interface NavModel {
  views: NavEntry[];
  groups: NavGroup[];
  /** How many articles are starred, read or not. The web app shows it beside "スター". */
  starred: number;
}

export const GENERATED_LABEL = "AI生成";
export const UNCATEGORIZED_LABEL = "未分類";

export function buildNav(input: { categories: Category[]; feeds: Feed[]; counts: Counts | undefined }): NavModel {
  const { categories, feeds, counts } = input;
  const ofCategory = new Map(counts?.categories.map((entry) => [entry.categoryId, entry]));
  const ofFeed = new Map(counts?.feeds.map((entry) => [entry.feedId, entry.unread]));
  const feedEntry = (feed: Feed): NavEntry => ({ target: { type: "feed", feedId: feed.id }, label: feed.title, unread: ofFeed.get(feed.id) ?? 0 });

  const groups: NavGroup[] = categories
    .filter((category) => category.enabled)
    .map((category) => {
      const own = feeds.filter((feed) => feed.categoryId === category.id);
      const count = ofCategory.get(category.id);
      return {
        entry: { target: { type: "category", categoryId: category.id, generatedOnly: false }, label: category.name, unread: count?.unread ?? 0 },
        children:
          own.length === 0
            ? []
            : [
                { target: { type: "category", categoryId: category.id, generatedOnly: true }, label: GENERATED_LABEL, unread: count?.generatedUnread ?? 0 },
                ...own.map(feedEntry),
              ],
      };
    });
  const loose = feeds.filter((feed) => feed.categoryId === null);
  if (loose.length > 0) {
    groups.push({
      entry: { target: { type: "uncategorized" }, label: UNCATEGORIZED_LABEL, unread: counts?.uncategorizedUnread ?? 0 },
      children: loose.map(feedEntry),
    });
  }
  return {
    views: [
      { target: { type: "unread" }, label: "未読", unread: counts?.unread ?? 0 },
      { target: { type: "all" }, label: "すべて", unread: 0 },
      { target: { type: "starred" }, label: "スター", unread: 0 },
      { target: { type: "generated" }, label: GENERATED_LABEL, unread: counts?.generatedUnread ?? 0 },
    ],
    groups,
    starred: counts?.starred ?? 0,
  };
}

/** A short text that names a list, for a route or a stored choice. */
export function listKey(target: ListTarget): string {
  if (target.type === "category") return `category-${target.categoryId}${target.generatedOnly ? "-generated" : ""}`;
  if (target.type === "feed") return `feed-${target.feedId}`;
  return target.type;
}

export function parseListKey(key: string): ListTarget | null {
  if (key === "unread" || key === "all" || key === "starred" || key === "generated" || key === "uncategorized") return { type: key };
  const category = /^category-(\d{1,15})(-generated)?$/.exec(key);
  if (category) return { type: "category", categoryId: Number(category[1]), generatedOnly: category[2] !== undefined };
  const feed = /^feed-(\d{1,15})$/.exec(key);
  return feed ? { type: "feed", feedId: Number(feed[1]) } : null;
}

/** The part of the article list query that the target decides. */
export function targetFilter(target: ListTarget): ArticleListQuery {
  switch (target.type) {
    case "unread":
      return { unread: "true" };
    case "all":
      return {};
    case "starred":
      return { starred: "true" };
    case "generated":
      return { origin: "generated" };
    case "uncategorized":
      return { uncategorized: "true" };
    case "category":
      return { category: target.categoryId, ...(target.generatedOnly ? { origin: "generated" as const } : {}) };
    case "feed":
      return { feed: target.feedId };
  }
}

/** The part of a mark-all-read that the target decides. */
export function targetScope(target: ListTarget): Omit<MarkRead, "before" | "minImportance"> {
  switch (target.type) {
    case "generated":
      return { origin: "generated" };
    case "uncategorized":
      return { uncategorized: true };
    case "category":
      return { categoryId: target.categoryId, ...(target.generatedOnly ? { origin: "generated" as const } : {}) };
    case "feed":
      return { feedId: target.feedId };
    default:
      return {};
  }
}

/** Whether the list shows unread articles only until the reader asks for the read ones too. */
export function hasReadToggle(target: ListTarget): boolean {
  return target.type !== "unread" && target.type !== "all" && target.type !== "starred";
}
