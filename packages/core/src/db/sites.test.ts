import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { insertArticle, recordArticleOpened, setArticleFlags } from "./articles.ts";
import { acceptCandidates, insertCandidate } from "./candidates.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import { createRun } from "./runs.ts";
import { blockedHosts, blockSite, siteStats, unblockSite } from "./sites.ts";

const NOW = new Date("2026-03-31T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function setup() {
  const clock = fakeClock(NOW.toISOString());
  const db = createTestDb();
  const categoryId = createCategory(db, { name: "Security", kind: "news" }, clock).id;
  const otherCategoryId = createCategory(db, { name: "Other", kind: "news" }, clock).id;
  const run = createRun(db, { categoryId, trigger: "manual", slot: null }, clock);
  let serial = 0;
  const candidate = (host: string, options: { status?: "rejected" | "pending"; at?: string; category?: number } = {}) => {
    serial += 1;
    return insertCandidate(db, {
      categoryId: options.category ?? categoryId,
      runId: run.id,
      url: `https://${host || "news.google.com"}/${serial}`,
      fetchable: true,
      title: `Story ${serial}`,
      snippet: "",
      siteName: "",
      siteHost: host,
      publishedAt: null,
      sourceKind: "feed",
      status: options.status ?? "rejected",
      reason: "why",
      reasonCode: null,
      importance: 3,
      topicIds: [],
      now: options.at ?? daysAgo(1),
    });
  };
  const article = () =>
    insertArticle(db, {
      categoryId,
      kind: "news",
      title: "Story",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: daysAgo(1),
      previousArticleId: null,
      refs: [],
      topicIds: [],
    });
  const accept = (ids: number[], articleId: number) => acceptCandidates(db, ids, articleId, `g${articleId}`, run.id);
  const stats = () => siteStats(db, categoryId, NOW);
  return { db, clock, categoryId, otherCategoryId, candidate, article, accept, stats };
}

describe("siteStats", () => {
  it("counts the candidates of each host and what became of them, the most candidates first", () => {
    const s = setup();
    s.candidate("b.example");
    const [one, two, three] = [s.candidate("a.example", { status: "pending" }), s.candidate("a.example", { status: "pending" }), s.candidate("a.example", { status: "pending" })];
    s.candidate("a.example");
    s.candidate("a.example", { status: "pending" });
    const shared = s.article();
    s.accept([one!, two!], shared);
    const other = s.article();
    s.accept([three!], other);
    recordArticleOpened(s.db, shared, NOW.toISOString());
    setArticleFlags(s.db, shared, { starred: true, missed: true }, NOW.toISOString());

    const result = s.stats();

    expect(result.since).toBe(daysAgo(30));
    expect(result.sites).toEqual([
      { host: "a.example", candidates: 5, accepted: 3, rejected: 1, articles: 2, opened: 1, starred: 1, missed: 1, blocked: false },
      { host: "b.example", candidates: 1, accepted: 0, rejected: 1, articles: 0, opened: 0, starred: 0, missed: 0, blocked: false },
    ]);
    expect(result.blocked).toEqual([]);
  });

  it("orders hosts with as many candidates by name, the unknown ones together after them", () => {
    const s = setup();
    s.candidate("c.example");
    s.candidate("");
    s.candidate("b.example");
    s.candidate("a.example");
    s.candidate("a.example");

    expect(s.stats().sites.map((site) => [site.host, site.candidates])).toEqual([
      ["a.example", 2],
      ["b.example", 1],
      ["c.example", 1],
      ["", 1],
    ]);
  });

  it("counts the candidates of the last 30 days and of the category only", () => {
    const s = setup();
    s.candidate("old.example", { at: new Date(NOW.getTime() - 30 * DAY - 1).toISOString() });
    s.candidate("edge.example", { at: daysAgo(30) });
    s.candidate("elsewhere.example", { category: s.otherCategoryId });

    expect(s.stats().sites.map((site) => site.host)).toEqual(["edge.example"]);
  });

  it("marks the blocked hosts and lists every blocked site, with candidates or not", () => {
    const s = setup();
    s.candidate("a.example");
    s.candidate("b.example");
    blockSite(s.db, s.categoryId, "b.example", s.clock());
    blockSite(s.db, s.categoryId, "quiet.example", s.clock());
    blockSite(s.db, s.otherCategoryId, "a.example", s.clock());

    const result = s.stats();

    expect(result.sites.map((site) => [site.host, site.blocked])).toEqual([
      ["a.example", false],
      ["b.example", true],
    ]);
    expect(result.blocked).toEqual([
      { host: "b.example", blockedAt: NOW.toISOString() },
      { host: "quiet.example", blockedAt: NOW.toISOString() },
    ]);
  });

  it("refuses a category that does not exist", () => {
    const s = setup();
    expect(() => siteStats(s.db, 999, NOW)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});

describe("blocking a site", () => {
  it("brings the host to the form of a candidate's and keeps the first time it was blocked", () => {
    const s = setup();
    expect(blockSite(s.db, s.categoryId, "WWW.Example.org", s.clock())).toEqual({ host: "example.org", blockedAt: NOW.toISOString() });
    s.clock.set("2026-04-01T00:00:00.000Z");
    expect(blockSite(s.db, s.categoryId, "example.org", s.clock())).toEqual({ host: "example.org", blockedAt: NOW.toISOString() });
    expect([...blockedHosts(s.db, s.categoryId)]).toEqual(["example.org"]);
    expect([...blockedHosts(s.db, s.otherCategoryId)]).toEqual([]);
  });

  it("refuses what is not a host, and a category that does not exist", () => {
    const s = setup();
    expect(() => blockSite(s.db, s.categoryId, "a b", s.clock())).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => blockSite(s.db, 999, "example.org", s.clock())).toThrow(expect.objectContaining({ code: "not_found" }));
    expect([...blockedHosts(s.db, s.categoryId)]).toEqual([]);
  });

  it("stops blocking, and refuses a host that is not blocked", () => {
    const s = setup();
    blockSite(s.db, s.categoryId, "example.org", s.clock());
    unblockSite(s.db, s.categoryId, "www.example.org");
    expect([...blockedHosts(s.db, s.categoryId)]).toEqual([]);
    expect(() => unblockSite(s.db, s.categoryId, "example.org")).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => unblockSite(s.db, 999, "example.org")).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("forgets the blocked sites of a category that is deleted", () => {
    const s = setup();
    blockSite(s.db, s.categoryId, "example.org", s.clock());
    deleteCategory(s.db, s.categoryId);
    expect(s.db.prepare("SELECT count(*) AS n FROM blocked_sites").get()).toEqual({ n: 0 });
  });
});
