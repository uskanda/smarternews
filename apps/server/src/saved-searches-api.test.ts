import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

type Saved = { id: number; name: string; query: string; categoryId: number | null; feedId: number | null };

async function save(s: ReturnType<typeof testServer>, input: Record<string, unknown>): Promise<Saved> {
  const response = await s.post("/api/v1/saved-searches", input);
  expect(response.status).toBe(201);
  return response.json();
}

const names = async (s: ReturnType<typeof testServer>) => ((await (await s.get("/api/v1/saved-searches")).json()) as Saved[]).map((saved) => saved.name);

describe("saved searches", () => {
  it("are listed in their order, with name, words and narrowing", async () => {
    const s = testServer();
    const category = s.category();
    const a = await save(s, { name: "A", query: "量子" });
    const b = await save(s, { name: "B", query: "電池", categoryId: category.id });
    expect(await (await s.get("/api/v1/saved-searches")).json()).toEqual([
      { id: a.id, name: "A", query: "量子", categoryId: null, feedId: null },
      { id: b.id, name: "B", query: "電池", categoryId: category.id, feedId: null },
    ]);
  });

  it("change their name, move, and are deleted", async () => {
    const s = testServer();
    const a = await save(s, { name: "A", query: "量子" });
    const b = await save(s, { name: "B", query: "電池" });
    expect(await (await s.patch(`/api/v1/saved-searches/${a.id}`, { name: "C" })).json()).toMatchObject({ name: "C", query: "量子" });
    const moved = await s.post(`/api/v1/saved-searches/${b.id}/move`, { before: a.id });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as Saved[]).map((saved) => saved.name)).toEqual(["B", "C"]);
    expect((await s.delete(`/api/v1/saved-searches/${a.id}`)).status).toBe(204);
    expect(await names(s)).toEqual(["B"]);
  });

  it("answer 400 for empty or long words, both narrowings, an unknown category, and an empty name", async () => {
    const s = testServer();
    const category = s.category();
    const blank = await s.post("/api/v1/saved-searches", { name: "A", query: "  " });
    expect(blank.status).toBe(400);
    expect((await blank.json()).error.fields).toEqual([expect.objectContaining({ path: "query" })]);
    expect((await s.post("/api/v1/saved-searches", { name: "A", query: "あ".repeat(201) })).status).toBe(400);
    const both = await s.post("/api/v1/saved-searches", { name: "A", query: "量子", categoryId: category.id, feedId: 1 });
    expect(both.status).toBe(400);
    expect((await both.json()).error.fields).toEqual([expect.objectContaining({ path: "feedId", code: "not_allowed" })]);
    const unknown = await s.post("/api/v1/saved-searches", { name: "A", query: "量子", categoryId: 999 });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.fields).toEqual([expect.objectContaining({ path: "categoryId", code: "no_such_item" })]);
    expect((await s.post("/api/v1/saved-searches", { name: " ", query: "量子" })).status).toBe(400);
    const a = await save(s, { name: "A", query: "量子" });
    expect((await s.patch(`/api/v1/saved-searches/${a.id}`, { name: "" })).status).toBe(400);
    expect((await s.post(`/api/v1/saved-searches/${a.id}/move`, { before: 99 })).status).toBe(400);
    expect(await names(s)).toEqual(["A"]);
  });

  it("answer 404 for one that does not exist", async () => {
    const s = testServer();
    const a = await save(s, { name: "A", query: "量子" });
    await s.delete(`/api/v1/saved-searches/${a.id}`);
    expect((await s.patch(`/api/v1/saved-searches/${a.id}`, { name: "x" })).status).toBe(404);
    expect((await s.delete(`/api/v1/saved-searches/${a.id}`)).status).toBe(404);
    expect((await s.post(`/api/v1/saved-searches/${a.id}/move`, { before: null })).status).toBe(404);
  });

  it("are counted with the counts, without a model", async () => {
    const s = testServer();
    const category = s.category();
    s.article(category.id, { title: "量子の計算機" });
    s.article(category.id, { title: "電池の話" });
    const llmCalls = () => Object.values(s.llmRequests).flat().length;
    const calls = llmCalls();
    const a = await save(s, { name: "A", query: "量子" });
    const b = await save(s, { name: "B", query: "存在しない語" });
    const counts = await (await s.get("/api/v1/counts")).json();
    expect(counts.savedSearches).toEqual([
      { id: a.id, unread: 1 },
      { id: b.id, unread: 0 },
    ]);
    expect(llmCalls()).toBe(calls);
  });

  it("need the API token", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/saved-searches", null)).status).toBe(401);
  });
});
