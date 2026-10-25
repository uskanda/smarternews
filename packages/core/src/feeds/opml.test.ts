import { describe, expect, it } from "vitest";
import { createCategory, listCategories } from "../db/categories.ts";
import { insertFeed, listFeeds } from "../db/feeds.ts";
import { createTopic } from "../db/topics.ts";
import { createTestDb, fakeClock, seedFeedArticle } from "../testing/db.ts";
import { exportOpml, importOpml, parseOpml } from "./opml.ts";

const clock = fakeClock("2026-03-01T12:00:00.000Z");

const opml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>My feeds</title></head><body>${body}</body></opml>`;
const feed = (name: string, extra = "") => `<outline type="rss" text="${name}" xmlUrl="https://${name}.example.org/feed.xml" ${extra}/>`;

/** Feeds as "name@category", in a stable order. */
function placed(db: ReturnType<typeof createTestDb>): string[] {
  const names = new Map(listCategories(db).map((category) => [category.id, category.name]));
  return listFeeds(db)
    .map((entry) => `${entry.title}@${entry.categoryId === null ? "-" : names.get(entry.categoryId)}`)
    .sort();
}

describe("importOpml", () => {
  it("subscribes to the feeds it has not got yet, and skips the others", () => {
    const db = createTestDb();
    insertFeed(db, { url: "https://a.example.org/feed.xml", title: "a" }, clock);

    const result = importOpml(db, opml(feed("a") + feed("b") + feed("c")), clock);

    expect(result).toEqual({ feedsCreated: 2, feedsSkipped: 1, categoriesCreated: 0 });
    expect(placed(db)).toEqual(["a@-", "b@-", "c@-"]);
  });

  it("does not wait for the feeds: a feed that never answers is registered all the same", () => {
    const db = createTestDb();
    importOpml(db, opml(feed("unreachable")), clock);
    expect(listFeeds(db)).toMatchObject([{ title: "unreachable", lastFetchedAt: null, articleCount: 0 }]);
  });

  it("puts a feed into the category named like its folder, creating a news category without topics when there is none", () => {
    const db = createTestDb();
    const cars = createCategory(db, { name: "自動車", kind: "news" }, clock);

    const result = importOpml(db, opml(`<outline text="自動車">${feed("a")}</outline><outline title="料理">${feed("b")}${feed("c")}</outline>`), clock);

    expect(result).toEqual({ feedsCreated: 3, feedsSkipped: 0, categoriesCreated: 1 });
    expect(placed(db)).toEqual(["a@自動車", "b@料理", "c@料理"]);
    expect(listCategories(db).map((category) => [category.name, category.kind])).toEqual([
      ["自動車", "news"],
      ["料理", "news"],
    ]);
    expect(listCategories(db)[0]!.id).toBe(cars.id);
  });

  it("puts feeds of nested folders into the category of the outermost folder", () => {
    const db = createTestDb();
    importOpml(db, opml(`<outline text="技術"><outline text="言語">${feed("a")}<outline text="深い">${feed("b")}</outline></outline>${feed("c")}</outline>`), clock);
    expect(placed(db)).toEqual(["a@技術", "b@技術", "c@技術"]);
    expect(listCategories(db).map((category) => category.name)).toEqual(["技術"]);
  });

  it("gives a feed outside every folder no category", () => {
    const db = createTestDb();
    expect(importOpml(db, opml(feed("a")), clock).categoriesCreated).toBe(0);
    expect(placed(db)).toEqual(["a@-"]);
  });

  it("gives no category to feeds whose folder is named like an event category", () => {
    const db = createTestDb();
    createCategory(db, { name: "催し", kind: "event" }, clock);

    const result = importOpml(db, opml(`<outline text="催し">${feed("a")}</outline>`), clock);

    expect(result.categoriesCreated).toBe(0);
    expect(placed(db)).toEqual(["a@-"]);
    expect(listCategories(db)).toHaveLength(1);
  });

  it("leaves subscribed feeds and their articles that the document does not mention", () => {
    const db = createTestDb();
    const kept = insertFeed(db, { url: "https://kept.example.org/feed.xml", title: "kept" }, clock);
    seedFeedArticle(db, kept.id);

    importOpml(db, opml(feed("a")), clock);

    expect(placed(db)).toEqual(["a@-", "kept@-"]);
    expect(listFeeds(db).find((entry) => entry.id === kept.id)!.articleCount).toBe(1);
  });

  it("does not move a subscribed feed that the document lists under another folder", () => {
    const db = createTestDb();
    insertFeed(db, { url: "https://a.example.org/feed.xml", title: "a" }, clock);
    const result = importOpml(db, opml(`<outline text="技術">${feed("a")}</outline>`), clock);
    expect(result).toEqual({ feedsCreated: 0, feedsSkipped: 1, categoriesCreated: 0 });
    expect(placed(db)).toEqual(["a@-"]);
    expect(listCategories(db)).toEqual([]);
  });

  it("counts a feed listed twice once", () => {
    const db = createTestDb();
    expect(importOpml(db, opml(feed("a") + feed("a")), clock)).toEqual({ feedsCreated: 1, feedsSkipped: 1, categoriesCreated: 0 });
  });

  it("changes nothing when the document is not OPML", () => {
    const db = createTestDb();
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>`;
    expect(() => importOpml(db, rss, clock)).toThrow(expect.objectContaining({ code: "invalid", message: expect.stringMatching(/OPML/) }));
    expect(() => importOpml(db, "not xml at all <", clock)).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(listFeeds(db)).toEqual([]);
  });

  it("takes a file of any length", () => {
    const db = createTestDb();
    const many = Array.from({ length: 1200 }, (_unused, index) => feed(`f${index}`)).join("");
    expect(importOpml(db, opml(`<outline text="新しい">${many}</outline>`), clock)).toEqual({ feedsCreated: 1200, feedsSkipped: 0, categoriesCreated: 1 });
  });

  it("leaves out entries whose address is not a web address", () => {
    expect(parseOpml(opml(`<outline text="x" xmlUrl="ftp://example.org/feed"/>${feed("a")}`))).toEqual([
      { url: "https://a.example.org/feed.xml", title: "a", folder: null },
    ]);
  });
});

describe("exportOpml", () => {
  it("writes every subscribed feed, with categories as folders", () => {
    const db = createTestDb();
    const tools = createCategory(db, { name: "Tools & <more>", kind: "news" }, clock);
    insertFeed(db, { url: "https://a.example.org/feed.xml", title: "A", categoryId: tools.id, siteUrl: "https://a.example.org/" }, clock);
    insertFeed(db, { url: "https://b.example.org/feed.xml?x=1&y=2", title: "B", categoryId: tools.id }, clock);
    insertFeed(db, { url: "https://c.example.org/feed.xml", title: "C" }, clock);

    expect(parseOpml(exportOpml(db))).toEqual([
      { url: "https://a.example.org/feed.xml", title: "A", folder: "Tools & <more>" },
      { url: "https://b.example.org/feed.xml?x=1&y=2", title: "B", folder: "Tools & <more>" },
      { url: "https://c.example.org/feed.xml", title: "C", folder: null },
    ]);
    expect(exportOpml(db)).toContain('htmlUrl="https://a.example.org/"');
  });

  it("leaves out feeds that are only sources of a topic, and categories without subscribed feeds", () => {
    const db = createTestDb();
    const tools = createCategory(db, { name: "Tools", kind: "news" }, clock);
    createTopic(db, tools.id, { text: "releases", sources: { feeds: ["https://topic-only.example.org/feed.xml"] } }, clock);

    const text = exportOpml(db);

    expect(text).not.toContain("topic-only.example.org");
    expect(parseOpml(text)).toEqual([]);
    expect(text).not.toContain("Tools");
  });

  it("gives the same document again after loading it into an empty server", () => {
    const source = createTestDb();
    const tools = createCategory(source, { name: "Tools", kind: "news" }, clock);
    insertFeed(source, { url: "https://a.example.org/feed.xml", title: "A", categoryId: tools.id }, clock);
    insertFeed(source, { url: "https://c.example.org/feed.xml", title: "C" }, clock);
    const exported = exportOpml(source);

    const target = createTestDb();
    importOpml(target, exported, clock);

    expect(exportOpml(target)).toBe(exported);
  });
});

describe("exportOpml and web feeds", () => {
  it("writes the Atom feed of a category and leaves its web feed out", () => {
    const db = createTestDb();
    const a = createCategory(db, { name: "A", kind: "news" }, clock);
    insertFeed(db, { url: "https://atom.example.org/feed.xml", title: "Atom", categoryId: a.id }, clock);
    insertFeed(db, { url: "https://page.example.org/news", title: "Page", categoryId: a.id, format: "page", selectors: { item: "li" } }, clock);
    insertFeed(db, { url: "https://loose.example.org/news", title: "Loose", format: "page", selectors: { item: "li" } }, clock);

    const written = exportOpml(db);
    expect(written).toContain('xmlUrl="https://atom.example.org/feed.xml"');
    expect(written).not.toContain("page.example.org");
    expect(written).not.toContain("loose.example.org");
    expect(parseOpml(written)).toEqual([{ url: "https://atom.example.org/feed.xml", title: "Atom", folder: "A" }]);
  });
});
