import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed } from "../testing/db.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import { deleteFeed, getFeed } from "./feeds.ts";
import { getListView, listListViews, updateListView } from "./list-views.ts";

const clock = fakeClock("2026-03-01T00:00:00.000Z");

function setup() {
  const db = createTestDb();
  const tools = createCategory(db, { name: "Tools", slug: "tools", kind: "news" }, clock);
  const events = createCategory(db, { name: "Events", slug: "events", kind: "event" }, clock);
  const feed = seedFeed(db, { categoryId: tools.id });
  return { db, tools, events, feed };
}

describe("reading list views", () => {
  it("gives newest first for every entry that was never changed, and answers none of them", () => {
    const { db, tools, feed } = setup();
    expect(listListViews(db)).toEqual({ items: [] });
    for (const key of ["unread", "all", "starred", "generated", "uncategorized", `category-${tools.id}`, `category-${tools.id}-generated`, `feed-${feed}`]) {
      expect(getListView(db, key)).toEqual({ key, sort: "newest" });
    }
  });

  it("keeps each entry apart from the others", () => {
    const { db, tools, feed } = setup();
    expect(updateListView(db, `category-${tools.id}`, { sort: "oldest" })).toEqual({ key: `category-${tools.id}`, sort: "oldest" });

    expect(listListViews(db)).toEqual({ items: [{ key: `category-${tools.id}`, sort: "oldest" }] });
    for (const key of ["unread", "all", `category-${tools.id}-generated`, `feed-${feed}`]) expect(getListView(db, key).sort).toBe("newest");
  });
});

describe("changing a list view", () => {
  it("deletes the row once the entry is back to the defaults", () => {
    const { db } = setup();
    updateListView(db, "starred", { sort: "oldest" });
    expect(listListViews(db).items).toEqual([{ key: "starred", sort: "oldest" }]);

    expect(updateListView(db, "starred", { sort: "newest" })).toEqual({ key: "starred", sort: "newest" });
    expect(listListViews(db).items).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM list_views").get()).toEqual({ n: 0 });
  });

  it("leaves what the change does not name as it is", () => {
    const { db, feed } = setup();
    updateListView(db, `feed-${feed}`, { sort: "oldest" });
    expect(updateListView(db, `feed-${feed}`, {})).toEqual({ key: `feed-${feed}`, sort: "oldest" });
    expect(updateListView(db, "all", {})).toEqual({ key: "all", sort: "newest" });
    expect(listListViews(db).items).toEqual([{ key: `feed-${feed}`, sort: "oldest" }]);
  });

  it("refuses a category or a feed that does not exist as not found", () => {
    const { db } = setup();
    for (const key of ["category-999", "category-999-generated", "feed-999"]) {
      expect(() => updateListView(db, key, { sort: "oldest" })).toThrow(expect.objectContaining({ code: "not_found" }));
    }
    expect(listListViews(db).items).toEqual([]);
  });

  it("refuses an event category, the recently read articles and a key it cannot read as invalid", () => {
    const { db, events } = setup();
    for (const key of [`category-${events.id}`, `category-${events.id}-generated`, "recently-read", "search", "feed-x"]) {
      expect(() => updateListView(db, key, { sort: "oldest" })).toThrow(expect.objectContaining({ code: "invalid" }));
    }
    expect(listListViews(db).items).toEqual([]);
  });
});

describe("deleting what a list view belongs to", () => {
  it("deletes the views of a category and of its generated articles, and keeps those of the feeds it lets go", () => {
    const { db, tools, feed } = setup();
    updateListView(db, `category-${tools.id}`, { sort: "oldest" });
    updateListView(db, `category-${tools.id}-generated`, { sort: "oldest" });
    updateListView(db, `feed-${feed}`, { sort: "oldest" });
    updateListView(db, "unread", { sort: "oldest" });

    deleteCategory(db, tools.id);

    expect(getFeed(db, feed).categoryId).toBeNull();
    expect(listListViews(db).items).toEqual([
      { key: `feed-${feed}`, sort: "oldest" },
      { key: "unread", sort: "oldest" },
    ]);
    const again = createCategory(db, { name: "Tools", slug: "tools", kind: "news" }, clock);
    expect(getListView(db, `category-${again.id}`).sort).toBe("newest");
  });

  it("deletes the view of a feed with the feed", () => {
    const { db, feed } = setup();
    updateListView(db, `feed-${feed}`, { sort: "oldest" });

    deleteFeed(db, feed);

    expect(listListViews(db).items).toEqual([]);
    const again = seedFeed(db, {});
    expect(getListView(db, `feed-${again}`).sort).toBe("newest");
  });
});
