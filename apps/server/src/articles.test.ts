import { reviseArticle } from "@smarternews/core";
import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
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

describe("oldest first and the time a list was read", () => {
  it("pages oldest first, and refuses a cursor of the other order and an order for events", async () => {
    const s = testServer();
    const category = s.category();
    const ids: number[] = [];
    for (let index = 0; index < 120; index += 1) {
      ids.push(s.article(category.id));
      if (index % 3 === 0) s.clock.advance(MINUTE);
    }
    const pages: number[][] = [];
    let cursor: string | null = null;
    do {
      const body = (await (await s.get(`/api/v1/articles?order=oldest&limit=50${cursor ? `&cursor=${cursor}` : ""}`)).json()) as {
        items: Array<{ id: number }>;
        nextCursor: string | null;
      };
      pages.push(body.items.map((item) => item.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(pages.flat()).toEqual(ids);

    const newest = (await (await s.get("/api/v1/articles?limit=50")).json()) as { nextCursor: string };
    expect((await s.get(`/api/v1/articles?order=oldest&cursor=${newest.nextCursor}`)).status).toBe(400);
    expect((await s.get("/api/v1/articles?kind=event&order=oldest")).status).toBe(400);
    expect((await s.get("/api/v1/articles?recentlyRead=true&order=newest")).status).toBe(400);
    expect((await s.get("/api/v1/articles?order=random")).status).toBe(400);
  });

  it("marks all 120 articles read with the time of a list oldest first of which only 50 were read, and not one that came later", async () => {
    const s = testServer();
    const category = s.category();
    for (let index = 0; index < 120; index += 1) {
      s.article(category.id);
      s.clock.advance(MINUTE);
    }
    const first = await (await s.get(`/api/v1/articles?category=${category.id}&unread=true&order=oldest&limit=50`)).json();
    expect(first.items).toHaveLength(50);
    expect(first.asOf).toBe(s.clock().toISOString());
    s.clock.advance(MINUTE);
    const later = s.article(category.id);

    const marked = await (await s.post("/api/v1/articles/mark-read", { categoryId: category.id, before: first.asOf })).json();

    expect(marked.updated).toBe(120);
    const unread = await (await s.get(`/api/v1/articles?category=${category.id}&unread=true`)).json();
    expect(unread.items.map((item: { id: number }) => item.id)).toEqual([later]);
  });

  it("says when the recently read articles and a search were read", async () => {
    const s = testServer();
    s.article(s.category().id, { title: "電池の話" });
    expect((await (await s.get("/api/v1/articles?recentlyRead=true")).json()).asOf).toBe(s.clock().toISOString());
    expect((await (await s.get("/api/v1/search?q=電池")).json()).asOf).toBe(s.clock().toISOString());
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

  it("names the other feeds that delivered a kept feed article, with the id of each copy", async () => {
    const s = testServer();
    const [a, b, c] = ["Feed A", "Feed B", "Feed C"].map((title) => seedFeed(s.db, { title }));
    const kept = seedFeedArticle(s.db, a!, { storedAt: "2026-03-01T01:00:00.000Z" });
    const copyB = seedFeedArticle(s.db, b!, { storedAt: "2026-03-01T02:00:00.000Z", duplicateOf: kept });
    const copyC = seedFeedArticle(s.db, c!, { storedAt: "2026-03-01T03:00:00.000Z", duplicateOf: kept });

    expect((await (await s.get(`/api/v1/articles/${kept}`)).json()).otherFeeds).toEqual([
      { articleId: copyB, feedId: b, feedTitle: "Feed B" },
      { articleId: copyC, feedId: c, feedTitle: "Feed C" },
    ]);
  });

  it("names no other feed for an article without duplicates", async () => {
    const s = testServer();
    const id = seedFeedArticle(s.db, seedFeed(s.db));
    expect((await (await s.get(`/api/v1/articles/${id}`)).json()).otherFeeds).toEqual([]);
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

    expect(await response.json()).toEqual({ updated: 1, ids: [listed] });
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

describe("importance filter", () => {
  it("returns only the articles at or above the given importance", async () => {
    const s = testServer();
    const category = s.category();
    s.article(category.id, { importance: 3 });
    const four = s.article(category.id, { importance: 4 });
    const five = s.article(category.id, { importance: 5 });

    const body = await (await s.get("/api/v1/articles?minImportance=4")).json();

    expect(body.items.map((item: { id: number }) => item.id).sort()).toEqual([four, five]);
  });

  it("refuses an importance outside one to five", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/articles?minImportance=9")).status).toBe(400);
  });
});

describe("ended events in lists without a kind", () => {
  function seeded() {
    const s = testServer("2026-03-10T12:00:00.000Z");
    const news = s.category("News");
    const events = s.category("Events", "event");
    const event = (startsAt: string, endsAt: string) =>
      s.article(events.id, { kind: "event", event: { key: startsAt, startsAt, endsAt, venue: null, fee: null, registration: "unknown" } });
    const story = s.article(news.id);
    const ended = event("2026-03-09T10:00:00.000Z", "2026-03-09T16:00:00.000Z");
    const upcoming = event("2026-03-11T10:00:00.000Z", "2026-03-11T16:00:00.000Z");
    return { s, news, events, story, ended, upcoming };
  }

  it("leaves out events that have ended", async () => {
    const { s, story, upcoming } = seeded();
    const body = await (await s.get("/api/v1/articles")).json();
    expect(body.items.map((item: { id: number }) => item.id).sort()).toEqual([story, upcoming].sort());
  });

  it("includes them when asked to", async () => {
    const { s } = seeded();
    const body = await (await s.get("/api/v1/articles?includeEnded=true")).json();
    expect(body.items).toHaveLength(3);
  });

  it("counts unread per category without the ended events", async () => {
    const { s, news, events, story } = seeded();
    await s.patch(`/api/v1/articles/${story}`, { starred: true });
    const second = s.article(news.id);
    await s.patch(`/api/v1/articles/${second}`, { isRead: true });

    const counts = await (await s.get("/api/v1/counts")).json();

    expect(counts).toEqual({
      unread: 2,
      starred: 1,
      generatedUnread: 2,
      uncategorizedUnread: 0,
      categories: [
        { categoryId: news.id, unread: 1, total: 2, generatedUnread: 1, generatedTotal: 2 },
        { categoryId: events.id, unread: 1, total: 2, generatedUnread: 1, generatedTotal: 2 },
      ],
      feeds: [],
    });
  });
});

describe("counts", () => {
  it("gives the unread and total per category, and the starred total", async () => {
    const s = testServer();
    const a = s.category("A");
    const b = s.category("B");
    const empty = s.category("Empty");
    const first = s.article(a.id);
    s.article(a.id);
    const read = s.article(a.id);
    s.article(b.id);
    await s.patch(`/api/v1/articles/${read}`, { isRead: true });
    await s.patch(`/api/v1/articles/${first}`, { starred: true });

    const counts = await (await s.get("/api/v1/counts")).json();

    expect(counts).toEqual({
      unread: 3,
      starred: 1,
      generatedUnread: 3,
      uncategorizedUnread: 0,
      categories: [
        { categoryId: a.id, unread: 2, total: 3, generatedUnread: 2, generatedTotal: 3 },
        { categoryId: b.id, unread: 1, total: 1, generatedUnread: 1, generatedTotal: 1 },
        { categoryId: empty.id, unread: 0, total: 0, generatedUnread: 0, generatedTotal: 0 },
      ],
      feeds: [],
    });
  });
});

describe("bulk read state", () => {
  it("marks only the articles at or above the given importance and names them", async () => {
    const s = testServer();
    const category = s.category();
    s.article(category.id, { importance: 3 });
    s.article(category.id, { importance: 3 });
    const four = s.article(category.id, { importance: 4 });
    s.clock.advance(60_000);

    const response = await s.post("/api/v1/articles/mark-read", { before: s.clock().toISOString(), minImportance: 4 });

    expect(await response.json()).toEqual({ updated: 1, ids: [four] });
    expect((await (await s.get("/api/v1/articles?unread=true")).json()).items).toHaveLength(2);
  });

  it("names every article it marked", async () => {
    const s = testServer();
    const category = s.category();
    const ids = [s.article(category.id), s.article(category.id), s.article(category.id)];
    s.clock.advance(60_000);

    const body = await (await s.post("/api/v1/articles/mark-read", { before: s.clock().toISOString() })).json();

    expect(body.ids.sort()).toEqual(ids);
  });

  it("puts the named articles back to unread and leaves the others alone", async () => {
    const s = testServer();
    const category = s.category();
    const ids = [s.article(category.id), s.article(category.id), s.article(category.id)];
    const other = s.article(category.id);
    for (const id of [...ids, other]) await s.patch(`/api/v1/articles/${id}`, { isRead: true });

    const response = await s.post("/api/v1/articles/mark-unread", { ids });

    expect(await response.json()).toEqual({ updated: 3 });
    const unread = (await (await s.get("/api/v1/articles?unread=true")).json()).items.map((item: { id: number }) => item.id);
    expect(unread.sort()).toEqual(ids);
  });

  it("refuses a request to unmark without a list of identifiers", async () => {
    const s = testServer();
    expect((await s.post("/api/v1/articles/mark-unread", { ids: "all" })).status).toBe(400);
  });
});

describe("POST /api/v1/articles/mark-read with the articles a screen showed", () => {
  type Item = { id: number; updatedAt: string; readAt: string | null };
  const shown = (items: Item[]) => items.map((item) => ({ id: item.id, updatedAt: item.updatedAt }));

  it("marks the articles read with the server's time and names them, and lists them among the recently read", async () => {
    const s = testServer();
    const category = s.category();
    const ids = [s.article(category.id), s.article(category.id), s.article(category.id)];
    const listed: Item[] = (await (await s.get(`/api/v1/articles?category=${category.id}`)).json()).items;
    s.clock.advance(MINUTE);
    const readAt = s.clock().toISOString();

    const response = await s.post("/api/v1/articles/mark-read", { articles: shown(listed.slice(0, 2)) });

    expect(await response.json()).toEqual({ updated: 2, ids: listed.slice(0, 2).map((item) => item.id).sort((a, b) => a - b) });
    const recent: Item[] = (await (await s.get("/api/v1/articles?recentlyRead=true")).json()).items;
    expect(recent.map((item) => item.id).sort()).toEqual(listed.slice(0, 2).map((item) => item.id).sort());
    expect(recent.map((item) => item.readAt)).toEqual([readAt, readAt]);
    expect(ids).toContain(listed[2]!.id);
    expect((await (await s.get(`/api/v1/articles/${listed[2]!.id}`)).json()).isRead).toBe(false);
  });

  it("leaves out an article that a follow-up updated after the version shown, and one that is gone", async () => {
    const s = testServer();
    const category = s.category();
    const id = s.article(category.id);
    const listed: Item[] = (await (await s.get(`/api/v1/articles?category=${category.id}`)).json()).items;
    s.clock.advance(MINUTE);
    s.db.prepare("UPDATE articles SET updated_at = ? WHERE id = ?").run(s.clock().toISOString(), id);

    const response = await s.post("/api/v1/articles/mark-read", { articles: [...shown(listed), { id: 9999, updatedAt: listed[0]!.updatedAt }] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 0, ids: [] });
    expect((await (await s.get(`/api/v1/articles/${id}`)).json()).isRead).toBe(false);
  });

  it("refuses more than 500 articles and marks none of them, saying there are too many", async () => {
    const s = testServer();
    const category = s.category();
    const id = s.article(category.id);
    const articles = Array.from({ length: 501 }, () => ({ id, updatedAt: s.clock().toISOString() }));

    const response = await s.post("/api/v1/articles/mark-read", { articles });

    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual([{ path: "articles", message: "too many articles: at most 500" }]);
    expect((await (await s.get(`/api/v1/articles/${id}`)).json()).isRead).toBe(false);
  });

  it("refuses a body that mixes the articles with a range, and an empty list", async () => {
    const s = testServer();
    const id = s.article(s.category().id);
    const articles = [{ id, updatedAt: s.clock().toISOString() }];
    expect((await s.post("/api/v1/articles/mark-read", { articles, before: s.clock().toISOString() })).status).toBe(400);
    expect((await s.post("/api/v1/articles/mark-read", { articles: [] })).status).toBe(400);
  });
});

describe("read times and the recently read articles", () => {
  type Item = { id: number; readAt: string | null };
  const ids = (body: { items: Item[] }) => body.items.map((item) => item.id);

  it("records the server's time when an article is read, and keeps it when it is read again", async () => {
    const s = testServer();
    const id = s.article(s.category().id);
    const readAt = s.clock().toISOString();

    expect((await (await s.patch(`/api/v1/articles/${id}`, { isRead: true })).json()).readAt).toBe(readAt);
    s.clock.advance(MINUTE);
    await s.patch(`/api/v1/articles/${id}`, { isRead: true });

    expect((await (await s.get(`/api/v1/articles/${id}`)).json()).readAt).toBe(readAt);
    expect((await (await s.patch(`/api/v1/articles/${id}`, { isRead: false })).json()).readAt).toBeNull();
  });

  it("lists what was read one by one and by mark all as read, last read first, and drops what undoing puts back", async () => {
    const s = testServer();
    const category = s.category();
    const opened = s.article(category.id);
    const marked = [s.article(category.id), s.article(category.id)];
    await s.patch(`/api/v1/articles/${opened}`, { isRead: true });
    s.clock.advance(MINUTE);
    const markedAt = s.clock().toISOString();
    await s.post("/api/v1/articles/mark-read", { categoryId: category.id, before: markedAt });

    const body = await (await s.get("/api/v1/articles?recentlyRead=true")).json();
    expect(ids(body)).toEqual([...marked].reverse().concat(opened));
    expect(body.items.slice(0, 2).map((item: Item) => item.readAt)).toEqual([markedAt, markedAt]);

    await s.post("/api/v1/articles/mark-unread", { ids: marked });
    expect(ids(await (await s.get("/api/v1/articles?recentlyRead=true")).json())).toEqual([opened]);
    s.clock.advance(8 * DAY);
    expect(ids(await (await s.get("/api/v1/articles?recentlyRead=true")).json())).toEqual([]);
  });

  it("refuses the recently read articles together with another narrowing", async () => {
    const s = testServer();
    const response = await s.get(`/api/v1/articles?recentlyRead=true&category=${s.category().id}`);
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields[0].path).toBe("category");
  });
});

describe("POST /api/v1/articles/:id/open", () => {
  it("records the server's time the first time, answers the first time after that, and leaves the article unread", async () => {
    const s = testServer();
    const category = s.category();
    const id = s.article(category.id);
    const openedAt = s.clock().toISOString();

    const first = await s.post(`/api/v1/articles/${id}/open`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ openedAt });
    s.clock.advance(MINUTE);
    expect(await (await s.post(`/api/v1/articles/${id}/open`)).json()).toEqual({ openedAt });

    expect(await (await s.get(`/api/v1/articles/${id}`)).json()).toMatchObject({ isRead: false, openedAt });
    expect((await (await s.get("/api/v1/counts")).json()).unread).toBe(1);
  });

  it("is set neither by reading nor by mark all as read, and both lists and the detail give it", async () => {
    const s = testServer();
    const category = s.category();
    const opened = s.article(category.id);
    const bulk = s.article(category.id);
    const openedAt = s.clock().toISOString();
    await s.post(`/api/v1/articles/${opened}/open`);
    s.clock.advance(MINUTE);
    await s.patch(`/api/v1/articles/${opened}`, { isRead: true });
    await s.post("/api/v1/articles/mark-read", { before: s.clock().toISOString() });

    const items = (await (await s.get("/api/v1/articles?unread=false")).json()).items as Array<{ id: number; openedAt: string | null }>;
    expect(items.find((item) => item.id === opened)!.openedAt).toBe(openedAt);
    expect(items.find((item) => item.id === bulk)!.openedAt).toBeNull();
    expect((await (await s.get(`/api/v1/articles/${bulk}`)).json()).openedAt).toBeNull();
  });

  it("answers 404 for an article that does not exist", async () => {
    const s = testServer();
    const response = await s.post("/api/v1/articles/999/open");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });
});
