import { replaceMentions } from "@smarternews/core";
import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const MINUTE = 60_000;
const BOJ = { name: "日本銀行", kind: "organization" } as const;

const ids = (body: { items: Array<{ id: number }> }) => body.items.map((item) => item.id);
const ofName = (name: string, rest = "") => `/api/v1/mentions/articles?name=${encodeURIComponent(name)}${rest}`;

describe("the names in the article detail", () => {
  it("gives the names of an article in the order they were stored", async () => {
    const s = testServer();
    const id = s.article(s.category().id);
    replaceMentions(s.db, id, [BOJ, { name: "植田和男", kind: "person" }]);

    const body = await (await s.get(`/api/v1/articles/${id}`)).json();
    expect(body.mentions).toEqual([BOJ, { name: "植田和男", kind: "person" }]);
  });

  it("gives an empty list for a feed article of a feed that does not summarise", async () => {
    const s = testServer();
    const id = seedFeedArticle(s.db, seedFeed(s.db));
    expect((await (await s.get(`/api/v1/articles/${id}`)).json()).mentions).toEqual([]);
  });
});

describe("GET /api/v1/mentions/articles", () => {
  it("needs the API token", async () => {
    const s = testServer();
    expect((await s.get(ofName("日本銀行"), null)).status).toBe(401);
  });

  it("returns the generated and feed articles of the name, newest first, with their origin, in the shape of the article list", async () => {
    const s = testServer();
    const generated = s.article(s.category().id, { title: "金融政策" });
    s.clock.advance(MINUTE);
    const delivered = seedFeedArticle(s.db, seedFeed(s.db), { at: s.clock().toISOString(), isRead: true });
    replaceMentions(s.db, generated, [BOJ]);
    replaceMentions(s.db, delivered, [BOJ]);

    const response = await s.get(ofName("日本銀行"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ids(body)).toEqual([delivered, generated]);
    expect(body.items.map((item: { origin: string }) => item.origin)).toEqual(["feed", "generated"]);
    expect(body).toMatchObject({ nextCursor: null, asOf: s.clock().toISOString() });
  });

  it("compares the name given in full width with the stored one", async () => {
    const s = testServer();
    const id = s.article(s.category().id);
    replaceMentions(s.db, id, [{ name: "OpenAI", kind: "organization" }]);
    expect(ids(await (await s.get(ofName("ＯｐｅｎＡＩ"))).json())).toEqual([id]);
  });

  it("returns an empty list for a name no article has", async () => {
    const s = testServer();
    const response = await s.get(ofName("日本銀行"));
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([]);
  });

  it("pages through 120 articles without repeating any, newest first", async () => {
    const s = testServer();
    const category = s.category();
    const all: number[] = [];
    for (let index = 0; index < 120; index += 1) {
      const id = s.article(category.id, { title: `記事 ${index}` });
      replaceMentions(s.db, id, [BOJ]);
      all.unshift(id);
      s.clock.advance(MINUTE);
    }
    const pages: number[][] = [];
    let cursor: string | null = null;
    let last: { nextCursor: string | null } | undefined;
    do {
      const body: { items: Array<{ id: number }>; nextCursor: string | null } = await (await s.get(ofName("日本銀行", `&limit=50${cursor ? `&cursor=${cursor}` : ""}`))).json();
      pages.push(ids(body));
      cursor = body.nextCursor;
      last = body;
    } while (cursor);
    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(pages.flat()).toEqual(all);
    expect(last!.nextCursor).toBeNull();
  });

  it("refuses a name of spaces only, a name longer than 100 characters, and no name", async () => {
    const s = testServer();
    const empty = await s.get(ofName(" 　"));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatchObject({ code: "invalid_input", fields: [{ path: "name", message: "is empty" }] });
    expect((await s.get(ofName("あ".repeat(101)))).status).toBe(400);
    expect((await s.get("/api/v1/mentions/articles")).status).toBe(400);
  });

  it("calls neither a model nor the translation API", async () => {
    const s = testServer();
    const id = seedFeedArticle(s.db, seedFeed(s.db), { title: "Quarterly results" });
    replaceMentions(s.db, id, [BOJ]);
    const body = await (await s.get(ofName("日本銀行"))).json();
    expect(ids(body)).toEqual([id]);
    expect(Object.values(s.llmRequests).flat()).toEqual([]);
    expect(s.google?.calls ?? []).toEqual([]);
  });
});
