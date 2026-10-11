import type { Category, Feed } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { buildNav, listKey, type ListTarget, type NavModel } from "./nav.ts";
import { applyMove, dropAt, edgeScroll, groupAt, movableOf, nextTarget, stepMove, type Row } from "./order.ts";

const category = (id: number, name: string, kind: Category["kind"] = "news"): Category => ({
  id,
  slug: name.toLowerCase(),
  name,
  kind,
  schedule: [],
  minImportance: 3,
  maxArticlesPerRun: 5,
  windowHours: 24,
  windowDays: null,
  enabled: true,
  createdAt: "2026-03-01T00:00:00.000Z",
});

const feed = (id: number, title: string, categoryId: number | null): Feed => ({
  id,
  url: `https://f${id}.example.org/feed.xml`,
  title,
  siteUrl: null,
  categoryId,
  intervalMinutes: null,
  enabled: true,
  autoSummarize: false,
  translate: false,
  lastFetchedAt: null,
  lastSucceededAt: null,
  lastError: null,
  failureCount: 0,
  nextFetchAt: null,
  articleCount: 0,
  starredCount: 0,
  createdAt: "2026-03-01T00:00:00.000Z",
});

// A (feeds X, Y, Z), B (feed P), C (no feed), E (events), and the loose feed L.
const CATEGORIES = [category(1, "A"), category(2, "B"), category(3, "C"), category(4, "E", "event")];
const FEEDS = [feed(11, "X", 1), feed(12, "Y", 1), feed(13, "Z", 1), feed(21, "P", 2), feed(91, "L", null)];

const cat = (categoryId: number, generatedOnly = false): ListTarget => ({ type: "category", categoryId, generatedOnly });
const fd = (feedId: number): ListTarget => ({ type: "feed", feedId });

function model(unread: Record<string, number> = {}): NavModel {
  const nav = buildNav({ categories: CATEGORIES, feeds: FEEDS, counts: undefined });
  const set = (entry: { target: ListTarget; unread: number }) => {
    entry.unread = unread[listKey(entry.target)] ?? 0;
  };
  nav.groups.forEach((group) => {
    set(group.entry);
    group.children.forEach(set);
  });
  return nav;
}

describe("nextTarget", () => {
  it("goes from a category to the next category below that has unread articles", () => {
    expect(nextTarget(model({ "category-3": 2, "category-2-generated": 5 }), cat(1))).toEqual(cat(3));
    expect(nextTarget(model({ "category-2": 1, "category-3": 2 }), cat(1))).toEqual(cat(2));
  });

  it("counts the group of feeds without a category as the last category", () => {
    expect(nextTarget(model({ uncategorized: 1 }), cat(3))).toEqual({ type: "uncategorized" });
    expect(nextTarget(model({ "category-1": 4 }), { type: "uncategorized" })).toBeNull();
  });

  it("goes from a feed to the next feed below, across categories", () => {
    expect(nextTarget(model({ "feed-13": 1, "feed-21": 1 }), fd(11))).toEqual(fd(13));
    expect(nextTarget(model({ "feed-21": 1 }), fd(13))).toEqual(fd(21));
    expect(nextTarget(model({ "feed-91": 1 }), fd(13))).toEqual(fd(91));
  });

  it("treats the generated articles of a category as one of its feeds", () => {
    expect(nextTarget(model({ "category-2-generated": 3 }), fd(13))).toEqual(cat(2, true));
    expect(nextTarget(model({ "feed-11": 3 }), cat(1, true))).toEqual(fd(11));
  });

  it("does not look above, and not at the list that was just read", () => {
    expect(nextTarget(model({ "feed-11": 3, "feed-12": 1 }), fd(12))).toBeNull();
    expect(nextTarget(model({ "category-1": 3 }), cat(2))).toBeNull();
  });

  it("stays put on the views at the top", () => {
    const nav = model({ "category-1": 3, "feed-11": 3 });
    for (const type of ["unread", "all", "starred", "generated"] as const) expect(nextTarget(nav, { type })).toBeNull();
  });
});

describe("movableOf", () => {
  it("lets categories and feeds move, and nothing else", () => {
    expect(movableOf(cat(1))).toEqual({ kind: "category", id: 1 });
    expect(movableOf(fd(11))).toEqual({ kind: "feed", id: 11 });
    expect(movableOf(cat(1, true))).toBeNull();
    expect(movableOf({ type: "uncategorized" })).toBeNull();
    expect(movableOf({ type: "unread" })).toBeNull();
  });
});

describe("stepMove", () => {
  it("moves a category one place up or down among the categories", () => {
    const nav = model();
    expect(stepMove(nav, { kind: "category", id: 2 }, -1)).toEqual({ kind: "category", id: 2, before: 1 });
    expect(stepMove(nav, { kind: "category", id: 2 }, 1)).toEqual({ kind: "category", id: 2, before: 4 });
    expect(stepMove(nav, { kind: "category", id: 3 }, 1)).toEqual({ kind: "category", id: 3, before: null });
  });

  it("has nowhere to go at the ends", () => {
    const nav = model();
    expect(stepMove(nav, { kind: "category", id: 1 }, -1)).toBeNull();
    expect(stepMove(nav, { kind: "category", id: 4 }, 1)).toBeNull();
    expect(stepMove(nav, { kind: "feed", id: 11 }, -1)).toBeNull();
    expect(stepMove(nav, { kind: "feed", id: 21 }, 1)).toBeNull();
    expect(stepMove(nav, { kind: "feed", id: 91 }, -1)).toBeNull();
  });

  it("moves a feed one place within its category", () => {
    const nav = model();
    expect(stepMove(nav, { kind: "feed", id: 12 }, -1)).toEqual({ kind: "feed", id: 12, categoryId: 1, before: 11 });
    expect(stepMove(nav, { kind: "feed", id: 11 }, 1)).toEqual({ kind: "feed", id: 11, categoryId: 1, before: 13 });
    expect(stepMove(nav, { kind: "feed", id: 12 }, 1)).toEqual({ kind: "feed", id: 12, categoryId: 1, before: null });
  });
});

/** Every row is 20 high, in the order of the list; `folded` hides the rows below a category. */
function rows(nav: NavModel, folded: string[] = []): Row[] {
  const out: Row[] = [];
  let top = 100;
  const push = (target: ListTarget) => {
    out.push({ key: listKey(target), top, bottom: top + 20 });
    top += 20;
  };
  for (const group of nav.groups) {
    push(group.entry.target);
    if (!folded.includes(listKey(group.entry.target))) group.children.forEach((child) => push(child.target));
  }
  return out;
}
// A 100, A-gen 120, X 140, Y 160, Z 180, B 200, B-gen 220, P 240, C 260, E 280, loose 300, L 320.

describe("dropAt for a category", () => {
  const nav = model();
  const drop = (y: number) => dropAt({ model: nav, rows: rows(nav), dragged: { kind: "category", id: 3 }, y, armed: null });

  it("goes before the category whose upper half the pointer is in", () => {
    expect(drop(105)).toEqual({ move: { kind: "category", id: 3, before: 1 }, lineY: 100, group: null });
    expect(drop(210)).toEqual({ move: { kind: "category", id: 3, before: 2 }, lineY: 200, group: null });
  });

  it("goes after a category, with everything below it, from its lower half on", () => {
    expect(drop(190)).toEqual({ move: { kind: "category", id: 3, before: 2 }, lineY: 200, group: null });
    expect(drop(250)).toEqual({ move: { kind: "category", id: 3, before: 4 }, lineY: 280, group: null });
  });

  it("never goes below the feeds without a category", () => {
    expect(drop(400)).toEqual({ move: { kind: "category", id: 3, before: null }, lineY: 300, group: null });
  });
});

describe("dropAt for a feed", () => {
  const nav = model();
  const drop = (y: number, armed: string | null = null, id = 11, folded: string[] = []) =>
    dropAt({ model: nav, rows: rows(nav, folded), dragged: { kind: "feed", id }, y, armed });

  it("moves within its own category at once", () => {
    expect(drop(185)).toEqual({ move: { kind: "feed", id: 11, categoryId: 1, before: 13 }, lineY: 180, group: "category-1" });
    expect(drop(195)).toEqual({ move: { kind: "feed", id: 11, categoryId: 1, before: null }, lineY: 200, group: "category-1" });
  });

  it("never goes above the generated articles of the category", () => {
    expect(drop(105, null, 13)).toEqual({ move: { kind: "feed", id: 13, categoryId: 1, before: 11 }, lineY: 140, group: "category-1" });
    expect(drop(125, null, 13)).toEqual({ move: { kind: "feed", id: 13, categoryId: 1, before: 11 }, lineY: 140, group: "category-1" });
  });

  it("goes into another category only once that category is armed", () => {
    expect(drop(245)).toBeNull();
    expect(drop(245, "category-2")).toEqual({ move: { kind: "feed", id: 11, categoryId: 2, before: 21 }, lineY: 240, group: "category-2" });
    expect(drop(255, "category-2")).toEqual({ move: { kind: "feed", id: 11, categoryId: 2, before: null }, lineY: 260, group: "category-2" });
    expect(drop(245, "category-3")).toBeNull();
  });

  it("goes last in a category that shows no feeds", () => {
    expect(drop(265, "category-3")).toEqual({ move: { kind: "feed", id: 11, categoryId: 3, before: null }, lineY: 280, group: "category-3" });
    expect(dropAt({ model: nav, rows: rows(nav, ["category-2"]), dragged: { kind: "feed", id: 11 }, y: 205, armed: "category-2" })).toEqual({
      move: { kind: "feed", id: 11, categoryId: 2, before: null },
      lineY: 220,
      group: "category-2",
    });
  });

  it("goes out of every category", () => {
    expect(drop(325, "uncategorized")).toEqual({ move: { kind: "feed", id: 11, categoryId: null, before: 91 }, lineY: 320, group: "uncategorized" });
  });

  it("never goes into an event category", () => {
    expect(drop(285, "category-4")).toBeNull();
  });
});

describe("groupAt", () => {
  it("names the group a position is in, for a feed to wait over", () => {
    const nav = model();
    const at = (y: number) => groupAt(nav, rows(nav), y);
    expect(at(150)).toBe("category-1");
    expect(at(230)).toBe("category-2");
    expect(at(270)).toBe("category-3");
    expect(at(330)).toBe("uncategorized");
    expect(at(50)).toBe("category-1");
    expect(at(900)).toBe("uncategorized");
  });
});

describe("applyMove", () => {
  it("reorders the categories", () => {
    const next = applyMove({ categories: CATEGORIES, feeds: FEEDS }, { kind: "category", id: 3, before: 1 });
    expect(next.categories.map((entry) => entry.name)).toEqual(["C", "A", "B", "E"]);
    expect(applyMove({ categories: CATEGORIES, feeds: FEEDS }, { kind: "category", id: 1, before: null }).categories.map((entry) => entry.name)).toEqual(["B", "C", "E", "A"]);
  });

  it("reorders the feeds and changes the category of the one that moved", () => {
    const next = applyMove({ categories: CATEGORIES, feeds: FEEDS }, { kind: "feed", id: 11, categoryId: 2, before: 21 });
    expect(next.feeds.filter((entry) => entry.categoryId === 2).map((entry) => entry.title)).toEqual(["X", "P"]);
    expect(next.feeds.filter((entry) => entry.categoryId === 1).map((entry) => entry.title)).toEqual(["Y", "Z"]);
    const last = applyMove({ categories: CATEGORIES, feeds: FEEDS }, { kind: "feed", id: 11, categoryId: 1, before: null });
    expect(last.feeds.filter((entry) => entry.categoryId === 1).map((entry) => entry.title)).toEqual(["Y", "Z", "X"]);
  });
});

describe("edgeScroll", () => {
  // A list 300 high that shows from 100 down, holding 900 of content.
  const list = { top: 100, height: 300, max: 600 };

  it("stays still while the finger is away from the edges", () => {
    expect(edgeScroll({ ...list, y: 250, offset: 100 })).toBe(0);
  });

  it("scrolls towards the edge the finger is near, faster the nearer it is", () => {
    const slow = edgeScroll({ ...list, y: 360, offset: 100 });
    const fast = edgeScroll({ ...list, y: 398, offset: 100 });
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(edgeScroll({ ...list, y: 110, offset: 100 })).toBeLessThan(0);
  });

  it("stops at the ends of the content", () => {
    expect(edgeScroll({ ...list, y: 398, offset: 600 })).toBe(0);
    expect(edgeScroll({ ...list, y: 398, offset: 595 })).toBe(5);
    expect(edgeScroll({ ...list, y: 101, offset: 0 })).toBe(0);
    expect(edgeScroll({ ...list, y: 101, offset: 3 })).toBe(-3);
  });
});
