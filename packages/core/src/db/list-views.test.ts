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

/** A view in the standard format. */
const view = (key: string, sort: string) => ({ key, sort, format: "standard" });

describe("reading list views", () => {
  it("gives newest first in the standard format for every entry that was never changed, and answers none of them", () => {
    const { db, tools, feed } = setup();
    expect(listListViews(db)).toEqual({ items: [] });
    for (const key of ["unread", "all", "starred", "generated", "feeds", "uncategorized", `category-${tools.id}`, `category-${tools.id}-generated`, `feed-${feed}`]) {
      expect(getListView(db, key)).toEqual(view(key, "newest"));
    }
  });

  it("keeps each entry apart from the others", () => {
    const { db, tools, feed } = setup();
    expect(updateListView(db, `category-${tools.id}`, { sort: "oldest" })).toEqual(view(`category-${tools.id}`, "oldest"));

    expect(listListViews(db)).toEqual({ items: [view(`category-${tools.id}`, "oldest")] });
    for (const key of ["unread", "all", `category-${tools.id}-generated`, `feed-${feed}`]) expect(getListView(db, key).sort).toBe("newest");
  });

  it("keeps the feed articles of every feed apart from one feed", () => {
    const { db, feed } = setup();
    expect(updateListView(db, "feeds", { sort: "oldest" })).toEqual(view("feeds", "oldest"));

    expect(listListViews(db)).toEqual({ items: [view("feeds", "oldest")] });
    for (const key of ["generated", "uncategorized", `feed-${feed}`]) expect(getListView(db, key).sort).toBe("newest");
    expect(updateListView(db, "feeds", { sort: "newest" })).toEqual(view("feeds", "newest"));
    expect(listListViews(db).items).toEqual([]);
  });
});

describe("changing a list view", () => {
  it("deletes the row once the entry is back to the defaults", () => {
    const { db } = setup();
    updateListView(db, "starred", { sort: "oldest" });
    expect(listListViews(db).items).toEqual([view("starred", "oldest")]);

    expect(updateListView(db, "starred", { sort: "newest" })).toEqual(view("starred", "newest"));
    expect(listListViews(db).items).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM list_views").get()).toEqual({ n: 0 });
  });

  it("leaves what the change does not name as it is", () => {
    const { db, feed } = setup();
    updateListView(db, `feed-${feed}`, { sort: "oldest" });
    expect(updateListView(db, `feed-${feed}`, {})).toEqual(view(`feed-${feed}`, "oldest"));
    expect(updateListView(db, "all", {})).toEqual(view("all", "newest"));
    expect(listListViews(db).items).toEqual([view(`feed-${feed}`, "oldest")]);
  });

  it("refuses a category or a feed that does not exist as not found", () => {
    const { db } = setup();
    for (const key of ["category-999", "category-999-generated", "feed-999"]) {
      expect(() => updateListView(db, key, { sort: "oldest" })).toThrow(expect.objectContaining({ code: "not_found" }));
    }
    expect(listListViews(db).items).toEqual([]);
  });

  it("keeps the order by star time for the starred articles", () => {
    const { db } = setup();
    expect(updateListView(db, "starred", { sort: "starred" })).toEqual(view("starred", "starred"));
    expect(listListViews(db).items).toEqual([view("starred", "starred")]);
    expect(getListView(db, "starred")).toEqual(view("starred", "starred"));
    expect(updateListView(db, "starred", { sort: "oldest" })).toEqual(view("starred", "oldest"));
  });

  it("refuses the order by star time for any entry but the starred articles as invalid", () => {
    const { db, tools, feed } = setup();
    updateListView(db, "all", { sort: "oldest" });
    for (const key of ["unread", "all", "generated", "feeds", "uncategorized", `category-${tools.id}`, `category-${tools.id}-generated`, `feed-${feed}`]) {
      expect(() => updateListView(db, key, { sort: "starred" })).toThrow(
        expect.objectContaining({ code: "invalid", fields: [expect.objectContaining({ path: "sort" })] }),
      );
    }
    expect(listListViews(db).items).toEqual([view("all", "oldest")]);
  });

  it("refuses an event category, the recently read articles and a key it cannot read as invalid", () => {
    const { db, events } = setup();
    for (const key of [`category-${events.id}`, `category-${events.id}-generated`, "recently-read", "search", "feed-x"]) {
      expect(() => updateListView(db, key, { sort: "oldest" })).toThrow(expect.objectContaining({ code: "invalid" }));
      expect(() => updateListView(db, key, { format: "compact" })).toThrow(expect.objectContaining({ code: "invalid" }));
    }
    expect(listListViews(db).items).toEqual([]);
  });
});

describe("the format of a list", () => {
  it("keeps the format of an entry and answers it with the order", () => {
    const { db, tools } = setup();
    expect(updateListView(db, `category-${tools.id}`, { format: "expanded" })).toEqual({ key: `category-${tools.id}`, sort: "newest", format: "expanded" });
    expect(updateListView(db, "unread", { format: "compact" })).toEqual({ key: "unread", sort: "newest", format: "compact" });

    expect(listListViews(db).items).toEqual([
      { key: `category-${tools.id}`, sort: "newest", format: "expanded" },
      { key: "unread", sort: "newest", format: "compact" },
    ]);
    expect(getListView(db, "unread").format).toBe("compact");
    expect(getListView(db, "all").format).toBe("standard");
  });

  it("keeps the format when only the order changes, and the order when only the format changes", () => {
    const { db } = setup();
    updateListView(db, "all", { format: "expanded" });
    expect(updateListView(db, "all", { sort: "oldest" })).toEqual({ key: "all", sort: "oldest", format: "expanded" });
    expect(updateListView(db, "all", { format: "compact" })).toEqual({ key: "all", sort: "oldest", format: "compact" });
    expect(updateListView(db, "all", { sort: "newest", format: "expanded" })).toEqual({ key: "all", sort: "newest", format: "expanded" });
  });

  it("keeps the row while either setting differs from its default, and deletes it once both are back", () => {
    const { db } = setup();
    updateListView(db, "starred", { sort: "starred", format: "compact" });
    updateListView(db, "starred", { sort: "newest" });
    expect(listListViews(db).items).toEqual([{ key: "starred", sort: "newest", format: "compact" }]);

    updateListView(db, "starred", { format: "standard" });
    expect(listListViews(db).items).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM list_views").get()).toEqual({ n: 0 });
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
    expect(listListViews(db).items).toEqual([view(`feed-${feed}`, "oldest"), view("unread", "oldest")]);
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
