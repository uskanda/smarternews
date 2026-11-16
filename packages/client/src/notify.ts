// Which new articles a device tells its user about. The device asks the server from time to time; this decides,
// from what came back, what to notify and how far the device has now looked. All times are the server's, so a
// device whose clock is off neither misses an article nor repeats one.
import type { ArticleSummary, RuleNotification } from "@smarternews/core/api";

/**
 * Importance 5 only, every new generated article, or nothing. Of the feed articles, only those a rule made
 * ones to notify are notified, under either of the first two.
 */
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
  /**
   * When the newest of the feed articles a rule made ones to notify was made one, of those looked at so far.
   * Stored, and passed to the next check. Null only while notifications are off and none was looked at yet.
   */
  ruleCheckedAt: string | null;
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
  /** The feed articles a rule made ones to notify, as the server listed them. */
  ruled?: RuleNotification[];
  /**
   * Where the last check left the feed articles a rule made ones to notify. Null on a device that never looked
   * at them: this check only records where they stand, so that none made before is notified.
   */
  ruleCheckedAt?: string | null;
}): NotifyPlan {
  const ruled = input.ruled ?? [];
  const ruleCheckedBefore = input.ruleCheckedAt ?? null;
  if (input.setting === "off") return { notifications: [], checkedAt: input.checkedAt, ruleCheckedAt: ruleCheckedBefore };
  const threshold = minImportanceFor(input.setting) ?? 1;
  const importanceOf = (item: ArticleSummary): number => item.importance ?? 0;
  const fresh = input.articles
    .filter((item) => item.origin === "generated" && !item.isRead && importanceOf(item) >= threshold && item.updatedAt > input.checkedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  // Whatever its importance, which a feed article has not: the reader chose it by writing the rule.
  const freshRuled =
    ruleCheckedBefore === null
      ? []
      : ruled
          .filter((entry) => !entry.article.isRead && entry.notifiedAt > ruleCheckedBefore)
          .sort((a, b) => b.notifiedAt.localeCompare(a.notifiedAt) || b.article.id - a.article.id);
  const checkedAt = baselineFrom([{ updatedAt: input.checkedAt }, ...input.articles]);
  const ruleCheckedAt = ruled.reduce((latest, entry) => (entry.notifiedAt > latest ? entry.notifiedAt : latest), ruleCheckedBefore ?? BEGINNING);
  const count = fresh.length + freshRuled.length;
  if (count >= FOLD_FROM) {
    const top = [...fresh].sort((a, b) => importanceOf(b) - importanceOf(a) || b.updatedAt.localeCompare(a.updatedAt))[0] ?? freshRuled[0]!.article;
    return { notifications: [{ kind: "summary", count, title: `新着の記事が${count}件あります`, body: top.title }], checkedAt, ruleCheckedAt };
  }
  const names = new Map(input.categories.map((category) => [category.id, category.name]));
  return {
    notifications: [
      ...fresh.map((item): PlannedNotification => ({
        kind: "article",
        articleId: item.id,
        title: item.title,
        body: (item.categoryId === null ? undefined : names.get(item.categoryId)) ?? "",
      })),
      ...freshRuled.map((entry): PlannedNotification => ({ kind: "article", articleId: entry.article.id, title: entry.article.title, body: entry.feedTitle })),
    ],
    checkedAt,
    ruleCheckedAt,
  };
}

/** Where to start looking at the feed articles a rule made ones to notify: none made so far is notified later. */
export function ruleBaselineFrom(newest: Pick<RuleNotification, "notifiedAt">[]): string {
  return newest.reduce((latest, entry) => (entry.notifiedAt > latest ? entry.notifiedAt : latest), BEGINNING);
}

/** The title of the notification of a digest. */
export const DIGEST_NOTIFICATION_TITLE = "ダイジェスト";
/** How much of the executive summary the notification of a digest shows. */
const DIGEST_BODY_CHARS = 100;

export interface DigestNotifyPlan {
  notification: { digestId: number; title: string; body: string } | null;
  /** The id of the newest digest the device knows of. Stored, and passed to the next check. */
  notifiedId: number | null;
}

/**
 * Whether the latest digest is notified. It is notified once, when it is newer than the one the device knows of.
 * A device that knows of none yet only records where it stands: the digests made before notifications were on
 * are not notified. A digest is never folded into the notification that sums up many articles.
 */
export function planDigestNotification(input: {
  setting: NotifySetting;
  latest: { id: number; executiveSummary: string } | null;
  notifiedId: number | null;
}): DigestNotifyPlan {
  const { setting, latest, notifiedId } = input;
  if (setting === "off") return { notification: null, notifiedId };
  if (notifiedId === null) return { notification: null, notifiedId: latest?.id ?? 0 };
  if (latest === null || latest.id <= notifiedId) return { notification: null, notifiedId };
  const chars = [...latest.executiveSummary];
  const body = chars.length > DIGEST_BODY_CHARS ? `${chars.slice(0, DIGEST_BODY_CHARS - 1).join("")}…` : latest.executiveSummary;
  return { notification: { digestId: latest.id, title: DIGEST_NOTIFICATION_TITLE, body }, notifiedId: latest.id };
}
