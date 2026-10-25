import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

type Group = { id: number; name: string; color: string; terms: Array<{ id: number; text: string }> };

async function group(s: ReturnType<typeof testServer>, name: string, color?: string): Promise<Group> {
  const response = await s.post("/api/v1/term-groups", color === undefined ? { name } : { name, color });
  expect(response.status).toBe(201);
  return response.json();
}

describe("term groups", () => {
  it("are listed in their order, with name, colour and terms", async () => {
    const s = testServer();
    const a = await group(s, "A");
    await group(s, "B", "purple");
    await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "規制" });
    await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "関税" });

    const listed = (await (await s.get("/api/v1/term-groups")).json()) as Group[];

    expect(listed).toEqual([
      { id: a.id, name: "A", color: "green", terms: [expect.objectContaining({ text: "規制" }), expect.objectContaining({ text: "関税" })] },
      { id: expect.any(Number), name: "B", color: "purple", terms: [] },
    ]);
  });

  it("take a term and answer with the group", async () => {
    const s = testServer();
    const a = await group(s, "A");
    const added = await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "規制" });
    expect(added.status).toBe(201);
    expect(((await added.json()) as Group).terms.map((term) => term.text)).toEqual(["規制"]);
    expect(((await (await s.get("/api/v1/term-groups")).json()) as Group[])[0]!.terms.map((term) => term.text)).toEqual(["規制"]);
  });

  it("change, and lose a term and then themselves", async () => {
    const s = testServer();
    const a = await group(s, "A");
    const term = ((await (await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "規制" })).json()) as Group).terms[0]!;
    expect(await (await s.patch(`/api/v1/term-groups/${a.id}`, { name: "A2", color: "pink" })).json()).toMatchObject({ name: "A2", color: "pink" });
    expect((await s.delete(`/api/v1/term-groups/${a.id}/terms/${term.id}`)).status).toBe(204);
    expect((await s.delete(`/api/v1/term-groups/${a.id}`)).status).toBe(204);
    expect(await (await s.get("/api/v1/term-groups")).json()).toEqual([]);
  });

  it("move before another and answer with the list in the new order", async () => {
    const s = testServer();
    const a = await group(s, "A");
    const b = await group(s, "B");
    const moved = await s.post(`/api/v1/term-groups/${b.id}/move`, { before: a.id });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as Group[]).map((entry) => entry.name)).toEqual(["B", "A"]);
    expect(((await (await s.post(`/api/v1/term-groups/${b.id}/move`, { before: null })).json()) as Group[]).map((entry) => entry.name)).toEqual(["A", "B"]);
  });

  it("answer 404 for a group or term that does not exist", async () => {
    const s = testServer();
    const a = await group(s, "A");
    await s.delete(`/api/v1/term-groups/${a.id}`);
    expect((await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "規制" })).status).toBe(404);
    expect((await s.patch(`/api/v1/term-groups/${a.id}`, { name: "x" })).status).toBe(404);
    expect((await s.delete(`/api/v1/term-groups/${a.id}`)).status).toBe(404);
    expect((await s.post(`/api/v1/term-groups/${a.id}/move`, { before: null })).status).toBe(404);
    const b = await group(s, "B");
    expect((await s.delete(`/api/v1/term-groups/${b.id}/terms/99`)).status).toBe(404);
    expect((await s.delete(`/api/v1/term-groups/${b.id}/terms/x`)).status).toBe(404);
  });

  it("answer 400 for an empty name, an empty term, a colour outside the four, and a place that does not exist", async () => {
    const s = testServer();
    const empty = await s.post("/api/v1/term-groups", { name: "  " });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.fields).toEqual([expect.objectContaining({ path: "name" })]);
    const yellow = await s.post("/api/v1/term-groups", { name: "A", color: "yellow" });
    expect(yellow.status).toBe(400);
    expect(JSON.stringify((await yellow.json()).error.fields)).toMatch(/green.*purple.*pink.*orange/);
    const a = await group(s, "A");
    const blank = await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "   " });
    expect(blank.status).toBe(400);
    expect((await blank.json()).error.fields).toEqual([expect.objectContaining({ path: "text" })]);
    expect((await s.post(`/api/v1/term-groups/${a.id}/move`, { before: 99 })).status).toBe(400);
    expect((await s.post(`/api/v1/term-groups/${a.id}/move`, {})).status).toBe(400);
  });

  it("answer 409 for a name or term that is registered already", async () => {
    const s = testServer();
    const a = await group(s, "A");
    expect((await s.post("/api/v1/term-groups", { name: "A" })).status).toBe(409);
    await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "tsmc" });
    expect((await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "ＴＳＭＣ" })).status).toBe(409);
  });

  it("call no model, and the article list and counts stay as they were", async () => {
    const s = testServer();
    const category = s.category();
    s.article(category.id, { title: "規制の話" });
    const before = { list: await (await s.get("/api/v1/articles")).json(), counts: await (await s.get("/api/v1/counts")).json() };
    const llmCalls = () => Object.values(s.llmRequests).flat().length;
    const calls = llmCalls();

    const a = await group(s, "A");
    await s.post(`/api/v1/term-groups/${a.id}/terms`, { text: "規制" });
    await s.get("/api/v1/term-groups");

    expect({ list: await (await s.get("/api/v1/articles")).json(), counts: await (await s.get("/api/v1/counts")).json() }).toEqual(before);
    expect(llmCalls()).toBe(calls);
  });

  it("need the API token", async () => {
    const s = testServer();
    expect((await s.get("/api/v1/term-groups", null)).status).toBe(401);
  });
});
