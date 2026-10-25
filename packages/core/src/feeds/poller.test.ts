import { describe, expect, it } from "vitest";
import { getFeed, insertFeed, updateFeed } from "../db/feeds.ts";
import { Fetcher } from "../fetch/http.ts";
import { createTestDb, fakeClock } from "../testing/db.ts";
import { fakeFetch, xml } from "../testing/http.ts";
import { FeedPoller } from "./poller.ts";

const START = "2026-03-01T12:00:00.000Z";
const MINUTE = 60_000;

const rss = (title: string, keys: string[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${keys
    .map((key) => `<item><title>${key}</title><guid>${key}</guid><link>https://example.org/${key}</link></item>`)
    .join("")}</channel></rss>`;

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const db = createTestDb();
  const clock = fakeClock(START);
  const fake = fakeFetch(routes, clock);
  const fetcher = new Fetcher({ userAgent: "t", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 1_000_000, fetchImpl: fake.fetchImpl, clock, sleep: async () => {} });
  const poller = new FeedPoller({ db, clock, fetcher });
  const add = (name: string, options: { intervalMinutes?: number; enabled?: boolean } = {}) =>
    insertFeed(db, { url: `https://${name}.example.org/feed.xml`, title: name, ...options }, clock);
  /** One round, as the timer would start it, waited for. */
  const round = async () => {
    poller.tick();
    await poller.idle();
  };
  return { db, clock, poller, add, round, requests: fake.requests, urls: fake.urls };
}

describe("FeedPoller", () => {
  it("fetches a feed when its interval has passed, and not before", async () => {
    const s = setup({ "https://a.example.org/feed.xml": () => xml(rss("A", ["a1"])), "https://b.example.org/feed.xml": () => xml(rss("B", ["b1"])) });
    s.add("a");
    s.add("b", { intervalMinutes: 120 });
    await s.round();
    expect(s.urls()).toHaveLength(2);

    s.clock.advance(29 * MINUTE);
    await s.round();
    expect(s.urls()).toHaveLength(2);

    s.clock.advance(MINUTE);
    await s.round();
    expect(s.urls().slice(2)).toEqual(["https://a.example.org/feed.xml"]);

    s.clock.advance(90 * MINUTE);
    await s.round();
    expect(s.urls().slice(3).sort()).toEqual(["https://a.example.org/feed.xml", "https://b.example.org/feed.xml"]);
  });

  it("sends no request for a disabled feed, and keeps its articles readable", async () => {
    const s = setup({ "https://a.example.org/feed.xml": () => xml(rss("A", ["a1"])) });
    const feed = s.add("a");
    await s.round();
    updateFeed(s.db, feed.id, { enabled: false });

    s.clock.advance(24 * 60 * MINUTE);
    await s.round();

    expect(s.urls()).toHaveLength(1);
    expect(getFeed(s.db, feed.id).articleCount).toBe(1);
  });

  it("keeps a stale feed enabled and goes on fetching it", async () => {
    const s = setup({ "https://a.example.org/feed.xml": () => xml(rss("A", ["a1"])) });
    const feed = s.add("a");
    await s.round();
    // The same item for 61 days: nothing new comes.
    for (let day = 0; day < 61; day += 1) {
      s.clock.advance(24 * 60 * MINUTE);
      await s.round();
    }
    expect(getFeed(s.db, feed.id, s.clock())).toMatchObject({ stale: true, enabled: true });
    const before = s.urls().length;

    s.clock.advance(30 * MINUTE);
    await s.round();

    expect(s.urls()).toHaveLength(before + 1);
    expect(getFeed(s.db, feed.id, s.clock())).toMatchObject({ stale: true, enabled: true, lastSucceededAt: s.clock().toISOString() });
  });

  it("fetches one feed at a time", async () => {
    let active = 0;
    let most = 0;
    const slow = async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return xml(rss("F", ["x"]));
    };
    const s = setup({ "https://a.example.org/feed.xml": slow, "https://b.example.org/feed.xml": slow, "https://c.example.org/feed.xml": slow });
    s.add("a");
    s.add("b");
    s.add("c");

    // Timer ticks that arrive while a round is under way must not start a second one.
    s.poller.tick();
    s.poller.tick();
    await s.poller.idle();

    expect(most).toBe(1);
    expect(s.urls()).toHaveLength(3);
  });

  it("goes on with the other feeds when one fails", async () => {
    const s = setup({
      "https://a.example.org/feed.xml": () => new Response("oops", { status: 500 }),
      "https://b.example.org/feed.xml": () => xml(rss("B", ["b1"])),
      "https://c.example.org/feed.xml": () => "hang",
    });
    const a = s.add("a");
    const b = s.add("b");
    const c = s.add("c");

    await s.round();

    expect(getFeed(s.db, a.id)).toMatchObject({ failureCount: 1, articleCount: 0 });
    expect(getFeed(s.db, b.id)).toMatchObject({ failureCount: 0, articleCount: 1 });
    expect(getFeed(s.db, c.id)).toMatchObject({ failureCount: 1, lastError: expect.stringMatching(/timed out/) });
  });

  it("waits twice as long after each failure, and goes back to the interval after a success", async () => {
    let fail = true;
    const s = setup({ "https://a.example.org/feed.xml": () => (fail ? new Response("oops", { status: 500 }) : xml(rss("A", ["a1"]))) });
    s.add("a");
    await s.round(); // first failure: next try in 60 minutes
    s.clock.advance(59 * MINUTE);
    await s.round();
    expect(s.urls()).toHaveLength(1);
    s.clock.advance(MINUTE);
    await s.round(); // second failure: next try in 120 minutes
    expect(s.urls()).toHaveLength(2);
    s.clock.advance(120 * MINUTE);
    await s.round(); // third failure: next try in 240 minutes
    expect(s.urls()).toHaveLength(3);
    s.clock.advance(239 * MINUTE);
    await s.round();
    expect(s.urls()).toHaveLength(3);

    fail = false;
    s.clock.advance(MINUTE);
    await s.round();
    expect(s.urls()).toHaveLength(4);
    s.clock.advance(30 * MINUTE);
    await s.round();
    expect(s.urls()).toHaveLength(5);
  });

  it("fetches a feed at once on request, whatever its interval", async () => {
    let keys = ["a1"];
    const s = setup({ "https://a.example.org/feed.xml": () => xml(rss("A", keys)) });
    const feed = s.add("a");
    await s.round();
    s.clock.advance(MINUTE);
    keys = ["a2", "a1"];

    const outcome = await s.poller.fetchNow(feed.id);

    expect(outcome).toMatchObject({ status: "updated", created: 1 });
    expect(getFeed(s.db, feed.id)).toMatchObject({ articleCount: 2, lastSucceededAt: s.clock().toISOString() });
  });

  it("fetches a disabled feed on request", async () => {
    const s = setup({ "https://a.example.org/feed.xml": () => xml(rss("A", ["a1"])) });
    const feed = s.add("a", { enabled: false });
    expect(await s.poller.fetchNow(feed.id)).toMatchObject({ status: "updated", created: 1 });
  });

  it("lets a new subscription wait its turn, so that it does not overlap a fetch under way", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const s = setup({
      "https://a.example.org/feed.xml": async () => {
        order.push("a starts");
        await new Promise<void>((resolve) => (release = resolve));
        order.push("a ends");
        return xml(rss("A", ["a1"]));
      },
    });
    s.add("a");
    s.poller.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const queued = s.poller.exclusive(async () => {
      order.push("subscription runs");
      return "done";
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(["a starts"]);
    release();

    expect(await queued).toBe("done");
    expect(order).toEqual(["a starts", "a ends", "subscription runs"]);
  });

  it("goes on after a task of its line failed", async () => {
    const s = setup({ "https://a.example.org/feed.xml": () => xml(rss("A", ["a1"])) });
    const feed = s.add("a");
    await expect(s.poller.exclusive(async () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect(await s.poller.fetchNow(feed.id)).toMatchObject({ status: "updated" });
  });

  it("refuses a request for a feed that does not exist", async () => {
    const s = setup({});
    await expect(s.poller.fetchNow(99)).rejects.toMatchObject({ code: "not_found" });
  });

  it("calls no model and adds nothing to the run history", async () => {
    const s = setup({ "https://a.example.org/feed.xml": () => xml(rss("A", ["a1", "a2"])) });
    s.add("a");
    await s.round();
    expect(s.db.prepare("SELECT (SELECT count(*) FROM llm_calls) AS calls, (SELECT count(*) FROM runs) AS runs").get()).toEqual({ calls: 0, runs: 0 });
  });
});
