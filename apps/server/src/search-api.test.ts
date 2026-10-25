import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const MINUTE = 60_000;

const ids = (body: { items: Array<{ id: number }> }) => body.items.map((item) => item.id);

describe("GET /api/v1/search", () => {
  it("needs the API token", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/search?q=%E9%9B%BB%E6%B1%A0", null)).status).toBe(401);
  });

  it("returns generated and feed articles that match, with their origin, an excerpt and the terms", async () => {
    const s = testServer();
    const category = s.category();
    const generated = s.article(category.id, { title: "電池の話", summary: "新しい電池の工場" });
    s.clock.advance(MINUTE);
    const delivered = seedFeedArticle(s.db, seedFeed(s.db), { title: "News", body: "本文に電池", at: s.clock().toISOString() });

    const response = await s.get(`/api/v1/search?q=${encodeURIComponent("電池")}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ids(body)).toEqual([delivered, generated]);
    expect(body.items.map((item: { origin: string; excerpt: string | null }) => [item.origin, item.excerpt])).toEqual([
      ["feed", "本文に電池"],
      ["generated", "新しい電池の工場"],
    ]);
    expect(body.terms).toEqual(["電池"]);
  });

  it("returns the normalized terms", async () => {
    const s = testServer();
    const body = await (await s.get(`/api/v1/search?q=${encodeURIComponent("ＡＩ　半導体")}`)).json();
    expect(body.terms).toEqual(["ai", "半導体"]);
  });

  it("refuses a query of spaces only, and one longer than 200 characters", async () => {
    const s = testServer();
    const empty = await s.get(`/api/v1/search?q=${encodeURIComponent(" 　")}`);
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatchObject({ code: "invalid_input", fields: [{ path: "q", message: "is empty" }] });
    const long = await s.get(`/api/v1/search?q=${"a".repeat(201)}`);
    expect(long.status).toBe(400);
    expect((await long.json()).error.fields[0].message).toMatch(/too long/);
    expect((await s.get("/api/v1/search")).status).toBe(400);
  });

  it("searches everything, read articles included, unless told to narrow to a category, a feed or unread articles", async () => {
    const s = testServer();
    const a = s.category("A");
    const b = s.category("B");
    const inA = s.article(a.id, { title: "電池 A" });
    const inB = s.article(b.id, { title: "電池 B" });
    const feed = seedFeed(s.db, { categoryId: a.id });
    const ofFeed = seedFeedArticle(s.db, feed, { title: "電池 F", at: s.clock().toISOString(), isRead: true });
    const q = encodeURIComponent("電池");

    expect(ids(await (await s.get(`/api/v1/search?q=${q}`)).json()).sort()).toEqual([inA, inB, ofFeed].sort());
    expect(ids(await (await s.get(`/api/v1/search?q=${q}&category=${a.id}`)).json()).sort()).toEqual([inA, ofFeed].sort());
    expect(ids(await (await s.get(`/api/v1/search?q=${q}&feed=${feed}`)).json())).toEqual([ofFeed]);
    expect(ids(await (await s.get(`/api/v1/search?q=${q}&unread=true`)).json()).sort()).toEqual([inA, inB].sort());
  });

  it("pages through 120 results without repeating any", async () => {
    const s = testServer();
    const category = s.category();
    for (let index = 0; index < 120; index += 1) {
      s.article(category.id, { title: `電池 ${index}` });
      if (index % 3 === 0) s.clock.advance(MINUTE);
    }
    const pages: number[][] = [];
    let cursor: string | null = null;
    do {
      const body: { items: Array<{ id: number }>; nextCursor: string | null } = await (
        await s.get(`/api/v1/search?q=${encodeURIComponent("電池")}&limit=50${cursor ? `&cursor=${cursor}` : ""}`)
      ).json();
      pages.push(ids(body));
      cursor = body.nextCursor;
    } while (cursor);
    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(new Set(pages.flat()).size).toBe(120);
  });

  it("calls neither a model nor the translation API", async () => {
    const s = testServer();
    seedFeedArticle(s.db, seedFeed(s.db), { title: "Quarterly results", body: "Revenue rose." });
    const body = await (await s.get(`/api/v1/search?q=${encodeURIComponent("決算")}`)).json();
    expect(body.items).toEqual([]);
    expect(Object.values(s.llmRequests).flat()).toEqual([]);
    expect(s.google?.calls ?? []).toEqual([]);
  });
});
