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

describe("stop words", () => {
  it("hides stored feed articles from lists and counts, and says how many each word hides", async () => {
    const { s, feed, titles } = await setup();

    const created = await s.post("/api/v1/stop-words", { text: "特売" });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ text: "特売", scope: "title", hiddenCount: 1 });
    expect((await titles()).sort()).toEqual(["入荷のお知らせ", "新製品"].sort());
    const counts = await (await s.get("/api/v1/counts")).json();
    expect(counts).toMatchObject({ unread: 2, uncategorizedUnread: 2, feeds: [{ feedId: feed.id, unread: 2 }] });
    expect(await (await s.get("/api/v1/stop-words")).json()).toEqual([expect.objectContaining({ text: "特売", hiddenCount: 1 })]);
  });

  it("covers the content when the word is changed to cover it", async () => {
    const { s, titles } = await setup();
    const word = await (await s.post("/api/v1/stop-words", { text: "提供" })).json();
    expect(await titles()).toHaveLength(3);

    const changed = await s.patch(`/api/v1/stop-words/${word.id}`, { scope: "title_and_content" });

    expect(await changed.json()).toMatchObject({ scope: "title_and_content", hiddenCount: 1 });
    expect(await titles()).not.toContain("新製品");
  });

  it("brings the articles back, unread as they were, when the word is deleted", async () => {
    const { s, titles } = await setup();
    const word = await (await s.post("/api/v1/stop-words", { text: "特売" })).json();

    const deleted = await s.delete(`/api/v1/stop-words/${word.id}`);

    expect(await deleted.json()).toEqual({ restored: 1 });
    expect(await titles("?unread=true")).toContain("春の特売");
  });

  it("keeps a hidden article out of a mark-all-read, so that it comes back unread", async () => {
    const { s, titles } = await setup();
    const word = await (await s.post("/api/v1/stop-words", { text: "特売" })).json();

    const marked = await (await s.post("/api/v1/articles/mark-read", { before: "2026-03-01T12:00:01.000Z" })).json();
    await s.delete(`/api/v1/stop-words/${word.id}`);

    expect(marked.updated).toBe(2);
    expect(await titles("?unread=true")).toEqual(["春の特売"]);
  });

  it("does not hide a starred article", async () => {
    const { s, titles } = await setup();
    const [sale] = (await (await s.get("/api/v1/articles")).json()).items.filter((item: { title: string }) => item.title === "春の特売");
    await s.patch(`/api/v1/articles/${sale.id}`, { starred: true });

    const word = await (await s.post("/api/v1/stop-words", { text: "特売" })).json();

    expect(word.hiddenCount).toBe(0);
    expect(await titles("?starred=true")).toEqual(["春の特売"]);
  });

  it("does not hide a generated article", async () => {
    const { s, titles } = await setup();
    s.article(s.category("Shops").id, { title: "特売の動向" });
    await s.post("/api/v1/stop-words", { text: "特売" });
    expect(await titles("?origin=generated")).toEqual(["特売の動向"]);
  });

  it("refuses an empty word, a word that is there already, and an unknown scope", async () => {
    const { s } = await setup();
    await s.post("/api/v1/stop-words", { text: "特売" });
    expect((await s.post("/api/v1/stop-words", { text: "  " })).status).toBe(400);
    expect((await s.post("/api/v1/stop-words", { text: "特売" })).status).toBe(409);
    expect((await s.post("/api/v1/stop-words", { text: "広告", scope: "body" })).status).toBe(400);
  });

  it("answers 404 for a word that does not exist", async () => {
    const { s } = await setup();
    expect((await s.delete("/api/v1/stop-words/77")).status).toBe(404);
    expect((await s.patch("/api/v1/stop-words/77", { scope: "title" })).status).toBe(404);
  });
});
