import { reviseArticle } from "@smarternews/core";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;

describe("GET /api/v1/articles", () => {
  it("returns the unread articles of a category, newest update first", async () => {
    const s = testServer();
    const security = s.category("Security");
    const cars = s.category("Cars");
    const first = s.article(security.id);
    s.clock.advance(MINUTE);
    const read = s.article(security.id);
    s.clock.advance(MINUTE);
    const third = s.article(security.id);
    s.article(cars.id);
    await s.patch(`/api/v1/articles/${read}`, { isRead: true });

    const body = await (await s.get(`/api/v1/articles?category=${security.id}&unread=true`)).json();

    expect(body.items.map((item: { id: number }) => item.id)).toEqual([third, first]);
    expect(body.nextCursor).toBeNull();
  });

  it("pages through 120 articles in three requests without repeating or skipping any", async () => {
    const s = testServer();
    const category = s.category();
    const ids: number[] = [];
    for (let index = 0; index < 120; index += 1) {
      ids.push(s.article(category.id));
      if (index % 3 === 0) s.clock.advance(MINUTE); // several articles share a timestamp
    }

    const pages: number[][] = [];
    let cursor: string | null = null;
    do {
      const response = await s.get(`/api/v1/articles?limit=50${cursor ? `&cursor=${cursor}` : ""}`);
      const body = (await response.json()) as { items: Array<{ id: number }>; nextCursor: string | null };
      pages.push(body.items.map((item) => item.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(new Set(pages.flat()).size).toBe(120);
    expect(pages.flat().sort((a, b) => a - b)).toEqual(ids);
  });

  it("lists events that have not ended, soonest first", async () => {
    const s = testServer("2026-03-10T12:00:00.000Z");
    const category = s.category("Events", "event");
    const event = (startsAt: string, endsAt: string) =>
      s.article(category.id, { kind: "event", event: { key: startsAt, startsAt, endsAt, venue: null, fee: null, registration: "unknown" } });
    const inThreeDays = event("2026-03-13T10:00:00.000Z", "2026-03-13T16:00:00.000Z");
    event("2026-03-09T10:00:00.000Z", "2026-03-09T16:00:00.000Z");
    const tomorrow = event("2026-03-11T10:00:00.000Z", "2026-03-11T16:00:00.000Z");

    const body = await (await s.get("/api/v1/articles?kind=event")).json();

    expect(body.items.map((item: { id: number }) => item.id)).toEqual([tomorrow, inThreeDays]);
    expect(body.items[0].event).toMatchObject({ startsAt: "2026-03-11T10:00:00.000Z" });
  });

  it("refuses a limit outside the allowed range", async () => {
    const s = testServer();
    const response = await s.get("/api/v1/articles?limit=5000");
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields[0].path).toBe("limit");
  });

  it("refuses a cursor it did not issue", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/articles?cursor=garbage")).status).toBe(400);
  });
});

describe("GET /api/v1/articles/:id", () => {
  it("returns an updated article with its revision, new body and every reference", async () => {
    const s = testServer();
    const category = s.category();
    const id = s.article(category.id, { refs: ["https://example.org/first"] });
    s.clock.advance(DAY);
    reviseArticle(s.db, id, {
      title: "Revised",
      summary: "Now patched.",
      body: "Second **version**.",
      impact: "Update this week.",
      importance: 4,
      unconfirmed: true,
      snippetOnly: false,
      event: null,
      now: s.clock().toISOString(),
      refs: [{ url: "https://example.org/second", siteName: "Example", title: "Second", publishedAt: null }],
      topicIds: [],
    });

    const body = await (await s.get(`/api/v1/articles/${id}`)).json();

    expect(body).toMatchObject({
      id,
      title: "Revised",
      summary: "Now patched.",
      body: "Second **version**.",
      bodyHtml: "<p>Second <strong>version</strong>.</p>",
      importance: 4,
      impact: "Update this week.",
      unconfirmed: true,
      revision: 1,
      previousArticleId: null,
      topics: [],
    });
    expect(body.refs.map((ref: { url: string }) => ref.url)).toEqual(["https://example.org/first", "https://example.org/second"]);
  });

  it("answers 404 for an article that does not exist", async () => {
    const s = testServer();
    const response = await s.get("/api/v1/articles/4242");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("answers 404 for an identifier that is not a number", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/articles/abc")).status).toBe(404);
  });
});

describe("read state and stars", () => {
  it("drops an article from the unread list once it is marked read, and brings it back when unmarked", async () => {
    const s = testServer();
    const id = s.article(s.category().id);

    await s.patch(`/api/v1/articles/${id}`, { isRead: true });
    expect((await (await s.get("/api/v1/articles?unread=true")).json()).items).toEqual([]);
    expect((await (await s.get(`/api/v1/articles/${id}`)).json()).isRead).toBe(true);

    await s.patch(`/api/v1/articles/${id}`, { isRead: false });
    expect((await (await s.get("/api/v1/articles?unread=true")).json()).items).toHaveLength(1);
  });

  it("marks as read everything in a category that was updated before the given time", async () => {
    const s = testServer();
    const security = s.category("Security");
    const cars = s.category("Cars");
    const listed = s.article(security.id);
    const elsewhere = s.article(cars.id);
    s.clock.advance(MINUTE);
    const listedAt = s.clock().toISOString();
    s.clock.advance(MINUTE);
    const arrivedLater = s.article(security.id);

    const response = await s.post("/api/v1/articles/mark-read", { categoryId: security.id, before: listedAt });

    expect(await response.json()).toEqual({ updated: 1 });
    const unread = (await (await s.get("/api/v1/articles?unread=true")).json()).items.map((item: { id: number }) => item.id);
    expect(unread.sort()).toEqual([elsewhere, arrivedLater].sort());
    expect(unread).not.toContain(listed);
  });

  it("lists an article under starred once it has a star", async () => {
    const s = testServer();
    const category = s.category();
    const starred = s.article(category.id);
    s.article(category.id);

    await s.patch(`/api/v1/articles/${starred}`, { starred: true });

    const body = await (await s.get("/api/v1/articles?starred=true")).json();
    expect(body.items.map((item: { id: number }) => item.id)).toEqual([starred]);
  });

  it("refuses a change with a field of the wrong type", async () => {
    const s = testServer();
    const id = s.article(s.category().id);
    const response = await s.patch(`/api/v1/articles/${id}`, { isRead: "yes" });
    expect(response.status).toBe(400);
  });
});
