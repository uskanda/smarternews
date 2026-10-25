import { seedFeed } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

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
    expect(await changed.json()).toEqual({ key: `feed-${feed}`, sort: "oldest" });
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [{ key: `feed-${feed}`, sort: "oldest" }] });
  });

  it("go back to the defaults, and are no longer listed", async () => {
    const s = testServer();
    await s.patch("/api/v1/list-views/starred", { sort: "oldest" });
    expect(await (await s.patch("/api/v1/list-views/starred", { sort: "newest" })).json()).toEqual({ key: "starred", sort: "newest" });
    expect(await (await s.get("/api/v1/list-views")).json()).toEqual({ items: [] });
  });

  it("take a body without settings and change nothing", async () => {
    const s = testServer();
    await s.patch("/api/v1/list-views/unread", { sort: "oldest" });
    expect(await (await s.patch("/api/v1/list-views/unread", {})).json()).toEqual({ key: "unread", sort: "oldest" });
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

  it("answer 400 for an event category, the recently read articles, a key it cannot read and a sort it does not know", async () => {
    const s = testServer();
    const events = s.category("Events", "event");
    for (const [key, body] of [
      [`category-${events.id}`, { sort: "oldest" }],
      ["recently-read", { sort: "oldest" }],
      ["search", { sort: "oldest" }],
      ["unread", { sort: "random" }],
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
