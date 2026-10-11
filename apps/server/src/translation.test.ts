import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeHandler } from "@smarternews/core/testing";
import { describe, expect, it } from "vitest";
import { createRuntime } from "./runtime.ts";
import { API_TOKEN, testServer } from "./testing.ts";

const FEED = "https://blog.example.org/feed.xml";
const HOUR = 3_600_000;

const esc = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const rss = (items: Array<{ key: string; title: string; content: string }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Blog</title>${items
    .map((item) => `<item><title>${item.title}</title><guid>${item.key}</guid><link>https://blog.example.org/${item.key}</link><description>${esc(item.content)}</description></item>`)
    .join("")}</channel></rss>`;

/** A model that answers every passage with the passage in brackets. */
const echo: FakeHandler = (request) => {
  const sent = JSON.parse(/<material>\n([\s\S]*)\n<\/material>/.exec(request.prompt)![1]!) as { items: Array<{ n: number; text: string }> };
  return { items: sent.items.map((item) => ({ n: item.n, text: `[${item.text}]` })) };
};

const FIRST = { key: "a", title: "Vendor ships a fix", content: "<p>First paragraph.</p><pre>code();</pre><p>Second paragraph.</p>" };

async function subscribed(options: Parameters<typeof testServer>[1] = {}, translate = true) {
  const s = testServer(undefined, { translate: echo, ...options });
  await s.patch("/api/v1/settings", { outputLanguage: "ja", timeZone: "UTC" });
  s.site.set(FEED, rss([FIRST]));
  const feed = await (await s.post("/api/v1/feeds", { url: FEED, ...(translate ? { translate: true } : {}) })).json();
  const list = async () => (await (await s.get(`/api/v1/articles?feed=${feed.id}`)).json()).items as Array<{ id: number; title: string; translatedTitle: string | null }>;
  const articleId = (await list())[0]!.id;
  return { ...s, feed, list, articleId };
}

describe("the translation setting of a feed", () => {
  it("is off unless asked for, and a change shows in the list of feeds", async () => {
    const s = await subscribed({}, false);
    expect(s.feed.translate).toBe(false);
    expect((await (await s.patch(`/api/v1/feeds/${s.feed.id}`, { translate: true })).json()).translate).toBe(true);
    expect((await (await s.get("/api/v1/feeds")).json())[0].translate).toBe(true);
    // Switching it on translates nothing that is stored.
    expect(s.google!.calls).toEqual([]);
    expect((await s.list())[0]!.translatedTitle).toBeNull();
  });
});

describe("from the fetch of a feed to the translated article", () => {
  it("translates the title when the article is stored and the content when it is opened, and counts what it sends", async () => {
    const s = await subscribed({ monthlyChars: 200 });

    expect(await s.list()).toMatchObject([{ title: "Vendor ships a fix", translatedTitle: "訳:Vendor ships a fix" }]);
    expect(await (await s.get(`/api/v1/articles/${s.articleId}`)).json()).toMatchObject({ translatable: true, translation: null, translatedTitle: "訳:Vendor ships a fix" });
    expect(await (await s.get("/api/v1/translation")).json()).toEqual({ month: "2026-03", chars: 18, monthlyChars: 200, apiKeyConfigured: true });

    const response = await s.post(`/api/v1/articles/${s.articleId}/translation`);
    expect(response.status).toBe(200);
    const translation = await response.json();
    expect(translation).toMatchObject({
      translatedTitle: "訳:Vendor ships a fix",
      sourceLanguage: "en",
      method: "google",
      truncated: false,
      segments: [
        { original: "First paragraph.", translated: "訳:First paragraph.", translatedHtml: "<p>訳:First paragraph.</p>" },
        { original: "```\ncode();\n```", translated: null, translatedHtml: null },
        { original: "Second paragraph.", translated: "訳:Second paragraph." },
      ],
    });
    expect((await (await s.get("/api/v1/translation")).json()).chars).toBe(18 + "<p>First paragraph.</p>".length + "<p>Second paragraph.</p>".length);

    // The second time the stored translation is the answer, and nothing is sent.
    const sent = s.google!.calls.length;
    expect(await (await s.post(`/api/v1/articles/${s.articleId}/translation`)).json()).toEqual(translation);
    expect((await (await s.get(`/api/v1/articles/${s.articleId}`)).json()).translation).toEqual(translation);
    expect(s.google!.calls).toHaveLength(sent);
    expect(s.llmRequests.translate).toEqual([]);
  });

  it("goes on with the model once the month has no room left, and sends the API nothing more", async () => {
    const s = await subscribed({ monthlyChars: 200 });
    await s.post(`/api/v1/articles/${s.articleId}/translation`);
    const used = (await (await s.get("/api/v1/translation")).json()).chars as number;

    s.clock.advance(HOUR);
    const title = "A long headline ".repeat(6).trim();
    s.site.set(FEED, rss([{ key: "b", title, content: `<p>${"A sentence that fills the month. ".repeat(3).trim()}</p>` }, FIRST]));
    await s.post(`/api/v1/feeds/${s.feed.id}/fetch`);
    const second = (await s.list()).find((article) => article.title === title)!;
    // The title still fitted, so the API translated it while the feed was fetched.
    expect(second.translatedTitle).toBe(`訳:${title}`);
    expect(s.llmRequests.translate).toEqual([]);

    const sent = s.google!.calls.length;
    const translation = await (await s.post(`/api/v1/articles/${second.id}/translation`)).json();

    expect(translation).toMatchObject({ method: "llm", translatedTitle: `訳:${title}` });
    expect(translation.segments[0].translated).toMatch(/^\[A sentence that fills the month\./);
    expect(s.google!.calls).toHaveLength(sent);
    expect((await (await s.get("/api/v1/translation")).json()).chars).toBe(used + title.length);
    expect(s.db.prepare("SELECT task, provider, ok, run_id FROM llm_calls").all()).toEqual([{ task: "translate", provider: "translate", ok: 1, run_id: null }]);
    // The call counts towards the day of the runs.
    expect((await (await s.get("/api/v1/providers")).json()).llmCallsToday).toBe(1);
  });

  it("translates title and content with the model when no key is set, and only when the article is opened", async () => {
    const s = await subscribed({ google: null });
    expect((await s.list())[0]!.translatedTitle).toBeNull();
    expect(s.llmRequests.translate).toEqual([]);

    const translation = await (await s.post(`/api/v1/articles/${s.articleId}/translation`)).json();
    expect(translation).toMatchObject({ translatedTitle: "[Vendor ships a fix]", method: "llm", sourceLanguage: null });
    expect((await s.list())[0]!.translatedTitle).toBe("[Vendor ships a fix]");
    expect(await (await s.get("/api/v1/translation")).json()).toMatchObject({ chars: 0, apiKeyConfigured: false });
  });
});

describe("what cannot be translated", () => {
  it("answers that the article cannot be translated now, and leaves it as it is, when neither way works", async () => {
    const s = await subscribed({ google: null, llmCallsPerDay: 0 });
    const before = await (await s.get(`/api/v1/articles/${s.articleId}`)).json();
    const response = await s.post(`/api/v1/articles/${s.articleId}/translation`);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("unavailable");
    expect(await (await s.get(`/api/v1/articles/${s.articleId}`)).json()).toEqual(before);
    expect(s.llmRequests.translate).toEqual([]);
  });

  it("refuses an article of a feed that does not translate, and sends its content nowhere", async () => {
    const s = await subscribed({}, false);
    expect((await (await s.get(`/api/v1/articles/${s.articleId}`)).json()).translatable).toBe(false);
    const response = await s.post(`/api/v1/articles/${s.articleId}/translation`);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_input");
    expect(s.google!.calls).toEqual([]);
    expect(s.llmRequests.translate).toEqual([]);
  });

  it("refuses a generated article, and an article that does not exist", async () => {
    const s = testServer();
    const generated = s.article(s.category().id);
    expect((await s.get(`/api/v1/articles/${generated}`).then((r) => r.json())).translatable).toBe(false);
    expect((await s.post(`/api/v1/articles/${generated}/translation`)).status).toBe(400);
    expect((await s.post("/api/v1/articles/999/translation")).status).toBe(404);
    expect((await s.post(`/api/v1/articles/${generated}/translation`, undefined, null)).status).toBe(401);
  });
});

describe("the key of the translation API", () => {
  it("is read from the environment, and is in no answer and not in the exported settings", async () => {
    const root = mkdtempSync(join(tmpdir(), "sn-translation-"));
    const key = "secret-translation-key-0123456789";
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config", "config.yaml"), "translation:\n  google:\n    apiKeyEnv: TRANSLATE_KEY\n  monthlyChars: 1234\n");
    writeFileSync(join(root, "config", "api-token"), `${API_TOKEN}\n`, { mode: 0o600 });
    const env = { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") };
    const get = (runtime: ReturnType<typeof createRuntime>, path: string) => runtime.app.request(path, { headers: { authorization: `Bearer ${API_TOKEN}` } });

    const withKey = createRuntime({ env: { ...env, TRANSLATE_KEY: key }, home: root });
    const status = await get(withKey, "/api/v1/translation");
    const text = await status.text();
    expect(JSON.parse(text)).toMatchObject({ chars: 0, monthlyChars: 1234, apiKeyConfigured: true });
    for (const path of ["/api/v1/settings/export", "/api/v1/providers", "/api/v1/settings"]) expect(await (await get(withKey, path)).text()).not.toContain(key);
    expect(text).not.toContain(key);
    withKey.close();

    const withoutKey = createRuntime({ env: { ...env, TRANSLATE_KEY: "" }, home: root });
    expect(await (await get(withoutKey, "/api/v1/translation")).json()).toMatchObject({ apiKeyConfigured: false });
    withoutKey.close();
  });
});
