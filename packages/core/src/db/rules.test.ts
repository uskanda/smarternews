import { describe, expect, it } from "vitest";
import type { FilterCondition, RuleCreate } from "../api.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { getArticle, setArticleFlags } from "./articles.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { deleteFeed } from "./feeds.ts";
import { applyFilters, createFilter } from "./filters.ts";
import { applyRules, createRule, deleteRule, listRuleNotifications, listRules, previewRule, updateRule } from "./rules.ts";

const clock = fakeClock("2026-03-01T12:00:00.000Z");
const NOW = "2026-03-01T12:00:00.000Z";

const title = (value: string): FilterCondition => ({ fields: ["title"], match: "contains", value });
const rule = (conditions: FilterCondition[], actions: RuleCreate["actions"], scope: RuleCreate["scope"] = { type: "all" }): RuleCreate => ({
  scope,
  conditions,
  actions,
});

function flags(db: Database, id: number) {
  const row = db.prepare("SELECT is_read, read_at, starred, rule_notify_at, rule_summary_requested_at FROM articles WHERE id = ?").get(id)!;
  return {
    isRead: row.is_read === 1,
    readAt: row.read_at,
    starred: row.starred === 1,
    notifyAt: row.rule_notify_at,
    summaryAt: row.rule_summary_requested_at,
  };
}

describe("registering a rule", () => {
  it("keeps its scope, conditions and actions, the actions in a fixed order", () => {
    const db = createTestDb();
    const created = createRule(db, rule([title("障害")], ["notify", "star"]), clock);
    expect(created).toMatchObject({ scope: { type: "all" }, conditions: [title("障害")], actions: ["star", "notify"], enabled: true, createdAt: NOW });
    expect(listRules(db)).toEqual([created]);
  });

  it("refuses a rule without an action", () => {
    const db = createTestDb();
    expect(() => createRule(db, rule([title("x")], []), clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "actions" })] }),
    );
    expect(listRules(db)).toEqual([]);
  });

  it("refuses a regular expression it cannot use and a scope that names nothing", () => {
    const db = createTestDb();
    expect(() => createRule(db, rule([{ fields: ["title"], match: "regex", value: "(sale" }], ["star"]), clock)).toThrow(
      expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "conditions.0.value", code: "format" })] }),
    );
    expect(() => createRule(db, rule([title("x")], ["star"], { type: "feed", feedId: 99 }), clock)).toThrow(
      expect.objectContaining({ fields: [{ path: "scope.feedId", message: "no such feed", code: "no_such_item" }] }),
    );
  });

  it("refuses the same rule twice, however the value is written, but not one with other actions", () => {
    const db = createTestDb();
    createRule(db, rule([title("PR")], ["star", "read"]), clock);
    expect(() => createRule(db, rule([title("ｐｒ")], ["read", "star"]), clock)).toThrow(/already registered/);
    createRule(db, rule([title("PR")], ["star"]), clock);
    expect(listRules(db)).toHaveLength(2);
  });

  it("changes, switches and removes a rule", () => {
    const db = createTestDb();
    const { id } = createRule(db, rule([title("x")], ["star"]), clock);
    expect(updateRule(db, id, { actions: ["star", "read"], enabled: false })).toMatchObject({ actions: ["star", "read"], enabled: false });
    deleteRule(db, id);
    expect(listRules(db)).toEqual([]);
    expect(() => deleteRule(db, id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => updateRule(db, id, { enabled: true })).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("goes with the feed or the category of its scope", () => {
    const db = createTestDb();
    const categoryId = createCategory(db, { slug: "tech", name: "Tech", kind: "news" }, clock).id;
    const feed = seedFeed(db);
    createRule(db, rule([title("x")], ["star"], { type: "feed", feedId: feed }), clock);
    createRule(db, rule([title("x")], ["star"], { type: "category", categoryId }), clock);
    createRule(db, rule([title("x")], ["star"]), clock);

    deleteFeed(db, feed);
    deleteCategory(db, categoryId);

    expect(listRules(db).map((each) => each.scope)).toEqual([{ type: "all" }]);
  });
});

describe("applying the rules to a new feed article", () => {
  it("does what every enabled rule it meets says, and nothing for the rules it does not meet", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    createRule(db, rule([title("障害")], ["star"]), clock);
    createRule(db, rule([title("障害")], ["summarize"]), clock);
    createRule(db, rule([title("特売")], ["read"]), clock);
    const id = seedFeedArticle(db, feed, { title: "大規模な障害" });

    applyRules(db, id, NOW);

    expect(flags(db, id)).toEqual({ isRead: false, readAt: null, starred: true, notifyAt: null, summaryAt: NOW });
  });

  it("marks the article read without making it one to notify when a rule also marks it read", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    createRule(db, rule([title("障害")], ["notify"]), clock);
    createRule(db, rule([title("障害")], ["read"]), clock);
    const id = seedFeedArticle(db, feed, { title: "障害" });

    applyRules(db, id, NOW);

    expect(flags(db, id)).toMatchObject({ isRead: true, readAt: NOW, notifyAt: null });
  });

  it("makes the article one to notify when it is left unread", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    createRule(db, rule([title("障害")], ["notify"]), clock);
    const id = seedFeedArticle(db, feed, { title: "障害" });

    applyRules(db, id, NOW);

    expect(flags(db, id)).toMatchObject({ isRead: false, notifyAt: NOW });
  });

  it("leaves a disabled rule alone", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    createRule(db, { ...rule([title("障害")], ["star"]), enabled: false }, clock);
    const id = seedFeedArticle(db, feed, { title: "障害" });

    applyRules(db, id, NOW);

    expect(flags(db, id).starred).toBe(false);
  });

  it("applies a rule to the feed or category of its scope only", () => {
    const db = createTestDb();
    const categoryId = createCategory(db, { slug: "tech", name: "Tech", kind: "news" }, clock).id;
    const a = seedFeed(db, { categoryId });
    const b = seedFeed(db);
    createRule(db, rule([title("Release")], ["star"], { type: "feed", feedId: a }), clock);
    createRule(db, rule([title("Release")], ["read"], { type: "category", categoryId }), clock);
    const inA = seedFeedArticle(db, a, { title: "Release 2.0" });
    const inB = seedFeedArticle(db, b, { title: "Release 2.0" });

    applyRules(db, inA, NOW);
    applyRules(db, inB, NOW);

    expect(flags(db, inA)).toMatchObject({ starred: true, isRead: true });
    expect(flags(db, inB)).toMatchObject({ starred: false, isRead: false });
  });

  it("does nothing to an article that filters hide or that is a hidden duplicate", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const other = seedFeed(db);
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [title("PR")] }, clock);
    createRule(db, rule([title("新製品")], ["star", "notify"]), clock);
    const hidden = seedFeedArticle(db, feed, { title: "【PR】新製品" });
    applyFilters(db, hidden);
    const kept = seedFeedArticle(db, feed, { title: "新製品" });
    const duplicate = seedFeedArticle(db, other, { title: "新製品", duplicateOf: kept });

    applyRules(db, hidden, NOW);
    applyRules(db, duplicate, NOW);

    expect(flags(db, hidden)).toMatchObject({ starred: false, notifyAt: null });
    expect(flags(db, duplicate)).toMatchObject({ starred: false, notifyAt: null });
  });

  it("leaves a generated article alone", () => {
    const db = createTestDb();
    createRule(db, rule([title("x")], ["star"]), clock);
    const categoryId = createCategory(db, { slug: "tech", name: "Tech", kind: "news" }, clock).id;
    const id = Number(
      db
        .prepare(
          `INSERT INTO articles (category_id, origin, kind, title, summary, body, importance, first_published_at, updated_at, created_at)
           VALUES (?, 'generated', 'news', 'x', 's', 'b', 3, ?, ?, ?)`,
        )
        .run(categoryId, NOW, NOW, NOW).lastInsertRowid,
    );

    applyRules(db, id, NOW);

    expect(getArticle(db, id).starred).toBe(false);
  });
});

describe("counting before saving", () => {
  it("counts the stored feed articles of the scope the rule meets, leaving out the hidden ones, and changes nothing", () => {
    const db = createTestDb();
    const a = seedFeed(db);
    const b = seedFeed(db);
    const first = seedFeedArticle(db, a, { title: "障害 1" });
    seedFeedArticle(db, a, { title: "障害 2", isRead: true });
    seedFeedArticle(db, b, { title: "障害 3" });
    seedFeedArticle(db, a, { title: "障害 4", duplicateOf: first });
    createFilter(db, { action: "hide", scope: { type: "all" }, conditions: [title("障害 2")] }, clock);

    expect(previewRule(db, { scope: { type: "all" }, conditions: [title("障害")] })).toEqual({ matchCount: 2 });
    expect(previewRule(db, { scope: { type: "feed", feedId: a }, conditions: [title("障害")] })).toEqual({ matchCount: 1 });
    expect(flags(db, first)).toMatchObject({ starred: false, isRead: false });
    expect(listRules(db)).toEqual([]);
  });

  it("refuses a regular expression it cannot use", () => {
    const db = createTestDb();
    expect(() => previewRule(db, { scope: { type: "all" }, conditions: [{ fields: ["title"], match: "regex", value: "(sale" }] })).toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
  });
});

describe("the feed articles to notify", () => {
  it("lists the unread ones a rule made ones to notify after the given time, newest first, with their feed", () => {
    const db = createTestDb();
    const feed = seedFeed(db, { title: "Status" });
    createRule(db, rule([title("障害")], ["notify"]), clock);
    const early = seedFeedArticle(db, feed, { title: "障害 1" });
    applyRules(db, early, "2026-03-01T10:00:00.000Z");
    const later = seedFeedArticle(db, feed, { title: "障害 2", at: "2026-02-01T00:00:00.000Z" });
    applyRules(db, later, "2026-03-01T11:00:00.000Z");
    const latest = seedFeedArticle(db, feed, { title: "障害 3" });
    applyRules(db, latest, "2026-03-01T11:30:00.000Z");
    const read = seedFeedArticle(db, feed, { title: "障害 4" });
    applyRules(db, read, "2026-03-01T11:45:00.000Z");
    setArticleFlags(db, read, { isRead: true }, NOW);
    seedFeedArticle(db, feed, { title: "ほか" });

    const list = listRuleNotifications(db, { after: "2026-03-01T10:30:00.000Z" });

    expect(list.items.map((item) => [item.article.title, item.notifiedAt, item.feedTitle])).toEqual([
      ["障害 3", "2026-03-01T11:30:00.000Z", "Status"],
      ["障害 2", "2026-03-01T11:00:00.000Z", "Status"],
    ]);
    expect(listRuleNotifications(db, {}).items).toHaveLength(3);
    expect(listRuleNotifications(db, { limit: 1 }).items.map((item) => item.article.title)).toEqual(["障害 3"]);
  });
});
