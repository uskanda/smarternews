import { describe, expect, it, vi } from "vitest";
import { getArticle, listArticles } from "../db/articles.ts";
import { updateFeed } from "../db/feeds.ts";
import { updateSettings } from "../db/settings.ts";
import { createFilter } from "../db/filters.ts";
import { translationCharsOf } from "../db/translations.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { fakeLlm, type FakeHandler } from "../testing/llm.ts";
import { fakeTranslator } from "../testing/translation.ts";
import type { TranslationItem } from "./adapter.ts";
import { LlmTranslator } from "./llm.ts";
import { TranslationService } from "./service.ts";

const START = "2026-03-10T12:00:00.000Z";

/** A model that answers every passage with the passage in brackets. */
const echo: FakeHandler = (request) => {
  const sent = JSON.parse(/<material>\n([\s\S]*)\n<\/material>/.exec(request.prompt)![1]!) as { items: Array<{ n: number; text: string }> };
  return { items: sent.items.map((item) => ({ n: item.n, text: `[${item.text}]` })) };
};

function setup(options: { google?: "none" | "fails"; monthlyChars?: number; translate?: FakeHandler; llmCallsPerDay?: number; maxCharsPerArticle?: number } = {}) {
  const db = createTestDb();
  const clock = fakeClock(START);
  updateSettings(db, { outputLanguage: "ja", timeZone: "UTC" });
  const google = fakeTranslator((item) => {
    if (options.google === "fails") throw new Error("the translation API answered HTTP status 500");
    return `訳:${item.text}`;
  });
  const llm = fakeLlm(db, clock, { translate: options.translate ?? echo }, { limits: { llmCallsPerRun: 40, llmCallsPerDay: options.llmCallsPerDay ?? 300 } });
  const log = vi.fn();
  const service = new TranslationService({
    db,
    clock,
    google: options.google === "none" ? null : google,
    llm: new LlmTranslator(llm.runner),
    monthlyChars: options.monthlyChars ?? 450_000,
    maxCharsPerArticle: options.maxCharsPerArticle ?? 20_000,
    log,
  });
  const feedId = seedFeed(db);
  updateFeed(db, feedId, { translate: true }, clock);
  const llmCalls = () => llm.requests.translate.length;
  const chars = () => translationCharsOf(db, "2026-03");
  return { db, clock, service, google, llm, log, feedId, llmCalls, chars };
}

const plain = (text: string): TranslationItem => ({ text, plain: true });

describe("choosing how to translate", () => {
  it("uses the API while a key is set and the month has room, and counts what it sends", async () => {
    const s = setup();
    expect(await s.service.translate([plain("Hello")], { allowLlm: true })).toEqual({ texts: ["訳:Hello"], sourceLanguage: "en", method: "google" });
    expect(s.google.calls).toEqual([{ items: [plain("Hello")], target: "ja" }]);
    expect(s.chars()).toBe(5);
    expect(s.llmCalls()).toBe(0);
  });

  it("uses the model when no key is set", async () => {
    const s = setup({ google: "none" });
    expect(await s.service.translate([plain("Hello")], { allowLlm: true })).toEqual({ texts: ["[Hello]"], sourceLanguage: null, method: "llm" });
    expect(s.chars()).toBe(0);
  });

  it("sends nothing to the API once the month would pass its limit, and uses the model", async () => {
    const s = setup({ monthlyChars: 1000 });
    await s.service.translate([plain("x".repeat(900))], { allowLlm: true });
    const output = await s.service.translate([plain("y".repeat(300))], { allowLlm: true });
    expect(output?.method).toBe("llm");
    expect(s.google.calls).toHaveLength(1);
    expect(s.chars()).toBe(900);
  });

  it("uses the API again in the next month, counting from nothing", async () => {
    const s = setup({ monthlyChars: 1000 });
    await s.service.translate([plain("x".repeat(1000))], { allowLlm: true });
    s.clock.set("2026-04-01T00:00:00.000Z");
    expect((await s.service.translate([plain("y".repeat(300))], { allowLlm: true }))?.method).toBe("google");
    expect(translationCharsOf(s.db, "2026-04")).toBe(300);
    expect(s.service.status()).toEqual({ month: "2026-04", chars: 300, monthlyChars: 1000, apiKeyConfigured: true });
  });

  it("uses the model when the API fails, keeps the characters counted, and records the failure", async () => {
    const s = setup({ google: "fails" });
    expect((await s.service.translate([plain("Hello")], { allowLlm: true }))?.method).toBe("llm");
    expect(s.chars()).toBe(5);
    expect(s.log).toHaveBeenCalledWith(expect.stringContaining("HTTP status 500"));
  });

  it("never calls the model for a caller that does not allow it", async () => {
    const none = setup({ google: "none" });
    expect(await none.service.translate([plain("Hello")], { allowLlm: false })).toBeNull();
    const failing = setup({ google: "fails" });
    expect(await failing.service.translate([plain("Hello")], { allowLlm: false })).toBeNull();
    const full = setup({ monthlyChars: 3 });
    expect(await full.service.translate([plain("Hello")], { allowLlm: false })).toBeNull();
    expect(none.llmCalls() + failing.llmCalls() + full.llmCalls()).toBe(0);
  });

  it("does not call the model on a day that reached its limit of calls", async () => {
    const s = setup({ google: "none", llmCallsPerDay: 1 });
    expect(await s.service.translate([plain("One")], { allowLlm: true })).not.toBeNull();
    expect(await s.service.translate([plain("Two")], { allowLlm: true })).toBeNull();
    expect(s.llmCalls()).toBe(1);
  });

  it("gives up when the model answers with another number of passages", async () => {
    const s = setup({ google: "none", translate: () => ({ items: [{ n: 1, text: "only one" }] }) });
    expect(await s.service.translate([plain("One"), plain("Two")], { allowLlm: true })).toBeNull();
  });

  it("says that only the model translates when no key is set", () => {
    expect(setup({ google: "none" }).service.status()).toEqual({ month: "2026-03", chars: 0, monthlyChars: 450_000, apiKeyConfigured: false });
  });
});

describe("the model as a translator", () => {
  it("translates the text of a heading or a list item and puts the mark back", async () => {
    const s = setup({ google: "none" });
    const output = await s.service.translate([{ text: "## Heading" }, { text: "- Item" }, { text: "3. Third" }, { text: "> Quote" }], { allowLlm: true });
    expect(output?.texts).toEqual(["## [Heading]", "- [Item]", "3. [Third]", "[> Quote]"]);
  });

  it("splits a long text into calls of 8,000 characters", async () => {
    const s = setup({ google: "none" });
    const output = await s.service.translate(Array.from({ length: 5 }, (_unused, index) => ({ text: `${index}${"x".repeat(2999)}` })), { allowLlm: true });
    expect(s.llmCalls()).toBe(3);
    expect(output?.texts.map((text) => text[1])).toEqual(["0", "1", "2", "3", "4"]);
  });
});

describe("translating the titles of stored articles", () => {
  it("stores the translation next to the original title, with the language the API found", async () => {
    const s = setup();
    const id = seedFeedArticle(s.db, s.feedId, { title: "Vendor ships a fix" });
    await s.service.translateTitles([id]);
    expect(getArticle(s.db, id)).toMatchObject({ title: "Vendor ships a fix", translatedTitle: "訳:Vendor ships a fix" });
    expect(listArticles(s.db, {}, START).items[0]).toMatchObject({ title: "Vendor ships a fix", translatedTitle: "訳:Vendor ships a fix" });
    expect(s.db.prepare("SELECT source_language FROM articles WHERE id = ?").get(id)).toEqual({ source_language: "en" });
  });

  it("stores nothing and calls no model when the API cannot be used", async () => {
    for (const google of ["none", "fails"] as const) {
      const s = setup({ google });
      const id = seedFeedArticle(s.db, s.feedId);
      await expect(s.service.translateTitles([id])).resolves.toBeUndefined();
      expect(getArticle(s.db, id).translatedTitle).toBeNull();
      expect(s.llmCalls()).toBe(0);
    }
  });

  it("sends nothing for the articles of a feed that does not translate", async () => {
    const s = setup();
    const id = seedFeedArticle(s.db, seedFeed(s.db));
    await s.service.translateTitles([id]);
    expect(s.google.calls).toEqual([]);
    expect(getArticle(s.db, id)).toMatchObject({ translatedTitle: null, translatable: false });
  });
});

describe("translating an article that is opened", () => {
  const BODY = "First paragraph.\n\n```\ncode();\n```\n\nSecond paragraph.";

  it("translates the title and the body segment by segment, and stores both", async () => {
    const s = setup();
    const id = seedFeedArticle(s.db, s.feedId, { title: "A title", body: BODY });
    expect(getArticle(s.db, id)).toMatchObject({ translatable: true, translation: null, translatedTitle: null });

    const translation = await s.service.translateArticle(id);

    expect(translation).toEqual({
      translatedTitle: "訳:A title",
      sourceLanguage: "en",
      segments: [
        { original: "First paragraph.", translated: "訳:First paragraph.", originalHtml: "<p>First paragraph.</p>", translatedHtml: "<p>訳:First paragraph.</p>" },
        { original: "```\ncode();\n```", translated: null, originalHtml: "<pre><code>code();\n</code></pre>", translatedHtml: null },
        { original: "Second paragraph.", translated: "訳:Second paragraph.", originalHtml: "<p>Second paragraph.</p>", translatedHtml: "<p>訳:Second paragraph.</p>" },
      ],
      method: "google",
      truncated: false,
      createdAt: START,
    });
    const stored = getArticle(s.db, id);
    expect(stored).toMatchObject({ title: "A title", body: BODY, translatedTitle: "訳:A title", translation });
  });

  it("answers with what is stored the second time, and sends nothing", async () => {
    const s = setup();
    const id = seedFeedArticle(s.db, s.feedId, { body: BODY });
    const first = await s.service.translateArticle(id);
    const sent = s.google.calls.length;
    expect(await s.service.translateArticle(id)).toEqual(first);
    expect(s.google.calls).toHaveLength(sent);
    expect(s.llmCalls()).toBe(0);
  });

  it("lets requests that overlap share one translation", async () => {
    const s = setup();
    const id = seedFeedArticle(s.db, s.feedId, { body: BODY });
    const [a, b] = await Promise.all([s.service.translateArticle(id), s.service.translateArticle(id)]);
    expect(a).toEqual(b);
    expect(s.google.calls).toHaveLength(1);
  });

  it("keeps a title that was translated when the article was stored, and translates the body only", async () => {
    const s = setup();
    const id = seedFeedArticle(s.db, s.feedId, { title: "A title", body: "One paragraph." });
    await s.service.translateTitles([id]);
    await s.service.translateArticle(id);
    expect(s.google.calls[1]!.items).toEqual([{ text: "One paragraph." }]);
  });

  it("translates title and body with the model when no key is set", async () => {
    const s = setup({ google: "none" });
    const id = seedFeedArticle(s.db, s.feedId, { title: "A title", body: "One paragraph." });
    expect(await s.service.translateArticle(id)).toMatchObject({
      translatedTitle: "[A title]",
      sourceLanguage: null,
      method: "llm",
      segments: [{ original: "One paragraph.", translated: "[One paragraph.]" }],
    });
  });

  it("translates the first part of a long body only, and records that the rest is left", async () => {
    const s = setup({ maxCharsPerArticle: 30 });
    const id = seedFeedArticle(s.db, s.feedId, { body: "Short one.\n\nShort two.\n\nThis one lies past the limit.\n\nSo does this." });
    const translation = await s.service.translateArticle(id);
    expect(translation.truncated).toBe(true);
    expect(translation.segments.map((segment) => segment.translated)).toEqual(["訳:Short one.", "訳:Short two.", null, null]);
  });

  it("refuses an article of a feed that does not translate, and a generated one, and sends nothing", async () => {
    const s = setup();
    const other = seedFeedArticle(s.db, seedFeed(s.db));
    await expect(s.service.translateArticle(other)).rejects.toMatchObject({ code: "invalid" });
    await expect(s.service.translateArticle(999)).rejects.toMatchObject({ code: "not_found" });
    expect(s.google.calls).toEqual([]);
    expect(s.llmCalls()).toBe(0);
  });

  it("says that it cannot translate now, and leaves the article as it is, when neither way works", async () => {
    const s = setup({ google: "fails", llmCallsPerDay: 1 });
    await s.service.translate([plain("uses up the day")], { allowLlm: true });
    const id = seedFeedArticle(s.db, s.feedId, { body: BODY });
    const before = getArticle(s.db, id);
    await expect(s.service.translateArticle(id)).rejects.toMatchObject({ code: "unavailable" });
    expect(getArticle(s.db, id)).toEqual(before);
    // The next request tries again.
    await expect(s.service.translateArticle(id)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("translates nothing when translation is switched on for a feed that has articles", async () => {
    const s = setup();
    const feedId = seedFeed(s.db);
    for (let index = 0; index < 50; index += 1) seedFeedArticle(s.db, feedId);
    updateFeed(s.db, feedId, { translate: true }, s.clock);
    expect(s.google.calls).toEqual([]);
    expect(s.llmCalls()).toBe(0);
  });
});

describe("filters and translations", () => {
  it("are matched against the original only: a word that only the translation holds hides nothing", async () => {
    const s = setup();
    const id = seedFeedArticle(s.db, s.feedId, { title: "Plain title", body: "Plain content." });
    await s.service.translateArticle(id);
    expect(getArticle(s.db, id).translatedTitle).toBe("訳:Plain title");

    const hide = (value: string) =>
      createFilter(s.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title", "content"], match: "contains", value }] }, s.clock);
    expect(hide("訳").hiddenCount).toBe(0);
    expect(listArticles(s.db, {}, START).items.map((article) => article.id)).toEqual([id]);
    expect(hide("plain").hiddenCount).toBe(1);
  });
});
