import { reviseArticle, updateCategory, updateSettings } from "@smarternews/core";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { API_TOKEN, FEED_TOKEN, testServer } from "./testing.ts";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: (name) => name === "item" || name === "category" });
async function feed(response: Pick<Response, "status" | "headers" | "text">) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/rss+xml");
  const channel = parser.parse(await response.text()).rss.channel as { title: string; item?: Array<Record<string, unknown>> };
  return { title: channel.title, items: channel.item ?? [] };
}

const MINUTE = 60_000;

describe("GET /rss/:slug.xml", () => {
  it("returns the articles of that category under the category's name", async () => {
    const s = testServer();
    const security = s.category("Security");
    const cars = s.category("Cars");
    s.article(security.id, { title: "Security story" });
    s.article(cars.id, { title: "Car story" });

    const { title, items } = await feed(await s.get(`/rss/security.xml?token=${FEED_TOKEN}`, null));

    expect(title).toBe("Security");
    expect(items.map((item) => item.title)).toEqual(["Security story"]);
  });

  it("holds at most the 50 most recently updated articles, newest first", async () => {
    const s = testServer();
    const category = s.category();
    for (let index = 1; index <= 80; index += 1) {
      s.article(category.id, { title: `Story ${index}` });
      s.clock.advance(MINUTE);
    }

    const { items } = await feed(await s.get(`/rss/security.xml?token=${FEED_TOKEN}`, null));

    expect(items).toHaveLength(50);
    expect(items[0]!.title).toBe("Story 80");
    expect(items[49]!.title).toBe("Story 31");
  });

  it("re-delivers an article that a follow-up updated", async () => {
    const s = testServer();
    const category = s.category();
    const id = s.article(category.id, { title: "Flaw disclosed" });
    const before = (await feed(await s.get(`/rss/security.xml?token=${FEED_TOKEN}`, null))).items[0]!;
    s.clock.advance(60 * MINUTE);
    reviseArticle(s.db, id, {
      title: "Flaw disclosed and patched",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: s.clock().toISOString(),
      refs: [],
      topicIds: [],
    });

    const after = (await feed(await s.get(`/rss/security.xml?token=${FEED_TOKEN}`, null))).items[0]!;

    expect((after.guid as Record<string, string>)["#text"]).not.toBe((before.guid as Record<string, string>)["#text"]);
    expect(after.title).toBe("【更新】Flaw disclosed and patched");
    expect(after.pubDate).toBe("Sun, 01 Mar 2026 13:00:00 GMT");
  });

  it("leaves out events that have ended", async () => {
    const s = testServer("2026-03-10T12:00:00.000Z");
    const category = s.category("Events", "event");
    const event = (title: string, startsAt: string, endsAt: string) =>
      s.article(category.id, { title, kind: "event", event: { key: title, startsAt, endsAt, venue: "City Hall", fee: null, registration: "unknown" } });
    event("Yesterday", "2026-03-09T10:00:00.000Z", "2026-03-09T16:00:00.000Z");
    event("Tomorrow", "2026-03-11T10:00:00.000Z", "2026-03-11T16:00:00.000Z");

    const { items } = await feed(await s.get(`/rss/events.xml?token=${FEED_TOKEN}`, null));

    expect(items.map((item) => item.title)).toEqual(["Tomorrow"]);
    expect(String(items[0]!["content:encoded"])).toContain("City Hall");
  });

  it("answers 404 for a slug that no category has", async () => {
    const s = testServer();
    expect((await s.get(`/rss/nothing.xml?token=${FEED_TOKEN}`, null)).status).toBe(404);
  });
});

describe("GET /rss/all.xml", () => {
  it("combines the articles of every enabled category and names the category on each item", async () => {
    const s = testServer();
    const names = ["Security", "Cars", "Bikes"];
    for (const name of names) {
      s.article(s.category(name).id, { title: `${name} story` });
      s.clock.advance(MINUTE);
    }
    const hidden = s.category("Hidden");
    s.article(hidden.id, { title: "Hidden story" });
    updateCategory(s.db, hidden.id, { enabled: false });

    const { items } = await feed(await s.get(`/rss/all.xml?token=${FEED_TOKEN}`, null));

    expect(items.map((item) => [item.title, (item.category as string[])[0]])).toEqual([
      ["Bikes story", "Bikes"],
      ["Cars story", "Cars"],
      ["Security story", "Security"],
    ]);
  });

  it("writes labels in the output language", async () => {
    const s = testServer();
    updateSettings(s.db, { outputLanguage: "en" });
    s.article(s.category().id, { unconfirmed: true });

    const { items } = await feed(await s.get(`/rss/all.xml?token=${FEED_TOKEN}`, null));

    expect(String(items[0]!["content:encoded"])).toContain("Unconfirmed");
  });
});

describe("feed token", () => {
  it("answers 401 without a token and returns no articles", async () => {
    const s = testServer();
    s.article(s.category().id);
    const response = await s.get("/rss/all.xml", null);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("<item>");
  });

  it("answers 401 for a wrong token", async () => {
    const s = testServer();
    expect((await s.get("/rss/all.xml?token=wrong", null)).status).toBe(401);
  });

  it("does not accept the API token for a feed", async () => {
    const s = testServer();
    expect((await s.get(`/rss/all.xml?token=${API_TOKEN}`, null)).status).toBe(401);
  });
});
