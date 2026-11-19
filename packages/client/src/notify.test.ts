import type { ArticleSummary } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { baselineFrom, BEGINNING, minImportanceFor, NOTIFY_SETTING_LABEL, planDigestNotification, planNotifications } from "./notify.ts";

let serial = 0;
function article(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  serial += 1;
  return {
    id: serial,
    categoryId: 1,
    origin: "generated",
    feedId: null,
    author: null,
    kind: "news",
    title: `Article ${serial}`,
    translatedTitle: null,
    summary: "",
    impact: null,
    updateNote: null,
    importance: 5,
    unconfirmed: false,
    firstPublishedAt: "2026-03-01T06:00:00.000Z",
    updatedAt: "2026-03-01T06:00:00.000Z",
    rankAt: "2026-03-01T06:00:00.000Z",
    revision: 0,
    isRead: false,
    readAt: null,
    openedAt: null,
    starred: false,
    starredAt: null,
    followsStarred: false,
    unreadFollowUps: 0,
    primaryUrl: null,
    refCount: 1,
    event: null,
    ...overrides,
  };
}

const categories = [
  { id: 1, name: "Security" },
  { id: 2, name: "Cars" },
];
const CHECKED = "2026-03-01T00:00:00.000Z";

describe("minImportanceFor", () => {
  it("asks the server for importance 5 only, for everything, or for nothing", () => {
    expect(minImportanceFor("important")).toBe(5);
    expect(minImportanceFor("all")).toBeUndefined();
  });
});

describe("planNotifications", () => {
  it("notifies an article of importance 5 and not one of importance 3 when set to important only", () => {
    const high = article({ title: "Zero-day", importance: 5 });
    const plan = planNotifications({ setting: "important", articles: [high, article({ importance: 3 })], checkedAt: CHECKED, categories });
    expect(plan.notifications).toEqual([{ kind: "article", articleId: high.id, title: "Zero-day", body: "Security" }]);
  });

  it("notifies a follow-up of a starred story and a rewritten starred article whatever their importance", () => {
    const followUp = article({ title: "Later on the starred story", importance: 3, followsStarred: true, updatedAt: "2026-03-01T07:00:00.000Z" });
    const rewritten = article({ title: "Starred, rewritten", importance: 3, starred: true, revision: 1, updatedAt: "2026-03-01T06:30:00.000Z" });
    const plain = article({ importance: 3 });
    const plan = planNotifications({ setting: "important", articles: [followUp, rewritten, plain], checkedAt: CHECKED, categories });
    expect(plan.notifications.map((entry) => entry.kind === "article" && entry.articleId)).toEqual([followUp.id, rewritten.id]);
  });

  it("notifies no follow-up of a starred story when set to off, nor a starred feed article", () => {
    const followUp = article({ importance: 3, followsStarred: true });
    expect(planNotifications({ setting: "off", articles: [followUp], checkedAt: CHECKED, categories }).notifications).toEqual([]);
    const delivered = article({ origin: "feed", feedId: 4, importance: null, starred: true });
    expect(planNotifications({ setting: "important", articles: [delivered], checkedAt: CHECKED, categories }).notifications).toEqual([]);
  });

  it("notifies both when set to all", () => {
    const plan = planNotifications({ setting: "all", articles: [article({ importance: 5 }), article({ importance: 3, categoryId: 2 })], checkedAt: CHECKED, categories });
    expect(plan.notifications.map((entry) => entry.body).sort()).toEqual(["Cars", "Security"]);
  });

  it("does not notify a feed article that no rule made one to notify, even when set to all", () => {
    const generated = article({ updatedAt: "2026-03-01T07:00:00.000Z", importance: 2 });
    const delivered = article({ origin: "feed", feedId: 4, importance: null, updatedAt: "2026-03-01T08:00:00.000Z" });

    const plan = planNotifications({ setting: "all", articles: [generated, delivered], checkedAt: "2026-03-01T06:30:00.000Z", categories: [] });

    expect(plan.notifications).toEqual([{ kind: "article", articleId: generated.id, title: generated.title, body: "" }]);
    // The feed article was looked at all the same, so the next check starts after it.
    expect(plan.checkedAt).toBe("2026-03-01T08:00:00.000Z");
  });

  it("names the setting for every new article after what it covers", () => {
    expect(NOTIFY_SETTING_LABEL.all).toBe("AI生成のすべての新着");
  });

  it("notifies nothing when set to off, and leaves the checked time alone", () => {
    const plan = planNotifications({ setting: "off", articles: [article()], checkedAt: CHECKED, categories });
    expect(plan).toEqual({ notifications: [], checkedAt: CHECKED, ruleCheckedAt: null });
  });

  it("leaves out an article that was read elsewhere", () => {
    const plan = planNotifications({ setting: "all", articles: [article({ isRead: true })], checkedAt: CHECKED, categories });
    expect(plan.notifications).toEqual([]);
  });

  it("does not notify an article again that was not updated since the last check", () => {
    const seen = article({ updatedAt: "2026-03-01T06:00:00.000Z" });
    const first = planNotifications({ setting: "all", articles: [seen], checkedAt: CHECKED, categories });
    expect(first.notifications).toHaveLength(1);
    const second = planNotifications({ setting: "all", articles: [seen], checkedAt: first.checkedAt, categories });
    expect(second.notifications).toEqual([]);
    expect(second.checkedAt).toBe(first.checkedAt);
  });

  it("notifies an article again after a follow-up updated it", () => {
    const seen = article({ updatedAt: "2026-03-01T06:00:00.000Z" });
    const first = planNotifications({ setting: "all", articles: [seen], checkedAt: CHECKED, categories });
    const updated = { ...seen, updatedAt: "2026-03-01T09:00:00.000Z", revision: 1 };
    const second = planNotifications({ setting: "all", articles: [updated], checkedAt: first.checkedAt, categories });
    expect(second.notifications).toMatchObject([{ kind: "article", articleId: seen.id }]);
  });

  it("does not notify articles that were there before notifications were turned on", () => {
    const old = [article({ updatedAt: "2026-03-01T05:00:00.000Z" }), article({ updatedAt: "2026-03-01T06:00:00.000Z" })];
    const baseline = baselineFrom(old);
    const later = article({ updatedAt: "2026-03-01T07:00:00.000Z" });
    const plan = planNotifications({ setting: "important", articles: [later, ...old], checkedAt: baseline, categories });
    expect(plan.notifications).toMatchObject([{ articleId: later.id }]);
  });

  it("starts from the beginning of time when the server has no article yet", () => {
    const baseline = baselineFrom([]);
    const plan = planNotifications({ setting: "all", articles: [article()], checkedAt: baseline, categories });
    expect(plan.notifications).toHaveLength(1);
  });

  it("gives up to three articles a notification each, newest first", () => {
    const articles = [
      article({ title: "Older", updatedAt: "2026-03-01T05:00:00.000Z" }),
      article({ title: "Newest", updatedAt: "2026-03-01T07:00:00.000Z" }),
      article({ title: "Middle", updatedAt: "2026-03-01T06:00:00.000Z" }),
    ];
    const plan = planNotifications({ setting: "all", articles, checkedAt: CHECKED, categories });
    expect(plan.notifications.map((entry) => entry.title)).toEqual(["Newest", "Middle", "Older"]);
  });

  it("folds four or more articles into one notification with the count and the top headline", () => {
    const articles = [
      article({ title: "Routine", importance: 3, updatedAt: "2026-03-01T08:00:00.000Z" }),
      article({ title: "Critical", importance: 5, updatedAt: "2026-03-01T06:00:00.000Z" }),
      ...Array.from({ length: 4 }, () => article({ importance: 4 })),
    ];
    const plan = planNotifications({ setting: "all", articles, checkedAt: CHECKED, categories });
    expect(plan.notifications).toEqual([{ kind: "summary", count: 6, title: "新着の記事が6件あります", body: "Critical" }]);
  });

  it("moves the checked time to the newest article it looked at", () => {
    const plan = planNotifications({
      setting: "all",
      articles: [article({ updatedAt: "2026-03-01T05:00:00.000Z" }), article({ updatedAt: "2026-03-01T07:30:00.000Z" })],
      checkedAt: CHECKED,
      categories,
    });
    expect(plan.checkedAt).toBe("2026-03-01T07:30:00.000Z");
  });

  it("names a category it does not know by nothing rather than failing", () => {
    const plan = planNotifications({ setting: "all", articles: [article({ categoryId: 99 })], checkedAt: CHECKED, categories });
    expect(plan.notifications[0]).toMatchObject({ body: "" });
  });
});

describe("planNotifications with feed articles a rule made ones to notify", () => {
  const RULE_CHECKED = "2026-03-01T06:00:00.000Z";
  const ruled = (notifiedAt: string, overrides: Partial<ArticleSummary> = {}, feedTitle = "Status") => ({
    notifiedAt,
    feedTitle,
    // A feed article dated long before: what counts is when the rule made it one to notify.
    article: article({ origin: "feed", feedId: 4, importance: null, categoryId: null, updatedAt: "2026-01-01T00:00:00.000Z", ...overrides }),
  });

  it("notifies them with their feed's name even when set to importance 5 only", () => {
    const entry = ruled("2026-03-01T07:00:00.000Z", { title: "障害" });
    const plan = planNotifications({ setting: "important", articles: [], checkedAt: CHECKED, categories, ruled: [entry], ruleCheckedAt: RULE_CHECKED });
    expect(plan.notifications).toEqual([{ kind: "article", articleId: entry.article.id, title: "障害", body: "Status" }]);
    expect(plan.ruleCheckedAt).toBe("2026-03-01T07:00:00.000Z");
  });

  it("leaves out the ones made before the last check and the read ones", () => {
    const plan = planNotifications({
      setting: "all",
      articles: [],
      checkedAt: CHECKED,
      categories,
      ruled: [ruled("2026-03-01T05:00:00.000Z"), ruled("2026-03-01T07:00:00.000Z", { isRead: true })],
      ruleCheckedAt: RULE_CHECKED,
    });
    expect(plan.notifications).toEqual([]);
    expect(plan.ruleCheckedAt).toBe("2026-03-01T07:00:00.000Z");
  });

  it("only records where they stand on a device that never looked at them", () => {
    const plan = planNotifications({ setting: "important", articles: [], checkedAt: CHECKED, categories, ruled: [ruled("2026-03-01T07:00:00.000Z")], ruleCheckedAt: null });
    expect(plan.notifications).toEqual([]);
    expect(plan.ruleCheckedAt).toBe("2026-03-01T07:00:00.000Z");
    expect(planNotifications({ setting: "important", articles: [], checkedAt: CHECKED, categories, ruled: [], ruleCheckedAt: null }).ruleCheckedAt).toBe(BEGINNING);
  });

  it("counts them with the generated articles, and folds four together", () => {
    const generated = [article({ title: "Critical", importance: 5, updatedAt: "2026-03-01T06:00:00.000Z" }), article({ importance: 4 })];
    const plan = planNotifications({
      setting: "all",
      articles: generated,
      checkedAt: CHECKED,
      categories,
      ruled: [ruled("2026-03-01T07:00:00.000Z"), ruled("2026-03-01T07:10:00.000Z")],
      ruleCheckedAt: RULE_CHECKED,
    });
    expect(plan.notifications).toEqual([{ kind: "summary", count: 4, title: "新着の記事が4件あります", body: "Critical" }]);
  });

  it("heads a fold of feed articles alone with the latest of them", () => {
    const entries = ["一", "二", "三", "四"].map((title, index) => ruled(`2026-03-01T07:0${index}:00.000Z`, { title }));
    const plan = planNotifications({ setting: "important", articles: [], checkedAt: CHECKED, categories, ruled: entries, ruleCheckedAt: RULE_CHECKED });
    expect(plan.notifications).toEqual([{ kind: "summary", count: 4, title: "新着の記事が4件あります", body: "四" }]);
  });

  it("notifies nothing when set to off, and leaves both marks alone", () => {
    const plan = planNotifications({ setting: "off", articles: [], checkedAt: CHECKED, categories, ruled: [ruled("2026-03-01T07:00:00.000Z")], ruleCheckedAt: RULE_CHECKED });
    expect(plan).toEqual({ notifications: [], checkedAt: CHECKED, ruleCheckedAt: RULE_CHECKED });
  });
});

describe("planDigestNotification", () => {
  const digest = (id: number, executiveSummary = "朝のまとめです。") => ({ id, executiveSummary });

  it("notifies a digest newer than the one notified last, under the title and with the start of its summary", () => {
    const plan = planDigestNotification({ setting: "important", latest: digest(3, "あ".repeat(300)), notifiedId: 2 });
    expect(plan.notification).toEqual({ digestId: 3, title: "ダイジェスト", body: `${"あ".repeat(99)}…` });
    expect(plan.notifiedId).toBe(3);
    expect(planDigestNotification({ setting: "all", latest: digest(3), notifiedId: 2 }).notification?.body).toBe("朝のまとめです。");
  });

  it("notifies nothing when notifications are off, and keeps the mark", () => {
    expect(planDigestNotification({ setting: "off", latest: digest(3), notifiedId: 2 })).toEqual({ notification: null, notifiedId: 2 });
  });

  it("does not notify the same digest again", () => {
    expect(planDigestNotification({ setting: "important", latest: digest(3), notifiedId: 3 })).toEqual({ notification: null, notifiedId: 3 });
  });

  it("only records where it stands on a device that never looked, so that older digests are not notified", () => {
    expect(planDigestNotification({ setting: "important", latest: digest(3), notifiedId: null })).toEqual({ notification: null, notifiedId: 3 });
    // Without any digest yet, the first one made later is notified.
    expect(planDigestNotification({ setting: "important", latest: null, notifiedId: null })).toEqual({ notification: null, notifiedId: 0 });
    expect(planDigestNotification({ setting: "important", latest: digest(1), notifiedId: 0 }).notification).toMatchObject({ digestId: 1 });
  });

  it("is never folded into the notification that sums up four articles or more", () => {
    const articles = Array.from({ length: 3 }, () => article({ updatedAt: "2026-03-01T07:00:00.000Z" }));
    const plan = planNotifications({ setting: "important", articles, checkedAt: "2026-03-01T06:30:00.000Z", categories: [] });
    expect(plan.notifications.filter((entry) => entry.kind === "article")).toHaveLength(3);
    expect(planDigestNotification({ setting: "important", latest: digest(5), notifiedId: 4 }).notification).not.toBeNull();
  });
});
