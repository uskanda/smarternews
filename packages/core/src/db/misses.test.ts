import { describe, expect, it } from "vitest";
import { DomainError } from "../errors.ts";
import { purgeExpired } from "../runs/retention.ts";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { getArticle, insertArticle, setArticleFlags } from "./articles.ts";
import { createCategory, deleteCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { listMisses, MISS_LIMIT, recentMissTitles } from "./misses.ts";
import { applyInterpretation, createTopic, deleteTopic, getTopic, listTopics } from "./topics.ts";

const NOW = "2026-03-01T12:00:00.000Z";
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

function setup() {
  const clock = fakeClock(NOW);
  const db = createTestDb();
  const categoryId = createCategory(db, { name: "Security", kind: "news" }, clock).id;
  const topic = createTopic(db, categoryId, { text: "Vulnerabilities" }, clock);
  const other = createTopic(db, categoryId, { text: "Breaches" }, clock);
  const article = (title: string, topicIds = [topic.id], at = NOW) =>
    insertArticle(db, {
      categoryId,
      kind: "news",
      title,
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: at,
      previousArticleId: null,
      refs: [],
      topicIds,
    });
  return { db, clock, categoryId, topic, other, article };
}

function miss(db: Database, id: number, at = NOW): void {
  setArticleFlags(db, id, { missed: true }, at);
}

describe("marking a miss", () => {
  it("marks the generated article read and keeps its title and topics", () => {
    const { db, categoryId, topic, other, article } = setup();
    const id = article("Patch Tuesday roundup", [topic.id, other.id]);

    const marked = setArticleFlags(db, id, { missed: true }, NOW);

    expect(marked).toMatchObject({ missed: true, isRead: true, readAt: NOW });
    expect(listMisses(db)).toEqual([
      { id: expect.any(Number), articleId: id, categoryId, title: "Patch Tuesday roundup", markedAt: NOW, topicIds: [topic.id, other.id] },
    ]);
  });

  it("keeps the read state the same request gives, so that an undo puts it back", () => {
    const { db, article } = setup();
    const id = article("Unread before");

    expect(setArticleFlags(db, id, { missed: true, isRead: false }, NOW)).toMatchObject({ missed: true, isRead: false });
    expect(setArticleFlags(db, id, { missed: false, isRead: false }, NOW)).toMatchObject({ missed: false, isRead: false });
  });

  it("keeps the first mark when the article is marked again", () => {
    const { db, article } = setup();
    const id = article("Twice");
    miss(db, id, daysAgo(1));
    miss(db, id, NOW);

    expect(listMisses(db)).toEqual([expect.objectContaining({ articleId: id, markedAt: daysAgo(1) })]);
  });

  it("takes the mark away and leaves the article read", () => {
    const { db, article } = setup();
    const id = article("Read anyway");
    miss(db, id);

    expect(setArticleFlags(db, id, { missed: false }, NOW)).toMatchObject({ missed: false, isRead: true });
    expect(listMisses(db)).toEqual([]);
  });

  it("refuses a feed article", () => {
    const { db } = setup();
    const post = seedFeedArticle(db, seedFeed(db));

    for (const missed of [true, false]) {
      expect(() => setArticleFlags(db, post, { missed }, NOW)).toThrow(DomainError);
    }
    expect(getArticle(db, post)).toMatchObject({ missed: false, isRead: false });
    expect(listMisses(db)).toEqual([]);
  });

  it("does not keep the article from the purge", () => {
    const { db, clock, article } = setup();
    const old = article("Old miss", undefined, daysAgo(200));
    miss(db, old, daysAgo(199));

    expect(purgeExpired(db, clock).articles).toBe(1);
  });
});

describe("what a miss outlives", () => {
  it("stays with its title when the article is deleted", () => {
    const { db, clock, topic, article } = setup();
    const old = article("Old miss", undefined, daysAgo(200));
    miss(db, old, daysAgo(10));
    purgeExpired(db, clock);

    expect(listMisses(db)).toEqual([expect.objectContaining({ articleId: null, title: "Old miss", topicIds: [topic.id] })]);
    expect(recentMissTitles(db, topic.id, NOW)).toEqual(["Old miss"]);
  });

  it("loses only the deleted topic", () => {
    const { db, topic, other, article } = setup();
    miss(db, article("Both", [topic.id, other.id]));
    deleteTopic(db, other.id);

    expect(listMisses(db)).toEqual([expect.objectContaining({ title: "Both", topicIds: [topic.id] })]);
  });

  it("goes with its category", () => {
    const { db, categoryId, article } = setup();
    miss(db, article("Gone"));
    deleteCategory(db, categoryId);

    expect(listMisses(db)).toEqual([]);
  });
});

describe("the misses an interpretation reads", () => {
  it("are the topic's own from the last 90 days, newest first, 20 at most", () => {
    const { db, topic, other, article } = setup();
    miss(db, article("Too old"), daysAgo(91));
    miss(db, article("Other topic", [other.id]), daysAgo(1));
    for (let index = 0; index < MISS_LIMIT + 2; index += 1) miss(db, article(`Miss ${index}`), daysAgo(80 - index));

    const titles = recentMissTitles(db, topic.id, NOW);

    expect(titles).toHaveLength(MISS_LIMIT);
    expect(titles[0]).toBe(`Miss ${MISS_LIMIT + 1}`);
    expect(titles).not.toContain("Too old");
    expect(titles).not.toContain("Other topic");
    expect(titles).not.toContain("Miss 0");
  });
});

describe("the count of misses since the interpretation", () => {
  it("counts every miss of a topic whose time of interpretation is not known", () => {
    const { db, topic, article } = setup();
    miss(db, article("One"), daysAgo(2));
    miss(db, article("Two"), daysAgo(1));

    expect(getTopic(db, topic.id).missesSinceInterpretation).toBe(2);
  });

  it("counts only the misses after the last interpretation", () => {
    const { db, categoryId, topic, other, article } = setup();
    miss(db, article("Before"), daysAgo(3));
    applyInterpretation(db, topic.id, { queries: ["q"], criteria: "c", suggestedSources: { newsSearch: true, llmSearch: false } }, daysAgo(2));
    miss(db, article("After"), daysAgo(1));

    expect(getTopic(db, topic.id).missesSinceInterpretation).toBe(1);
    expect(listTopics(db, categoryId).map((candidate) => [candidate.id, candidate.missesSinceInterpretation])).toEqual([
      [topic.id, 1],
      [other.id, 0],
    ]);
  });
});
