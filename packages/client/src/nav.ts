// What the list of entries holds — the left pane of the web app, the drawer of the Android app — and which
// articles each entry opens. Both apps draw this one model, so they cannot disagree.
import type {
  ArticleListQuery,
  Category,
  Counts,
  Feed,
  ListFormat,
  ListSort,
  ListView,
  ListViewUpdate,
  MarkRead,
  SavedSearch,
} from "@smarternews/core/api";
import { feedState, strongestFeedState, type FeedState } from "./feed-state.ts";

/** A list of articles a reader can open. */
export type ListTarget =
  | { type: "unread" | "all" | "starred" | "generated" | "uncategorized" }
  /** The feed articles of every subscribed feed, in a category or in none. One feed is `feed`. */
  | { type: "feeds" }
  /** The articles read in the last seven days, last read first. */
  | { type: "recentlyRead" }
  /** The reader's highlights and notes on every article, the last made first. The web app has it; the Android app does not. */
  | { type: "annotations" }
  /** A category: everything in it, or only the articles the model wrote. */
  | { type: "category"; categoryId: number; generatedOnly: boolean }
  | { type: "feed"; feedId: number }
  /** The results of a saved search, unread only until the read ones are asked for. The web app has it; the Android app does not. */
  | { type: "savedSearch"; savedSearchId: number };

export interface NavEntry {
  target: ListTarget;
  label: string;
  /**
   * Unread articles behind the entry. Zero for "すべて", "スター", "最近読んだ記事" and "注釈", which do not count
   * unread articles.
   */
  unread: number;
  /** What the fetches of a feed came to, when something is wrong. Only a feed entry has it. */
  state?: FeedState;
}

export interface NavGroup {
  /** A category, or "未分類" for the feeds that belong to none. */
  entry: NavEntry;
  /** Empty for a category without subscribed feeds: it then looks as it did before feeds existed. */
  children: NavEntry[];
  /** The strongest state of the feeds below, when one has a state: what the row shows while folded. */
  childState?: FeedState;
  /** False for an event category, which lists events by day and holds no feeds. */
  acceptsFeeds: boolean;
}

export interface NavModel {
  views: NavEntry[];
  /** The saved searches in their order, between the views and the categories. Empty where an app passes none. */
  savedSearches: NavEntry[];
  groups: NavGroup[];
  /** How many articles are starred, read or not. The web app shows it beside "スター". */
  starred: number;
}

export const GENERATED_LABEL = "AI生成";
export const FEEDS_LABEL = "購読フィード";
export const UNCATEGORIZED_LABEL = "未分類";
export const RECENTLY_READ_LABEL = "最近読んだ記事";
export const ANNOTATIONS_LABEL = "注釈";
export const SAVED_SEARCHES_LABEL = "保存した検索";

export function buildNav(input: { categories: Category[]; feeds: Feed[]; counts: Counts | undefined; savedSearches?: SavedSearch[] }): NavModel {
  const { categories, feeds, counts } = input;
  const ofSavedSearch = new Map(counts?.savedSearches.map((entry) => [entry.id, entry.unread]));
  const ofCategory = new Map(counts?.categories.map((entry) => [entry.categoryId, entry]));
  const ofFeed = new Map(counts?.feeds.map((entry) => [entry.feedId, entry.unread]));
  const feedEntry = (feed: Feed): NavEntry => {
    const state = feedState(feed);
    return { target: { type: "feed", feedId: feed.id }, label: feed.title, unread: ofFeed.get(feed.id) ?? 0, ...(state ? { state } : {}) };
  };
  const childStateOf = (own: Feed[]): Pick<NavGroup, "childState"> => {
    const state = strongestFeedState(own.map(feedState));
    return state ? { childState: state } : {};
  };

  const groups: NavGroup[] = categories
    .filter((category) => category.enabled)
    .map((category) => {
      const own = feeds.filter((feed) => feed.categoryId === category.id);
      const count = ofCategory.get(category.id);
      return {
        entry: { target: { type: "category", categoryId: category.id, generatedOnly: false }, label: category.name, unread: count?.unread ?? 0 },
        acceptsFeeds: category.kind === "news",
        ...childStateOf(own),
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
      acceptsFeeds: true,
      ...childStateOf(loose),
      children: loose.map(feedEntry),
    });
  }
  return {
    views: [
      { target: { type: "unread" }, label: "未読", unread: counts?.unread ?? 0 },
      { target: { type: "all" }, label: "すべて", unread: 0 },
      { target: { type: "starred" }, label: "スター", unread: 0 },
      { target: { type: "generated" }, label: GENERATED_LABEL, unread: counts?.generatedUnread ?? 0 },
      // An article is generated or a feed article, so what is unread and not generated came from a feed.
      { target: { type: "feeds" }, label: FEEDS_LABEL, unread: counts ? Math.max(0, counts.unread - counts.generatedUnread) : 0 },
      { target: { type: "recentlyRead" }, label: RECENTLY_READ_LABEL, unread: 0 },
      { target: { type: "annotations" }, label: ANNOTATIONS_LABEL, unread: 0 },
    ],
    savedSearches: (input.savedSearches ?? []).map((saved) => ({
      target: { type: "savedSearch", savedSearchId: saved.id },
      label: saved.name,
      unread: ofSavedSearch.get(saved.id) ?? 0,
    })),
    groups,
    starred: counts?.starred ?? 0,
  };
}

/**
 * The key the choice to hide entries without unread articles is stored under, in the browser and on the
 * device. Off is stored as no value at all.
 */
export const HIDE_READ_STORAGE_KEY = "smarternews.nav.hideRead";

/** The value stored while the entries without unread articles are hidden. */
export const HIDE_READ_ON = "on";

/** Whether a stored value stands for on. Nothing, or anything this version does not know, is off. */
export function parseHideRead(stored: string | null): boolean {
  return stored === HIDE_READ_ON;
}

/**
 * The model without the saved searches, the categories, the feeds and the generated articles of a category
 * that have no unread article. The views at the top stay. So do the open entry with the group above it, and a
 * feed whose fetches failed or stopped, or whose feed has gone, with its group: hiding it would hide that
 * something is wrong. A group keeps the `childState` of all its feeds, the hidden ones too. Until the counts
 * have arrived (`counted` false), every entry counts zero and nothing is hidden.
 */
export function hideEmptyEntries(model: NavModel, options: { current: ListTarget | null; counted: boolean }): NavModel {
  if (!options.counted) return model;
  const currentKey = options.current === null ? null : listKey(options.current);
  const isCurrent = (entry: NavEntry) => currentKey !== null && listKey(entry.target) === currentKey;
  const troubled = (entry: NavEntry) => entry.state === "failed" || entry.state === "stale" || entry.state === "gone";
  const keeps = (entry: NavEntry) => entry.unread > 0 || troubled(entry) || isCurrent(entry);
  const groups = model.groups.flatMap((group) => {
    const children = group.children.filter(keeps);
    return group.entry.unread > 0 || children.length > 0 || isCurrent(group.entry) ? [{ ...group, children }] : [];
  });
  return { ...model, savedSearches: model.savedSearches.filter(keeps), groups };
}

/** A short text that names a list, for a route or a stored choice. */
export function listKey(target: ListTarget): string {
  if (target.type === "category") return `category-${target.categoryId}${target.generatedOnly ? "-generated" : ""}`;
  if (target.type === "feed") return `feed-${target.feedId}`;
  if (target.type === "recentlyRead") return "recently-read";
  if (target.type === "savedSearch") return `search-${target.savedSearchId}`;
  return target.type;
}

export function parseListKey(key: string): ListTarget | null {
  if (key === "unread" || key === "all" || key === "starred" || key === "generated" || key === "feeds" || key === "uncategorized") return { type: key };
  if (key === "recently-read") return { type: "recentlyRead" };
  if (key === "annotations") return { type: "annotations" };
  const category = /^category-(\d{1,15})(-generated)?$/.exec(key);
  if (category) return { type: "category", categoryId: Number(category[1]), generatedOnly: category[2] !== undefined };
  const feed = /^feed-(\d{1,15})$/.exec(key);
  if (feed) return { type: "feed", feedId: Number(feed[1]) };
  const saved = /^search-(\d{1,15})$/.exec(key);
  return saved ? { type: "savedSearch", savedSearchId: Number(saved[1]) } : null;
}

/**
 * The part of the article list query that the target decides, with the order of its list. Newest first is
 * the server's default and is not sent.
 */
export function targetFilter(target: ListTarget, sort: ListSort = "newest"): ArticleListQuery {
  return { ...filterOf(target), ...(sort === "newest" ? {} : { order: sort }) };
}

function filterOf(target: ListTarget): ArticleListQuery {
  switch (target.type) {
    case "unread":
      return { unread: "true" };
    case "all":
      return {};
    case "starred":
      return { starred: "true" };
    case "generated":
      return { origin: "generated" };
    case "feeds":
      return { origin: "feed" };
    case "uncategorized":
      return { uncategorized: "true" };
    case "category":
      return { category: target.categoryId, ...(target.generatedOnly ? { origin: "generated" as const } : {}) };
    case "feed":
      return { feed: target.feedId };
    case "recentlyRead":
      return { recentlyRead: "true" };
    case "annotations":
      // A list of annotations, not of articles: it is read with `annotations` of the API.
      return {};
    case "savedSearch":
      // Search results, not an article list: they are read with `search` of the API.
      return {};
  }
}

/** The part of a mark-all-read that the target decides. */
export function targetScope(target: ListTarget): Omit<MarkRead, "before" | "minImportance"> {
  switch (target.type) {
    case "generated":
      return { origin: "generated" };
    case "feeds":
      return { origin: "feed" };
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

/** Whether the target is a category whose list holds events, ordered by start. */
function isEventCategory(target: ListTarget, categories: Category[] | undefined): boolean {
  return target.type === "category" && categories?.find((category) => category.id === target.categoryId)?.kind === "event";
}

/**
 * Whether the list offers the menu of its order. Not the recently read articles, ordered by read time, nor an
 * event category, ordered by start, nor a saved search: search results are newest first. Search results have
 * no target and no menu either.
 */
export function hasSortMenu(target: ListTarget, categories: Category[] | undefined): boolean {
  return target.type !== "recentlyRead" && target.type !== "annotations" && target.type !== "savedSearch" && !isEventCategory(target, categories);
}

/** The labels of the orders, as the menu of the order names them. */
export const SORT_LABELS: Record<ListSort, string> = { newest: "新しい順", oldest: "古い順", relevance: "関連度順", starred: "スターを付けた順" };

/**
 * The orders the menu of the list offers: newest and oldest first and by relevance, and for the starred
 * articles also the order they were starred in.
 */
export function sortOptionsOf(target: ListTarget): ListSort[] {
  const common: ListSort[] = ["newest", "oldest", "relevance"];
  return target.type === "starred" ? [...common, "starred"] : common;
}

/**
 * The order the list of the target is shown in: the one its list view keeps, newest first for an entry
 * without one, and always newest first where the order cannot be chosen. An order the menu of the entry does
 * not offer is newest first too.
 */
export function listSortOf(target: ListTarget, views: readonly StoredView[] | undefined, categories: Category[] | undefined): ListSort {
  if (!hasSortMenu(target, categories)) return "newest";
  const key = listKey(target);
  const sort = views?.find((view) => view.key === key)?.sort ?? "newest";
  return sortOptionsOf(target).includes(sort) ? sort : "newest";
}

/** A list view as the apps hold it: a setting it leaves out is the default. */
export type StoredView = Pick<ListView, "key"> & Partial<Pick<ListView, "sort" | "format">>;

/**
 * The list views as the server will answer them once it stores a change to one entry: the setting the change
 * leaves out keeps its value, and the entry is no longer listed once both settings are back to the defaults.
 * For the screens to take a change before the server answers.
 */
export function withViewChange(views: readonly StoredView[], key: string, patch: ListViewUpdate): ListView[] {
  const stored = views.find((view) => view.key === key);
  const sort = patch.sort ?? stored?.sort ?? "newest";
  const format = patch.format ?? stored?.format ?? "standard";
  const others = views.filter((view) => view.key !== key).map((view) => ({ sort: "newest" as const, format: "standard" as const, ...view }));
  return sort === "newest" && format === "standard" ? others : [...others, { key, sort, format }];
}

/** The formats of a list on the web, in the order the menu of the format offers them. */
export const FORMAT_OPTIONS: readonly ListFormat[] = ["standard", "compact", "expanded"];

/** The labels of the formats, as the menu of the format names them. */
export const FORMAT_LABELS: Record<ListFormat, string> = { standard: "標準", compact: "タイトルのみ", expanded: "展開" };

/**
 * The format the list of the target is shown in on the web: the one its list view keeps, and the standard one
 * for an entry without one and wherever the order cannot be chosen either, as the format is kept by the same
 * entries as the order.
 */
export function listFormatOf(target: ListTarget, views: readonly StoredView[] | undefined, categories: Category[] | undefined): ListFormat {
  if (!hasSortMenu(target, categories)) return "standard";
  const key = listKey(target);
  return views?.find((view) => view.key === key)?.format ?? "standard";
}

/** Whether the list shows unread articles only until the reader asks for the read ones too. */
export function hasReadToggle(target: ListTarget): boolean {
  return target.type !== "unread" && target.type !== "all" && target.type !== "starred" && target.type !== "recentlyRead" && target.type !== "annotations";
}

/**
 * Whether the list may offer mark all as read and the toggle for importance 4 and above. Not the recently
 * read articles: everything there is read already, and a lower bound on importance would hide every feed
 * article in a list meant for finding what was read. Nor a saved search: its words match parts of the text,
 * so marking everything would take articles not meant, as in any search.
 */
export function hasListControls(target: ListTarget): boolean {
  return target.type !== "recentlyRead" && target.type !== "annotations" && target.type !== "savedSearch";
}

/**
 * Whether the list may offer the toggle for importance 4 and above. Feed articles have no importance, so it
 * is offered only where generated articles can be listed: not in the lists that hold feed articles alone.
 */
export function hasImportanceFilter(target: ListTarget): boolean {
  return hasListControls(target) && target.type !== "feed" && target.type !== "feeds" && target.type !== "uncategorized";
}
