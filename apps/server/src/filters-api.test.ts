import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const FEED = "https://shop.example.org/feed.xml";

function rss(items: Array<{ key: string; title: string; content?: string }>): string {
  const body = items
    .map(
      (item) =>
        `<item><title>${item.title}</title><guid>${item.key}</guid><link>https://shop.example.org/${item.key}</link>` +
        `<description>${item.content ?? "text"}</description><pubDate>Sun, 01 Mar 2026 11:00:00 GMT</pubDate></item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Shop News</title>${body}</channel></rss>`;
}

const title = (value: string) => ({ fields: ["title"], match: "contains", value });
const hide = (...conditions: object[]) => ({ action: "hide", scope: { type: "all" }, conditions });

async function setup() {
  const s = testServer();
  s.site.set(
    FEED,
    rss([
      { key: "a", title: "春の特売" },
      { key: "b", title: "新製品", content: "この記事は提供です" },
      { key: "c", title: "入荷のお知らせ" },
    ]),
  );
  const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
  const titles = async (query = "") => (await (await s.get(`/api/v1/articles${query}`)).json()).items.map((item: { title: string }) => item.title);
  return { s, feed, titles };
}

describe("filters", () => {
  it("hide stored feed articles from lists and counts, and say how many each hides", async () => {
    const { s, feed, titles } = await setup();

    const created = await s.post("/api/v1/filters", hide(title("特売")));

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ action: "hide", scope: { type: "all" }, enabled: true, conditions: [title("特売")], hiddenCount: 1 });
    expect((await titles()).sort()).toEqual(["入荷のお知らせ", "新製品"].sort());
    const counts = await (await s.get("/api/v1/counts")).json();
    expect(counts).toMatchObject({ unread: 2, uncategorizedUnread: 2, feeds: [{ feedId: feed.id, unread: 2 }] });
    expect(await (await s.get("/api/v1/filters")).json()).toEqual([expect.objectContaining({ hiddenCount: 1 })]);
  });

  it("cover the content once the condition is changed to cover it", async () => {
    const { s, titles } = await setup();
    const filter = await (await s.post("/api/v1/filters", hide(title("提供")))).json();
    expect(await titles()).toHaveLength(3);

    const changed = await s.patch(`/api/v1/filters/${filter.id}`, { conditions: [{ fields: ["title", "content"], match: "contains", value: "提供" }] });

    expect(await changed.json()).toMatchObject({ hiddenCount: 1, restored: 0 });
    expect(await titles()).not.toContain("新製品");
  });

  it("bring the articles back, unread as they were, when deleted, and say how many came back", async () => {
    const { s, titles } = await setup();
    const filter = await (await s.post("/api/v1/filters", hide({ fields: ["title"], match: "regex", value: "特売|入荷" }))).json();
    expect(filter.hiddenCount).toBe(2);

    const deleted = await s.delete(`/api/v1/filters/${filter.id}`);

    expect(await deleted.json()).toEqual({ restored: 2 });
    expect(await titles("?unread=true")).toEqual(expect.arrayContaining(["春の特売", "入荷のお知らせ"]));
  });

  it("switch off and on, saying how many came back", async () => {
    const { s, titles } = await setup();
    const filter = await (await s.post("/api/v1/filters", hide(title("特売")))).json();

    expect(await (await s.patch(`/api/v1/filters/${filter.id}`, { enabled: false })).json()).toMatchObject({ enabled: false, hiddenCount: 0, restored: 1 });
    expect(await titles()).toHaveLength(3);
    expect(await (await s.patch(`/api/v1/filters/${filter.id}`, { enabled: true })).json()).toMatchObject({ enabled: true, hiddenCount: 1, restored: 0 });
  });

  it("keep, for a feed, only what meets them", async () => {
    const { s, feed, titles } = await setup();
    const created = await s.post("/api/v1/filters", { action: "keep", scope: { type: "feed", feedId: feed.id }, conditions: [title("新製品")] });
    expect(await created.json()).toMatchObject({ hiddenCount: 2 });
    expect(await titles(`?feed=${feed.id}`)).toEqual(["新製品"]);
  });

  it("list the articles a filter hides, a page at a time, in the shape of the article list", async () => {
    const { s } = await setup();
    const filter = await (await s.post("/api/v1/filters", hide({ fields: ["title", "content"], match: "regex", value: "特売|入荷|提供" }))).json();

    const first = await (await s.get(`/api/v1/filters/${filter.id}/articles?limit=2`)).json();
    expect(first.items).toHaveLength(2);
    expect(first.items[0]).toMatchObject({ origin: "feed", feedId: expect.any(Number) });
    const second = await (await s.get(`/api/v1/filters/${filter.id}/articles?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second).toMatchObject({ items: [expect.any(Object)], nextCursor: null });
  });

  it("count what a filter would hide before it is saved, and save nothing", async () => {
    const { s, titles } = await setup();
    const preview = await s.post("/api/v1/filters/preview", hide({ fields: ["title"], match: "regex", value: "特売|入荷" }));
    expect(await preview.json()).toEqual({ hiddenCount: 2 });
    expect(await (await s.get("/api/v1/filters")).json()).toEqual([]);
    expect(await titles()).toHaveLength(3);
  });

  it("refuse a wrong regular expression, a keep filter over everything and a scope that names nothing", async () => {
    const { s } = await setup();
    const regex = await s.post("/api/v1/filters", hide(title("ok"), { fields: ["title"], match: "regex", value: "(sale" }));
    expect(regex.status).toBe(400);
    expect((await regex.json()).error.fields).toEqual([{ path: "conditions.1.value", message: expect.stringMatching(/regular expression/) }]);

    const everywhere = await s.post("/api/v1/filters", { action: "keep", scope: { type: "all" }, conditions: [title("x")] });
    expect(everywhere.status).toBe(400);
    expect((await everywhere.json()).error.fields).toEqual([{ path: "scope", message: "a keep filter cannot apply to everything" }]);

    const nowhere = await s.post("/api/v1/filters", hide(title("x")));
    const feedless = await s.post("/api/v1/filters", { action: "hide", scope: { type: "feed", feedId: 999 }, conditions: [title("x")] });
    expect(nowhere.status).toBe(201);
    expect(feedless.status).toBe(400);
    expect((await feedless.json()).error.fields).toEqual([{ path: "scope.feedId", message: "no such feed" }]);

    const preview = await s.post("/api/v1/filters/preview", hide({ fields: ["title"], match: "regex", value: "(sale" }));
    expect(preview.status).toBe(400);
    expect((await s.post("/api/v1/filters", hide())).status).toBe(400);
  });

  it("refuse the same filter twice", async () => {
    const { s } = await setup();
    await s.post("/api/v1/filters", hide(title("特売")));
    expect((await s.post("/api/v1/filters", hide(title("特売")))).status).toBe(409);
  });

  it("answer 404 for a filter that does not exist", async () => {
    const { s } = await setup();
    const filter = await (await s.post("/api/v1/filters", hide(title("特売")))).json();
    await s.delete(`/api/v1/filters/${filter.id}`);
    expect((await s.get(`/api/v1/filters/${filter.id}/articles`)).status).toBe(404);
    expect((await s.delete(`/api/v1/filters/${filter.id}`)).status).toBe(404);
    expect((await s.patch(`/api/v1/filters/${filter.id}`, { enabled: true })).status).toBe(404);
  });

  it("keep a hidden article out of a mark-all-read, so that it comes back unread", async () => {
    const { s, titles } = await setup();
    const filter = await (await s.post("/api/v1/filters", hide(title("特売")))).json();

    const marked = await (await s.post("/api/v1/articles/mark-read", { before: "2026-03-01T12:00:01.000Z" })).json();
    await s.delete(`/api/v1/filters/${filter.id}`);

    expect(marked.updated).toBe(2);
    expect(await titles("?unread=true")).toEqual(["春の特売"]);
  });

  it("do not hide a starred article", async () => {
    const { s, titles } = await setup();
    const [sale] = (await (await s.get("/api/v1/articles")).json()).items.filter((item: { title: string }) => item.title === "春の特売");
    await s.patch(`/api/v1/articles/${sale.id}`, { starred: true });

    const filter = await (await s.post("/api/v1/filters", hide(title("特売")))).json();

    expect(filter.hiddenCount).toBe(0);
    expect(await titles("?starred=true")).toEqual(["春の特売"]);
  });

  it("do not hide a generated article", async () => {
    const { s, titles } = await setup();
    s.article(s.category("Shops").id, { title: "特売の動向" });
    await s.post("/api/v1/filters", hide(title("特売")));
    expect(await titles("?origin=generated")).toEqual(["特売の動向"]);
  });

  it("are gone from the API under their old name", async () => {
    const { s } = await setup();
    expect((await s.get("/api/v1/stop-words")).status).toBe(404);
  });
});
