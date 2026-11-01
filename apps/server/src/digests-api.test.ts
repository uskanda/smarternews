import { deleteCategory } from "@smarternews/core";
import { materialLines, type FakeHandler } from "@smarternews/core/testing";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { FEED_TOKEN, testServer } from "./testing.ts";

const HOUR = 3_600_000;

/** One line for each listed category, drawn from every article of it. */
const answer: FakeHandler = (request) => {
  const categories = materialLines<{ id: number }>(request.prompt, 0);
  const articles = materialLines<{ id: number; categoryId: number | null }>(request.prompt, 1);
  return {
    executiveSummary: "What happened.",
    sections: categories.map((category) => ({
      categoryId: category.id,
      lines: [{ text: `On ${category.id}.`, articleIds: articles.filter((a) => a.categoryId === category.id).map((a) => a.id) }],
    })),
  };
};

describe("the digests API", () => {
  it("lists digests newest first, and gives one with its sections and the titles of its source articles", async () => {
    const s = testServer("2026-03-01T06:00:00.000Z", { digest: answer });
    const security = s.category("Security");
    s.article(security.id, { title: "Morning story" });
    s.clock.set("2026-03-01T07:00:00.000Z");
    expect(s.digests.buildNow()).toBe("queued");
    await s.digests.idle();
    s.clock.set("2026-03-01T18:00:00.000Z");
    const kept = s.article(security.id, { title: "Kept" });
    const gone = s.article(security.id, { title: "Gone" });
    s.clock.set("2026-03-01T19:00:00.000Z");
    s.digests.buildNow();
    await s.digests.idle();
    s.db.prepare("DELETE FROM articles WHERE id = ?").run(gone);

    const list = await (await s.get("/api/v1/digests")).json();
    expect(list.building).toBe(false);
    expect(list.items.map((item: { createdAt: string }) => item.createdAt)).toEqual(["2026-03-01T19:00:00.000Z", "2026-03-01T07:00:00.000Z"]);
    expect(list.items[0]).toMatchObject({ trigger: "manual", articleCount: 2, executiveSummary: "What happened." });
    expect((await (await s.get("/api/v1/digests?limit=1")).json()).items).toHaveLength(1);
    expect((await s.get("/api/v1/digests?limit=201")).status).toBe(400);

    const digest = await (await s.get(`/api/v1/digests/${list.items[0].id}`)).json();
    expect(digest.sections).toEqual([{ categoryId: security.id, categoryName: "Security", lines: [{ text: `On ${security.id}.`, articleIds: [gone, kept].sort((a, b) => b - a) }] }]);
    expect(digest.articles).toEqual([{ id: kept, title: "Kept", origin: "generated" }]);
    expect((await s.get("/api/v1/digests/999")).status).toBe(404);
  });

  it("keeps the name a category had when the digest was made", async () => {
    const s = testServer("2026-03-01T06:00:00.000Z", { digest: answer });
    const security = s.category("Security");
    s.article(security.id);
    s.digests.buildNow();
    await s.digests.idle();
    deleteCategory(s.db, security.id);

    const [item] = (await (await s.get("/api/v1/digests")).json()).items;
    expect((await (await s.get(`/api/v1/digests/${item.id}`)).json()).sections[0].categoryName).toBe("Security");
  });

  it("starts a digest and answers 202 without waiting, says building, and answers 409 while it is made", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const s = testServer("2026-03-01T06:00:00.000Z", {
      digest: async (request) => {
        await gate;
        return answer(request);
      },
    });
    s.article(s.category().id);

    const started = await s.post("/api/v1/digests");
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ status: "queued" });
    expect((await (await s.get("/api/v1/digests")).json()).building).toBe(true);
    expect((await s.post("/api/v1/digests")).status).toBe(409);
    release();
    await s.digests.idle();
    expect(s.llmRequests.digest).toHaveLength(1);
  });

  it("says why no digest is started, without calling the model", async () => {
    const empty = testServer("2026-03-01T06:00:00.000Z", { digest: answer });
    const none = await empty.post("/api/v1/digests");
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ status: "empty" });

    const limited = testServer("2026-03-01T06:00:00.000Z", { digest: answer, digestsPerDay: 0 });
    limited.article(limited.category().id);
    expect(await (await limited.post("/api/v1/digests")).json()).toEqual({ status: "limit" });
    expect(limited.llmRequests.digest).toHaveLength(0);
  });

  it("counts the calls of digests apart from the calls of runs", async () => {
    const s = testServer("2026-03-01T06:00:00.000Z", { digest: answer });
    s.article(s.category().id);
    s.digests.buildNow();
    await s.digests.idle();

    const status = await (await s.get("/api/v1/providers")).json();
    expect(status).toMatchObject({ digestsToday: 1, llmCallsToday: 0, limits: { digestsPerDay: 4 } });
    expect(status.tasks.digest).toBeDefined();
  });

  it("keeps digests out of every RSS feed", async () => {
    const s = testServer("2026-03-01T06:00:00.000Z", { digest: answer });
    const security = s.category("Security");
    s.article(security.id, { title: "Security story" });
    s.clock.advance(HOUR);
    s.digests.buildNow();
    await s.digests.idle();

    const xml = await (await s.get(`/rss/security.xml?token=${FEED_TOKEN}`, null)).text();
    const items = new XMLParser({ isArray: (name) => name === "item" }).parse(xml).rss.channel.item as Array<{ title: string }>;
    expect(items.map((item) => item.title)).toEqual(["Security story"]);
    expect(xml).not.toContain("What happened.");
    expect((await s.get(`/rss/digests.xml?token=${FEED_TOKEN}`, null)).status).toBe(404);
  });
});
