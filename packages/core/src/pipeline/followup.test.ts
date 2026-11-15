import { describe, expect, it } from "vitest";
import { setArticleFlags } from "../db/articles.ts";
import { defaultHandlers, pipelineHarness, sourcesIn } from "../testing/pipeline.ts";

const FEED = "https://example.org/feed.xml";
const HOUR = 3_600_000;

async function published() {
  const h = pipelineHarness();
  h.addTopic("Topic", { feeds: [FEED] });
  h.feed(FEED, [{ title: "Flaw disclosed {flaw} [i4]", link: "https://example.org/disclosed" }]);
  await h.run();
  const [article] = h.articles();
  setArticleFlags(h.db, article!.id, { isRead: true }, "2026-03-01T12:00:00.000Z");
  return { h, article: article! };
}

describe("follow-up within 72 hours", () => {
  it("updates the published article instead of adding a new one", async () => {
    const { h, article } = await published();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);
    h.handlers.write = (request) => ({
      title: "Flaw disclosed and patched {flaw}",
      summary: "Now with a patch.",
      body: `Rewritten from ${sourcesIn(request).length} new source(s).`,
      unconfirmed: false,
      impact: null,
      event: null,
    });

    const run = await h.run();

    const articles = h.articles();
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      id: article.id,
      title: "Flaw disclosed and patched {flaw}",
      body: "Rewritten from 1 new source(s).",
      firstPublishedAt: "2026-03-01T12:00:00.000Z",
      updatedAt: "2026-03-02T12:00:00.000Z",
      importance: 4,
    });
    expect(articles[0]!.refs.map((ref) => ref.url)).toEqual(["https://example.org/disclosed", "https://example.org/patch"]);
    expect(run).toMatchObject({ articlesCreated: 0, articlesUpdated: 1 });
  });

  it("makes the updated article unread again and counts the update", async () => {
    const { h } = await published();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    await h.run();

    expect(h.articles()).toMatchObject([{ isRead: false, revision: 1 }]);
  });

  it("gives the writer the published article together with the new pages", async () => {
    const { h } = await published();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    await h.run();

    const prompt = h.requests.write[1]!.prompt;
    expect(prompt).toContain("This story already has an article");
    expect(prompt).toContain("Flaw disclosed {flaw} [i4]");
    expect(sourcesIn(h.requests.write[1]!).map((source) => source.url)).toEqual(["https://example.org/patch"]);
  });

  it("does not count an update against the limit of new articles", async () => {
    const h = pipelineHarness({ category: { maxArticlesPerRun: 1 } });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Old {old} [i5]", link: "https://example.org/old" }]);
    await h.run();
    h.clock.advance(HOUR);
    h.feed(FEED, [
      { title: "Old follow-up {old} [i3]", link: "https://example.org/old-2" },
      { title: "New {new} [i3]", link: "https://example.org/new" },
    ]);

    const run = await h.run();

    expect(run).toMatchObject({ articlesCreated: 1, articlesUpdated: 1 });
  });

  it("ignores a follow-up below the minimum importance", async () => {
    const { h } = await published();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Minor note {flaw} [i1]", link: "https://example.org/minor" }]);

    const run = await h.run();

    expect(h.articles()).toMatchObject([{ revision: 0 }]);
    expect(run.articlesUpdated).toBe(0);
  });
});

describe("what a follow-up adds", () => {
  function rewriteWith(h: ReturnType<typeof pipelineHarness>, updateNote: unknown) {
    h.handlers.write = (request) => ({ ...(defaultHandlers.write(request) as Record<string, unknown>), updateNote });
  }

  it("stores the note of a rewrite, and clears it when the next rewrite has none", async () => {
    const { h } = await published();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);
    rewriteWith(h, "修正版が公開されました。");
    await h.run();
    expect(h.articles()[0]!.updateNote).toBe("修正版が公開されました。");

    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Advisory updated {flaw}", link: "https://example.org/advisory" }]);
    rewriteWith(h, null);
    await h.run();
    expect(h.articles()).toMatchObject([{ revision: 2, updateNote: null }]);
  });

  it("keeps the note of every rewrite since the reader last read the article", async () => {
    const { h } = await published();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);
    rewriteWith(h, "修正版が公開されました。");
    await h.run();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Advisory updated {flaw}", link: "https://example.org/advisory" }]);
    rewriteWith(h, "勧告が改訂されました。");
    await h.run();

    expect(h.articles()[0]!.updateNotes).toEqual([
      { note: "修正版が公開されました。", createdAt: "2026-03-01T13:00:00.000Z" },
      { note: "勧告が改訂されました。", createdAt: "2026-03-01T14:00:00.000Z" },
    ]);
    expect(h.articles()[0]!.updateNote).toBe("勧告が改訂されました。");
  });

  it("keeps the rewrite when only its note is not valid, without asking again", async () => {
    const { h } = await published();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);
    rewriteWith(h, 42);

    const run = await h.run();

    expect(h.articles()).toMatchObject([{ revision: 1, updateNote: null }]);
    expect(h.requests.write).toHaveLength(2);
    expect(run).toMatchObject({ articlesUpdated: 1 });
  });

  it("stores no note on a new article, nor on the new article of a late follow-up", async () => {
    const h = pipelineHarness();
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Flaw disclosed {flaw}", link: "https://example.org/disclosed" }]);
    rewriteWith(h, "新しい記事には要らない文。");
    await h.run();
    h.clock.advance(7 * 24 * HOUR);
    h.feed(FEED, [{ title: "Lawsuit filed {flaw}", link: "https://example.org/lawsuit" }]);
    await h.run();

    expect(h.articles().map((article) => article.updateNote)).toEqual([null, null]);
  });

  it("clears the note when the same event is found again under another headline", async () => {
    const h = pipelineHarness({ kind: "event", now: "2026-03-01T12:00:00.000Z" });
    h.addTopic("Fairs", { feeds: [FEED] });
    h.handlers.write = (request) => ({
      ...(defaultHandlers.write(request) as Record<string, unknown>),
      event: { name: "Spring Maker Fair", startsAt: "2026-03-07", endsAt: null, venue: null, fee: null, registration: "unknown" },
      updateNote: "書き直す前の記事を見ずに書いた文。",
    });
    h.feed(FEED, [{ title: "Spring Maker Fair", link: "https://example.org/fair" }]);
    await h.run();
    h.db.prepare("UPDATE articles SET update_note = 'earlier note'").run();
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Maker fair this weekend", link: "https://example.net/weekend" }]);

    await h.run();

    expect(h.articles()).toMatchObject([{ revision: 1, updateNote: null }]);
  });

  it("records when each source was added and keeps the time the article was read before the rewrite", async () => {
    const { h, article } = await published();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);
    await h.run();
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Advisory updated {flaw}", link: "https://example.org/advisory" }]);
    await h.run();

    const refs = h.db.prepare("SELECT url, added_at FROM article_refs WHERE article_id = ? ORDER BY position").all(article.id);
    expect(refs).toEqual([
      { url: "https://example.org/disclosed", added_at: "2026-03-01T12:00:00.000Z" },
      { url: "https://example.org/patch", added_at: "2026-03-01T13:00:00.000Z" },
      { url: "https://example.org/advisory", added_at: "2026-03-01T14:00:00.000Z" },
    ]);
    expect(h.db.prepare("SELECT read_before_update_at FROM articles WHERE id = ?").get(article.id)).toEqual({
      read_before_update_at: "2026-03-01T12:00:00.000Z",
    });
  });
});

describe("follow-up to an article the reader marked", () => {
  it("rejects a follow-up to an article marked as a miss without writing, and leaves the article read", async () => {
    const { h, article } = await published();
    setArticleFlags(h.db, article.id, { missed: true }, "2026-03-01T12:30:00.000Z");
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    const run = await h.run();

    expect(h.requests.write).toHaveLength(1);
    expect(h.articles()).toMatchObject([{ id: article.id, revision: 0, isRead: true }]);
    expect(h.reasonCodes(run.id)).toEqual([{ title: "Patch released {flaw}", reasonCode: "missed-follow-up" }]);
    expect(h.candidates(run.id, "rejected")).toMatchObject([
      { reason: 'follow-up to "Flaw disclosed {flaw} [i4]", which was marked as a miss' },
    ]);
    expect(run).toMatchObject({ articlesCreated: 0, articlesUpdated: 0, rejected: 1 });
  });

  it("rejects a follow-up to an article whose follow-ups were stopped, and names it in the output language", async () => {
    const h = pipelineHarness({ outputLanguage: "ja" });
    h.addTopic("Topic", { feeds: [FEED] });
    h.feed(FEED, [{ title: "Flaw disclosed {flaw} [i4]", link: "https://example.org/disclosed" }]);
    await h.run();
    const [article] = h.articles();
    setArticleFlags(h.db, article!.id, { followUpsStopped: true }, "2026-03-01T12:30:00.000Z");
    h.clock.advance(24 * HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    const run = await h.run();

    expect(h.requests.write).toHaveLength(1);
    expect(h.articles()).toMatchObject([{ revision: 0, isRead: false }]);
    expect(h.reasonCodes(run.id)).toEqual([{ title: "Patch released {flaw}", reasonCode: "stopped-follow-up" }]);
    expect(h.candidates(run.id, "rejected")).toMatchObject([{ reason: `続報を止めた記事「${article!.title}」の続報` }]);
  });

  it("gives the miss first when an article has both marks", async () => {
    const { h, article } = await published();
    setArticleFlags(h.db, article.id, { missed: true, followUpsStopped: true }, "2026-03-01T12:30:00.000Z");
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    const run = await h.run();

    expect(h.reasonCodes(run.id)).toEqual([{ title: "Patch released {flaw}", reasonCode: "missed-follow-up" }]);
  });

  it("gives the reason of the mark to a follow-up below the minimum importance", async () => {
    const { h, article } = await published();
    setArticleFlags(h.db, article.id, { followUpsStopped: true }, "2026-03-01T12:30:00.000Z");
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Minor note {flaw} [i1]", link: "https://example.org/minor" }]);

    const run = await h.run();

    expect(h.reasonCodes(run.id)).toEqual([{ title: "Minor note {flaw} [i1]", reasonCode: "stopped-follow-up" }]);
  });

  it("writes no new article for a late follow-up to a marked article", async () => {
    const { h, article } = await published();
    setArticleFlags(h.db, article.id, { followUpsStopped: true }, "2026-03-01T12:30:00.000Z");
    h.clock.advance(7 * 24 * HOUR);
    h.feed(FEED, [{ title: "Lawsuit filed {flaw}", link: "https://example.org/lawsuit" }]);

    const run = await h.run();

    expect(h.articles()).toHaveLength(1);
    expect(h.reasonCodes(run.id)).toEqual([{ title: "Lawsuit filed {flaw}", reasonCode: "stopped-follow-up" }]);
  });

  it("rewrites the article again once the mark is taken away", async () => {
    const { h, article } = await published();
    setArticleFlags(h.db, article.id, { followUpsStopped: true }, "2026-03-01T12:30:00.000Z");
    setArticleFlags(h.db, article.id, { followUpsStopped: false }, "2026-03-01T12:40:00.000Z");
    h.clock.advance(HOUR);
    h.feed(FEED, [{ title: "Patch released {flaw}", link: "https://example.org/patch" }]);

    const run = await h.run();

    expect(h.articles()).toMatchObject([{ revision: 1, isRead: false }]);
    expect(run).toMatchObject({ articlesUpdated: 1 });
  });
});

describe("follow-up after 72 hours", () => {
  it("writes a new article that points back to the earlier one", async () => {
    const { h, article } = await published();
    h.clock.advance(7 * 24 * HOUR);
    h.feed(FEED, [{ title: "Lawsuit filed {flaw}", link: "https://example.org/lawsuit" }]);

    const run = await h.run();

    const articles = h.articles();
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({ id: article.id, revision: 0, isRead: true });
    expect(articles[1]).toMatchObject({ title: "Lawsuit filed {flaw}", previousArticleId: article.id, revision: 0 });
    expect(run).toMatchObject({ articlesCreated: 1, articlesUpdated: 0 });
  });
});
