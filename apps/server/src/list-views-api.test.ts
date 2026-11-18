import { seedFeed } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

/** A view in the standard format. */
const view = (key: string, sort: string) => ({ key, sort, format: "standard" });

describe("list views", () => {
  it("answer none for a server where nothing was changed", async () => {
    const s = testServer();
    const response = await s.get("/api/v1/list-views");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it("take oldest first for a feed, answer the entry as it is now, and list it", async () => {
    const s = testServer();
    const feed = seedFeed(s.db, {});

    const changed = await s.patch(`/api/v1/list-views/feed-${feed}`, { sort: "oldest" });

    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual(view(`feed-${feed}`, "oldest"));
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [view(`feed-${feed}`, "oldest")] });
  });

  it("go back to the defaults, and are no longer listed", async () => {
    const s = testServer();
    await s.patch("/api/v1/list-views/starred", { sort: "oldest" });
    expect(await (await s.patch("/api/v1/list-views/starred", { sort: "newest" })).json()).toEqual(view("starred", "newest"));
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [] });
  });

  it("keep the feed articles of every feed under the key feeds", async () => {
    const s = testServer();
    expect(await (await s.patch("/api/v1/list-views/feeds", { sort: "oldest" })).json()).toEqual(view("feeds", "oldest"));
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [view("feeds", "oldest")] });
  });

  it("keep the starred articles in the order by star time", async () => {
    const s = testServer();
    expect(await (await s.patch("/api/v1/list-views/starred", { sort: "starred" })).json()).toEqual(view("starred", "starred"));
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [view("starred", "starred")] });
  });

  it("take the relevance order for a category and keep it", async () => {
    const s = testServer();
    const category = s.category("Tools");
    expect(await (await s.patch(`/api/v1/list-views/category-${category.id}`, { sort: "relevance" })).json()).toEqual(
      view(`category-${category.id}`, "relevance"),
    );
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [view(`category-${category.id}`, "relevance")] });
    expect((await s.patch("/api/v1/list-views/unread", { sort: "random" })).status).toBe(400);
  });

  it("take a format, keep the order beside it, and go back to none once both are the defaults", async () => {
    const s = testServer();
    await s.patch("/api/v1/list-views/all", { sort: "oldest" });
    expect(await (await s.patch("/api/v1/list-views/all", { format: "expanded" })).json()).toEqual({ key: "all", sort: "oldest", format: "expanded" });
    expect(await (await s.patch("/api/v1/list-views/all", { sort: "newest" })).json()).toEqual({ key: "all", sort: "newest", format: "expanded" });
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [{ key: "all", sort: "newest", format: "expanded" }] });
    await s.patch("/api/v1/list-views/all", { format: "standard" });
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [] });
  });

  it("take a body without settings and change nothing", async () => {
    const s = testServer();
    await s.patch("/api/v1/list-views/unread", { sort: "oldest" });
    expect(await (await s.patch("/api/v1/list-views/unread", {})).json()).toEqual(view("unread", "oldest"));
  });

  it("answer 404 for a category or a feed that does not exist", async () => {
    const s = testServer();
    const feed = seedFeed(s.db, {});
    await s.delete(`/api/v1/feeds/${feed}`);
    for (const key of [`feed-${feed}`, "category-999", "category-999-generated"]) {
      const response = await s.patch(`/api/v1/list-views/${key}`, { sort: "oldest" });
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("not_found");
    }
  });

  it("answer 400 for an event category, the recently read articles, a key it cannot read, and a sort or format it does not know", async () => {
    const s = testServer();
    const events = s.category("Events", "event");
    for (const [key, body] of [
      [`category-${events.id}`, { sort: "oldest" }],
      [`category-${events.id}`, { format: "compact" }],
      ["recently-read", { sort: "oldest" }],
      ["recently-read", { format: "expanded" }],
      ["search", { sort: "oldest" }],
      ["unread", { sort: "random" }],
      ["unread", { sort: "starred" }],
      ["unread", { format: "cards" }],
      ["feeds", { sort: "starred" }],
    ] as const) {
      const response = await s.patch(`/api/v1/list-views/${key}`, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_input");
    }
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [] });
  });

  it("need the API token", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/list-views", null)).status).toBe(401);
    expect((await s.patch("/api/v1/list-views/unread", { sort: "oldest" }, null)).status).toBe(401);
  });
});
