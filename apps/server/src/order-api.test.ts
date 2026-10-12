import { insertFeed } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

type Named = { id: number; name?: string; title?: string; categoryId?: number | null };

function seeded() {
  const s = testServer();
  const a = s.category("A");
  const b = s.category("B");
  const feed = (title: string, categoryId: number | null) =>
    insertFeed(s.db, { url: `https://example.org/${title}.xml`, title, categoryId }, () => new Date("2026-03-01T12:00:00.000Z"));
  return { s, a, b, x: feed("X", a.id), y: feed("Y", a.id), p: feed("P", b.id) };
}

describe("moving categories and feeds", () => {
  it("moves a category before another and answers with the list in its new order", async () => {
    const { s, a, b } = seeded();
    const response = await s.post(`/api/v1/categories/${b.id}/move`, { before: a.id });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Named[]).map((category) => category.name)).toEqual(["B", "A"]);
    expect(((await (await s.get("/api/v1/categories")).json()) as Named[]).map((category) => category.name)).toEqual(["B", "A"]);
  });

  it("moves a feed to the end of another category and answers with the feeds in their order", async () => {
    const { s, b, x } = seeded();
    const response = await s.post(`/api/v1/feeds/${x.id}/move`, { categoryId: b.id, before: null });
    expect(response.status).toBe(200);
    const feeds = (await response.json()) as Named[];
    expect(feeds.map((feed) => feed.title)).toEqual(["Y", "P", "X"]);
    expect(feeds.find((feed) => feed.id === x.id)?.categoryId).toBe(b.id);
  });

  it("answers 404 for a missing category or feed", async () => {
    const { s } = seeded();
    expect((await s.post("/api/v1/categories/99/move", { before: null })).status).toBe(404);
    expect((await s.post("/api/v1/feeds/99/move", { categoryId: null, before: null })).status).toBe(404);
  });

  it("answers 400 for a body without a place, and for a neighbour that does not exist", async () => {
    const { s, a, x } = seeded();
    expect((await s.post(`/api/v1/categories/${a.id}/move`, {})).status).toBe(400);
    expect((await s.post(`/api/v1/categories/${a.id}/move`, { before: 99 })).status).toBe(400);
    expect((await s.post(`/api/v1/feeds/${x.id}/move`, { before: null })).status).toBe(400);
    expect((await s.post(`/api/v1/feeds/${x.id}/move`, { categoryId: a.id, before: 99 })).status).toBe(400);
  });
});

describe("the setting to move on after marking all as read", () => {
  it("is on at first and is returned once changed", async () => {
    const { s } = seeded();
    expect(((await (await s.get("/api/v1/settings")).json()) as { advanceAfterMarkAll: boolean }).advanceAfterMarkAll).toBe(true);
    await s.patch("/api/v1/settings", { advanceAfterMarkAll: false });
    expect(((await (await s.get("/api/v1/settings")).json()) as { advanceAfterMarkAll: boolean }).advanceAfterMarkAll).toBe(false);
  });
});
