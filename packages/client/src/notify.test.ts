import type { ArticleSummary } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { baselineFrom, minImportanceFor, NOTIFY_SETTING_LABEL, planNotifications } from "./notify.ts";

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
    importance: 5,
    unconfirmed: false,
    firstPublishedAt: "2026-03-01T06:00:00.000Z",
    updatedAt: "2026-03-01T06:00:00.000Z",
    revision: 0,
    isRead: false,
    readAt: null,
    openedAt: null,
    starred: false,
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

  it("notifies both when set to all", () => {
    const plan = planNotifications({ setting: "all", articles: [article({ importance: 5 }), article({ importance: 3, categoryId: 2 })], checkedAt: CHECKED, categories });
    expect(plan.notifications.map((entry) => entry.body).sort()).toEqual(["Cars", "Security"]);
  });

  it("never notifies a feed article, even when set to all", () => {
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
    expect(plan).toEqual({ notifications: [], checkedAt: CHECKED });
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
