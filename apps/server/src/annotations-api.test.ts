import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const MINUTE = 60_000;
const anchor = { quote: "電池の工場を新設する", prefix: "同社は", suffix: "と発表した。", position: 3 };

/** How much the server has asked of a model and of the translation API so far. */
async function usage(s: ReturnType<typeof testServer>) {
  return {
    llm: Object.values(s.llmRequests).flat().length,
    llmCalls: s.db.prepare("SELECT count(*) AS n FROM llm_calls").get()!.n,
    google: s.google!.calls.length,
    chars: (await (await s.get("/api/v1/translation")).json()).chars,
  };
}

describe("highlights through the API", () => {
  it("adds a highlight with 201, gives it in the article's detail, and removes it", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id);
    const response = await s.post(`/api/v1/articles/${articleId}/highlights`, anchor);
    expect(response.status).toBe(201);
    const highlight = await response.json();
    expect(highlight).toEqual({ id: expect.any(Number), articleId, ...anchor, note: null, createdAt: "2026-03-01T12:00:00.000Z", updatedAt: "2026-03-01T12:00:00.000Z" });
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations).toEqual({ note: null, highlights: [highlight] });

    expect((await s.delete(`/api/v1/highlights/${highlight.id}`)).status).toBe(204);
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations.highlights).toEqual([]);
  });

  it("writes a note on a highlight later, keeping when it was made, and removes only the note", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id);
    const highlight = await (await s.post(`/api/v1/articles/${articleId}/highlights`, { ...anchor, note: "  " })).json();
    expect(highlight.note).toBeNull();
    s.clock.advance(3 * 24 * 60 * MINUTE);
    const written = await (await s.patch(`/api/v1/highlights/${highlight.id}`, { note: "数字を確かめる" })).json();
    expect(written).toMatchObject({ note: "数字を確かめる", createdAt: highlight.createdAt, updatedAt: "2026-03-04T12:00:00.000Z" });
    expect((await (await s.patch(`/api/v1/highlights/${highlight.id}`, { note: null })).json()).note).toBeNull();
  });

  it("gives two highlights in the order they were made, with the note on the whole article", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id);
    const first = await (await s.post(`/api/v1/articles/${articleId}/highlights`, anchor)).json();
    s.clock.advance(MINUTE);
    const second = await (await s.post(`/api/v1/articles/${articleId}/highlights`, { ...anchor, quote: "発表", note: "メモ" })).json();
    const note = await (await s.put(`/api/v1/articles/${articleId}/note`, { text: "あとで比べる" })).json();
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations).toEqual({ note, highlights: [first, second] });
  });

  it("gives an article without annotations empty ones, and leaves them out of the article list", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id);
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations).toEqual({ note: null, highlights: [] });
    expect((await (await s.get("/api/v1/articles")).json()).items[0]).not.toHaveProperty("annotations");
  });
});

describe("the note on a whole article through the API", () => {
  it("saves a note, replaces it, and removes it with 204 even when there is none", async () => {
    const s = testServer();
    const articleId = seedFeedArticle(s.db, seedFeed(s.db));
    const saved = await (await s.put(`/api/v1/articles/${articleId}/note`, { text: "A" })).json();
    expect(saved).toEqual({ id: expect.any(Number), articleId, text: "A", createdAt: "2026-03-01T12:00:00.000Z", updatedAt: "2026-03-01T12:00:00.000Z" });
    s.clock.advance(MINUTE);
    const replaced = await (await s.put(`/api/v1/articles/${articleId}/note`, { text: " B " })).json();
    expect(replaced).toMatchObject({ id: saved.id, text: "B", createdAt: saved.createdAt });
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations.note).toEqual(replaced);
    expect((await s.delete(`/api/v1/articles/${articleId}/note`)).status).toBe(204);
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations.note).toBeNull();
    expect((await s.delete(`/api/v1/articles/${articleId}/note`)).status).toBe(204);
  });
});

describe("refused annotations", () => {
  it("refuses an empty quote with 400 and stores nothing", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id);
    const response = await s.post(`/api/v1/articles/${articleId}/highlights`, { ...anchor, quote: "" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual([{ path: "quote", message: "is empty" }]);
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations.highlights).toEqual([]);
  });

  it("refuses a note of 5001 characters and one of spaces only, and leaves the note as it was", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id);
    await s.put(`/api/v1/articles/${articleId}/note`, { text: "元のメモ" });
    const long = await s.put(`/api/v1/articles/${articleId}/note`, { text: "あ".repeat(5001) });
    expect(long.status).toBe(400);
    expect((await long.json()).error.fields.map((field: { path: string }) => field.path)).toEqual(["text"]);
    expect((await s.put(`/api/v1/articles/${articleId}/note`, { text: "  \n " })).status).toBe(400);
    expect((await s.patch(`/api/v1/highlights/1`, { note: "あ".repeat(5001) })).status).toBe(400);
    expect((await (await s.get(`/api/v1/articles/${articleId}`)).json()).annotations.note.text).toBe("元のメモ");
  });

  it("answers 404 for an article or a highlight that does not exist", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id);
    const highlight = await (await s.post(`/api/v1/articles/${articleId}/highlights`, anchor)).json();
    await s.delete(`/api/v1/highlights/${highlight.id}`);
    expect((await s.patch(`/api/v1/highlights/${highlight.id}`, { note: "x" })).status).toBe(404);
    expect((await s.delete(`/api/v1/highlights/${highlight.id}`)).status).toBe(404);
    s.db.prepare("DELETE FROM articles WHERE id = ?").run(articleId);
    expect((await s.post(`/api/v1/articles/${articleId}/highlights`, anchor)).status).toBe(404);
    expect((await s.put(`/api/v1/articles/${articleId}/note`, { text: "x" })).status).toBe(404);
    expect((await s.delete(`/api/v1/articles/${articleId}/note`)).status).toBe(404);
  });
});

describe("GET /api/v1/annotations", () => {
  it("lists the annotations of every article, the last made first, a page at a time", async () => {
    const s = testServer();
    const a = s.article(s.category().id, { title: "記事A" });
    const b = seedFeedArticle(s.db, seedFeed(s.db), { title: "記事B" });
    await s.post(`/api/v1/articles/${a}/highlights`, anchor);
    s.clock.advance(30 * MINUTE);
    await s.put(`/api/v1/articles/${b}/note`, { text: "あとで比べる" });
    s.clock.advance(20 * MINUTE);
    await s.post(`/api/v1/articles/${a}/highlights`, { ...anchor, quote: "発表" });
    const first = await (await s.get("/api/v1/annotations?limit=2")).json();
    expect(first.items.map((item: { kind: string; articleId: number; title: string; quote: string | null }) => [item.kind, item.articleId, item.title, item.quote])).toEqual([
      ["highlight", a, "記事A", "発表"],
      ["note", b, "記事B", null],
    ]);
    const second = await (await s.get(`/api/v1/annotations?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items.map((item: { quote: string }) => item.quote)).toEqual([anchor.quote]);
    expect(second.nextCursor).toBeNull();
    expect((await s.get("/api/v1/annotations?cursor=nonsense")).status).toBe(400);
  });

  it("counts the annotated articles of each feed in the list of feeds", async () => {
    const s = testServer();
    const feedId = seedFeed(s.db);
    const one = seedFeedArticle(s.db, feedId);
    const two = seedFeedArticle(s.db, feedId);
    await s.post(`/api/v1/articles/${one}/highlights`, anchor);
    await s.post(`/api/v1/articles/${one}/highlights`, anchor);
    await s.put(`/api/v1/articles/${one}/note`, { text: "メモ" });
    await s.post(`/api/v1/articles/${two}/highlights`, anchor);
    expect((await (await s.get("/api/v1/feeds")).json())[0]).toMatchObject({ id: feedId, annotatedCount: 2 });
  });
});

describe("annotations and models", () => {
  it("never calls a model or the translation API, on an English feed article that translates", async () => {
    const s = testServer();
    const feedId = seedFeed(s.db);
    s.db.prepare("UPDATE feeds SET translate = 1 WHERE id = ?").run(feedId);
    const articleId = seedFeedArticle(s.db, feedId, { title: "Vendor ships a battery plant", body: "The vendor will build a battery plant." });
    const before = await usage(s);
    const highlight = await (await s.post(`/api/v1/articles/${articleId}/highlights`, { quote: "battery plant", prefix: "willbuilda", suffix: ".", position: 17 })).json();
    await s.patch(`/api/v1/highlights/${highlight.id}`, { note: "compare" });
    await s.put(`/api/v1/articles/${articleId}/note`, { text: "later" });
    await s.get("/api/v1/annotations");
    await s.get(`/api/v1/search?q=compare`);
    await s.delete(`/api/v1/articles/${articleId}/note`);
    await s.delete(`/api/v1/highlights/${highlight.id}`);
    expect(await usage(s)).toEqual(before);
  });
});

describe("the examples of docs/api.md", () => {
  it("answers the requests of the annotations section", async () => {
    const s = testServer();
    const articleId = s.article(s.category().id, { body: "The company will build a new battery plant near the coast." });
    expect(articleId).toBe(1);
    const highlight = await s.post("/api/v1/articles/1/highlights", {
      quote: "a new battery plant",
      prefix: "Thecompanywillbuild",
      suffix: "nearthecoast.",
      position: 19,
      note: "Check the size",
    });
    expect(highlight.status).toBe(201);
    expect((await s.put("/api/v1/articles/1/note", { text: "Compare with last year" })).status).toBe(200);
    const list = await (await s.get("/api/v1/annotations?limit=20")).json();
    expect(list.items.map((item: { kind: string }) => item.kind)).toEqual(["note", "highlight"]);
  });
});
