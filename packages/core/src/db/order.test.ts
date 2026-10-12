import { describe, expect, it } from "vitest";
import { exportOpml, importOpml } from "../feeds/opml.ts";
import { createTestDb, fakeClock, seedFeedArticle } from "../testing/db.ts";
import { createCategory, listCategories, moveCategory } from "./categories.ts";
import { insertFeed, listFeeds, moveFeed, updateFeed } from "./feeds.ts";
import { getSettings, updateSettings } from "./settings.ts";

const clock = fakeClock("2026-03-01T12:00:00.000Z");

function categories() {
  const db = createTestDb();
  const [a, b, c] = ["A", "B", "C"].map((name) => createCategory(db, { name, kind: "news" }, clock));
  return { db, a: a!, b: b!, c: c! };
}

const names = (db: ReturnType<typeof createTestDb>) => listCategories(db).map((category) => category.name);
const titles = (db: ReturnType<typeof createTestDb>, categoryId: number | null) =>
  listFeeds(db)
    .filter((feed) => feed.categoryId === categoryId)
    .map((feed) => feed.title);

describe("the order of categories", () => {
  it("is the order of registration, and a new one goes last after a move", () => {
    const { db, a, b } = categories();
    expect(names(db)).toEqual(["A", "B", "C"]);
    moveCategory(db, b.id, a.id);
    createCategory(db, { name: "D", kind: "news" }, clock);
    expect(names(db)).toEqual(["B", "A", "C", "D"]);
  });

  it("moves one category before another, or to the end, and keeps the others in order", () => {
    const { db, a, c } = categories();
    moveCategory(db, c.id, a.id);
    expect(names(db)).toEqual(["C", "A", "B"]);
    moveCategory(db, c.id, null);
    expect(names(db)).toEqual(["A", "B", "C"]);
    moveCategory(db, a.id, a.id);
    expect(names(db)).toEqual(["A", "B", "C"]);
  });

  it("refuses a missing category on either side and changes nothing", () => {
    const { db, a } = categories();
    expect(() => moveCategory(db, a.id, 99)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => moveCategory(db, 99, a.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(names(db)).toEqual(["A", "B", "C"]);
  });
});

describe("the order of feeds", () => {
  function feeds() {
    const { db, a, b } = categories();
    const add = (title: string, categoryId: number | null) =>
      insertFeed(db, { url: `https://example.org/${title}.xml`, title, categoryId }, clock);
    const x = add("X", a.id);
    const y = add("Y", a.id);
    const z = add("Z", a.id);
    const p = add("P", b.id);
    const loose = add("L", null);
    return { db, a, b, x, y, z, p, loose };
  }

  it("is the order of registration within a category, and categories come in their own order", () => {
    const { db, a, b } = feeds();
    expect(titles(db, a.id)).toEqual(["X", "Y", "Z"]);
    moveCategory(db, b.id, a.id);
    expect(listFeeds(db).map((feed) => feed.title)).toEqual(["P", "X", "Y", "Z", "L"]);
  });

  it("moves a feed within its category", () => {
    const { db, a, x, z } = feeds();
    moveFeed(db, z.id, { categoryId: a.id, before: x.id });
    expect(titles(db, a.id)).toEqual(["Z", "X", "Y"]);
    moveFeed(db, z.id, { categoryId: a.id, before: null });
    expect(titles(db, a.id)).toEqual(["X", "Y", "Z"]);
  });

  it("moves a feed to another category, with its articles, in one step", () => {
    const { db, a, b, x, p } = feeds();
    const article = seedFeedArticle(db, x.id);
    const moved = moveFeed(db, x.id, { categoryId: b.id, before: p.id });
    expect(moved.categoryId).toBe(b.id);
    expect(titles(db, b.id)).toEqual(["X", "P"]);
    expect(titles(db, a.id)).toEqual(["Y", "Z"]);
    expect(db.prepare("SELECT category_id FROM articles WHERE id = ?").get(article)).toEqual({ category_id: b.id });
  });

  it("moves a feed out of every category", () => {
    const { db, x, loose } = feeds();
    moveFeed(db, x.id, { categoryId: null, before: loose.id });
    expect(titles(db, null)).toEqual(["X", "L"]);
  });

  it("refuses an event category, and a neighbour that is not in the target category", () => {
    const { db, a, b, x, p } = feeds();
    const event = createCategory(db, { name: "Events", kind: "event" }, clock);
    expect(() => moveFeed(db, x.id, { categoryId: event.id, before: null })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => moveFeed(db, x.id, { categoryId: a.id, before: p.id })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(() => moveFeed(db, 99, { categoryId: b.id, before: null })).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(titles(db, a.id)).toEqual(["X", "Y", "Z"]);
  });

  it("puts a feed last in its new category when the category is changed by an edit", () => {
    const { db, b, x } = feeds();
    updateFeed(db, x.id, { categoryId: b.id });
    expect(titles(db, b.id)).toEqual(["P", "X"]);
  });

  it("appends the feeds of an OPML document in document order, and writes OPML in the stored order", () => {
    const { db, a, x, y } = feeds();
    importOpml(
      db,
      `<opml version="2.0"><body><outline text="A"><outline type="rss" text="N2" xmlUrl="https://example.org/n2.xml"/><outline type="rss" text="N1" xmlUrl="https://example.org/n1.xml"/></outline></body></opml>`,
      clock,
    );
    expect(titles(db, a.id)).toEqual(["X", "Y", "Z", "N2", "N1"]);
    moveFeed(db, y.id, { categoryId: a.id, before: x.id });
    const opml = exportOpml(db);
    expect(opml.indexOf("Y.xml")).toBeLessThan(opml.indexOf("X.xml"));
    expect(opml.indexOf("X.xml")).toBeLessThan(opml.indexOf("Z.xml"));
  });
});

describe("moving on after marking all as read", () => {
  it("is on by default, and switching it off is kept", () => {
    const db = createTestDb();
    expect(getSettings(db).advanceAfterMarkAll).toBe(true);
    updateSettings(db, { advanceAfterMarkAll: false });
    expect(getSettings(db).advanceAfterMarkAll).toBe(false);
    updateSettings(db, { readerInfo: "x" });
    expect(getSettings(db).advanceAfterMarkAll).toBe(false);
  });
});
