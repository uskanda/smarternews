import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const FEED = "https://status.example.org/feed.xml";

function rss(items: Array<{ key: string; title: string }>): string {
  const body = items
    .map(
      (item) =>
        `<item><title>${item.title}</title><guid>${item.key}</guid><link>https://status.example.org/${item.key}</link>` +
        `<description>text</description><pubDate>Sun, 01 Mar 2026 11:00:00 GMT</pubDate></item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Status</title>${body}</channel></rss>`;
}

const title = (value: string) => ({ fields: ["title"], match: "contains", value });
const rule = (actions: string[], ...conditions: object[]) => ({ scope: { type: "all" }, conditions, actions });

async function setup() {
  const s = testServer();
  s.site.set(FEED, rss([{ key: "a", title: "障害のお知らせ" }, { key: "b", title: "メンテナンス" }]));
  const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
  return { s, feed };
}

describe("rules", () => {
  it("are listed, changed, switched and removed", async () => {
    const { s } = await setup();

    const created = await s.post("/api/v1/rules", rule(["star"], title("障害")));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({ scope: { type: "all" }, conditions: [title("障害")], actions: ["star"], enabled: true });

    const changed = await s.patch(`/api/v1/rules/${body.id}`, { actions: ["read", "star"], enabled: false });
    expect(await changed.json()).toMatchObject({ actions: ["star", "read"], enabled: false });
    expect(await (await s.get("/api/v1/rules")).json()).toEqual([expect.objectContaining({ id: body.id, enabled: false })]);

    expect((await s.delete(`/api/v1/rules/${body.id}`)).status).toBe(204);
    expect(await (await s.get("/api/v1/rules")).json()).toEqual([]);
    expect((await s.patch(`/api/v1/rules/${body.id}`, { enabled: true })).status).toBe(404);
  });

  it("count the stored feed articles they meet without changing anything", async () => {
    const { s } = await setup();

    const preview = await s.post("/api/v1/rules/preview", { scope: { type: "all" }, conditions: [title("障害")] });

    expect(await preview.json()).toEqual({ matchCount: 1 });
    expect(await (await s.get("/api/v1/rules")).json()).toEqual([]);
    expect((await (await s.get("/api/v1/articles?starred=true")).json()).items).toEqual([]);
  });

  it("refuse a rule without an action, a wrong regular expression and the same rule twice", async () => {
    const { s } = await setup();

    const empty = await s.post("/api/v1/rules", rule([], title("障害")));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.fields).toEqual([expect.objectContaining({ path: "actions" })]);

    const wrong = await s.post("/api/v1/rules", rule(["star"], { fields: ["title"], match: "regex", value: "(sale" }));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.fields).toEqual([expect.objectContaining({ path: "conditions.0.value", code: "format" })]);

    expect((await s.post("/api/v1/rules", rule(["star"], title("障害")))).status).toBe(201);
    expect((await s.post("/api/v1/rules", rule(["star"], title("障害")))).status).toBe(409);
  });

  it("act on what a fetch stores next, and list the articles to notify after a time", async () => {
    const { s, feed } = await setup();
    await s.post("/api/v1/rules", rule(["star", "notify"], title("障害")));
    s.site.set(FEED, rss([{ key: "c", title: "新たな障害" }, { key: "a", title: "障害のお知らせ" }, { key: "b", title: "メンテナンス" }]));

    await s.post(`/api/v1/feeds/${feed.id}/fetch`);

    const starred = (await (await s.get("/api/v1/articles?starred=true")).json()).items.map((item: { title: string }) => item.title);
    expect(starred).toEqual(["新たな障害"]);
    const list = await (await s.get("/api/v1/rule-notifications")).json();
    expect(list.items).toEqual([expect.objectContaining({ feedTitle: "Status", article: expect.objectContaining({ title: "新たな障害", origin: "feed" }) })]);
    const later = await (await s.get(`/api/v1/rule-notifications?after=${encodeURIComponent(list.items[0].notifiedAt)}`)).json();
    expect(later.items).toEqual([]);
    expect((await s.get("/api/v1/rule-notifications?after=yesterday")).status).toBe(400);
  });
});
