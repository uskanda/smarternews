import { describe, expect, it } from "vitest";
import { testServer } from "./testing.ts";

const FEED = "https://blog.example.org/feed.xml";
const HOUR = 3_600_000;
const SENTENCE = "The page says in full what the feed only hints at. ";

const rss = (keys: string[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Blog</title>${keys
    .map((key) => `<item><title>Post ${key}</title><guid>${key}</guid><link>https://blog.example.org/${key}</link><description>A hint about ${key}.</description></item>`)
    .join("")}</channel></rss>`;
const page = () =>
  new Response(`<html><head><title>Post</title></head><body><article><h1>Post</h1><p>${SENTENCE.repeat(6)}</p><p>${SENTENCE.repeat(6)}</p></article></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("from the fetch of a feed to the stored summary", () => {
  it("stores what the feed delivers at once, then summarises it from its page and records the calls", async () => {
    const s = testServer(undefined, { summarize: (request) => ({ summary: `Summary of ${/Post (\w+)/.exec(request.prompt)![1]}.` }) });
    s.site.set(FEED, rss(["old"]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    await s.patch(`/api/v1/feeds/${feed.id}`, { autoSummarize: true });

    s.clock.advance(HOUR);
    s.site.set(FEED, rss(["b", "a", "old"]));
    s.site.set("https://blog.example.org/a", page);
    s.site.set("https://blog.example.org/b", page);
    const fetched = await (await s.post(`/api/v1/feeds/${feed.id}/fetch`)).json();

    // The fetch is over and the articles can be read before any model is called.
    expect(fetched).toMatchObject({ status: "updated", created: 2 });
    expect(s.llmRequests.summarize).toEqual([]);
    const list = (await (await s.get(`/api/v1/articles?feed=${feed.id}`)).json()).items as Array<{ id: number; title: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details = async (): Promise<Record<string, any>> =>
      Object.fromEntries(await Promise.all(list.map(async (item) => [item.title, await (await s.get(`/api/v1/articles/${item.id}`)).json()])));
    const before = await details();
    expect([before["Post a"].autoSummaryPending, before["Post b"].autoSummaryPending, before["Post old"].autoSummaryPending]).toEqual([true, true, false]);

    s.summarizer.tick();
    await s.summarizer.idle();

    const after = await details();
    expect(after["Post a"].autoSummary).toMatchObject({ text: "Summary of a.", source: "page" });
    expect(after["Post b"].autoSummary).toMatchObject({ text: "Summary of b.", source: "page" });
    expect(after["Post old"].autoSummary).toBeNull();
    expect(after["Post a"].body).toBe("A hint about a.");
    expect(s.llmRequests.summarize[0]!.prompt).toContain(SENTENCE.trim());
    expect(s.db.prepare("SELECT task, provider, ok, run_id FROM llm_calls ORDER BY id").all()).toEqual([
      { task: "summarize", provider: "summarize", ok: 1, run_id: null },
      { task: "summarize", provider: "summarize", ok: 1, run_id: null },
    ]);

    // The calls are counted as summaries, and not towards the day of the runs.
    expect(await (await s.get("/api/v1/providers")).json()).toMatchObject({ llmCallsToday: 0, summariesToday: 2, limits: { summariesPerDay: 100 } });
  });
});

describe("asking for the summary of an article that is open", () => {
  async function waiting(keys: string[], options: Parameters<typeof testServer>[1] = {}) {
    const s = testServer(undefined, { summarize: (request) => ({ summary: `Summary of ${/Post (\w+)/.exec(request.prompt)![1]}.` }), ...options });
    s.site.set(FEED, rss(["old"]));
    const feed = await (await s.post("/api/v1/feeds", { url: FEED })).json();
    await s.patch(`/api/v1/feeds/${feed.id}`, { autoSummarize: true });
    s.clock.advance(HOUR);
    s.site.set(FEED, rss([...keys, "old"]));
    for (const key of keys) s.site.set(`https://blog.example.org/${key}`, page);
    await s.post(`/api/v1/feeds/${feed.id}/fetch`);
    const items = (await (await s.get(`/api/v1/articles?feed=${feed.id}`)).json()).items as Array<{ id: number; title: string }>;
    const id = (key: string) => items.find((item) => item.title === `Post ${key}`)!.id;
    const detail = async (key: string) => (await (await s.get(`/api/v1/articles/${id(key)}`)).json()) as { autoSummary: { text: string } | null; autoSummaryPending: boolean };
    return { s, id, detail };
  }

  it("keeps an article that was read after it was asked for, and summarises it before newer ones", async () => {
    const { s, id, detail } = await waiting(["c", "b", "a"]);

    const asked = await s.post(`/api/v1/articles/${id("a")}/summary`);
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ status: "queued" });
    await s.patch(`/api/v1/articles/${id("a")}`, { isRead: true });
    expect((await detail("a")).autoSummaryPending).toBe(true);

    await s.summarizer.idle();
    expect((await detail("a")).autoSummary).toMatchObject({ text: "Summary of a." });
    // The article that was asked for came first, although the others are newer in the feed.
    expect(s.llmRequests.summarize[0]!.prompt).toContain("Post a");
  });

  it("starts the summary at once instead of at the next look", async () => {
    const { s, id, detail } = await waiting(["a"]);
    await s.post(`/api/v1/articles/${id("a")}/summary`);
    await s.summarizer.idle();
    expect((await detail("a")).autoSummary).not.toBeNull();
  });

  it("still leaves out an article that was read without being asked for", async () => {
    const { s, id, detail } = await waiting(["a"]);
    await s.patch(`/api/v1/articles/${id("a")}`, { isRead: true });
    expect((await detail("a")).autoSummaryPending).toBe(false);
    s.summarizer.tick();
    await s.summarizer.idle();
    expect((await detail("a")).autoSummary).toBeNull();
  });

  it("accepts the request for an article that is already read, as long as it could still be summarised", async () => {
    const { s, id, detail } = await waiting(["a"]);
    await s.patch(`/api/v1/articles/${id("a")}`, { isRead: true });
    expect(await (await s.post(`/api/v1/articles/${id("a")}/summary`)).json()).toEqual({ status: "queued" });
    await s.summarizer.idle();
    expect((await detail("a")).autoSummary).not.toBeNull();
  });

  it("says so when the day's allowance of summaries is used up, and summarises nothing", async () => {
    const { s, id, detail } = await waiting(["a"], { summariesPerDay: 0 });
    expect(await (await s.post(`/api/v1/articles/${id("a")}/summary`)).json()).toEqual({ status: "limit" });
    await s.summarizer.idle();
    expect((await detail("a")).autoSummary).toBeNull();
    expect(s.llmRequests.summarize).toEqual([]);
  });

  it("answers that there is nothing to wait for when the article is not one that gets a summary", async () => {
    const { s, id } = await waiting(["a"]);
    expect(await (await s.post(`/api/v1/articles/${id("old")}/summary`)).json()).toEqual({ status: "none" });
    await s.post(`/api/v1/articles/${id("a")}/summary`);
    await s.summarizer.idle();
    expect(await (await s.post(`/api/v1/articles/${id("a")}/summary`)).json()).toEqual({ status: "none" });
    expect((await s.post("/api/v1/articles/9999/summary")).status).toBe(404);
  });
});
