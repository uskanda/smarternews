// Which new articles a device tells its user about. The device asks the server from time to time; this decides,
// from what came back, what to notify and how far the device has now looked. All times are the server's, so a
// device whose clock is off neither misses an article nor repeats one.
import type { ArticleSummary } from "@smarternews/core/api";

/** Importance 5 only, every new generated article, or nothing. Feed articles are never notified. */
export type NotifySetting = "important" | "all" | "off";

export const DEFAULT_NOTIFY_SETTING: NotifySetting = "important";

export const NOTIFY_SETTING_LABEL: Record<NotifySetting, string> = {
  important: "重要度5だけ",
  all: "AI生成のすべての新着",
  off: "出さない",
};

/** From this many articles in one check on, they are folded into one notification. */
const FOLD_FROM = 4;

/** Sorts before the update time of any article. Not the empty string: some stores do not keep one. */
export const BEGINNING = "0000-01-01T00:00:00.000Z";

export type PlannedNotification =
  | { kind: "article"; articleId: number; title: string; body: string }
  | { kind: "summary"; count: number; title: string; body: string };

export interface NotifyPlan {
  notifications: PlannedNotification[];
  /** The update time of the newest article looked at so far. Stored, and passed to the next check. */
  checkedAt: string;
}

/** The `minImportance` to ask the server for. */
export function minImportanceFor(setting: Exclude<NotifySetting, "off">): number | undefined {
  return setting === "important" ? 5 : undefined;
}

/** Where to start when notifications are turned on: nothing that exists now is notified later. */
export function baselineFrom(newestArticles: Pick<ArticleSummary, "updatedAt">[]): string {
  return newestArticles.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), BEGINNING);
}

export function planNotifications(input: {
  setting: NotifySetting;
  /** Unread articles as the server listed them. */
  articles: ArticleSummary[];
  checkedAt: string;
  categories: Array<{ id: number; name: string }>;
}): NotifyPlan {
  if (input.setting === "off") return { notifications: [], checkedAt: input.checkedAt };
  const threshold = minImportanceFor(input.setting) ?? 1;
  const importanceOf = (item: ArticleSummary): number => item.importance ?? 0;
  const fresh = input.articles
    .filter((item) => item.origin === "generated" && !item.isRead && importanceOf(item) >= threshold && item.updatedAt > input.checkedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  const checkedAt = baselineFrom([{ updatedAt: input.checkedAt }, ...input.articles]);
  if (fresh.length >= FOLD_FROM) {
    const top = [...fresh].sort((a, b) => importanceOf(b) - importanceOf(a) || b.updatedAt.localeCompare(a.updatedAt))[0]!;
    return { notifications: [{ kind: "summary", count: fresh.length, title: `新着の記事が${fresh.length}件あります`, body: top.title }], checkedAt };
  }
  const names = new Map(input.categories.map((category) => [category.id, category.name]));
  return {
    notifications: fresh.map((item) => ({ kind: "article", articleId: item.id, title: item.title, body: (item.categoryId === null ? undefined : names.get(item.categoryId)) ?? "" })),
    checkedAt,
  };
}
