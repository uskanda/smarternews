import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { createCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { num } from "./rows.ts";
import { addHighlightTerm, createTermGroup, deleteHighlightTerm, deleteTermGroup, getTermGroup } from "./term-highlights.ts";
import { refreshAllTermMatches, refreshTermMatches } from "./term-matches.ts";
import { saveTranslatedTitle } from "./translations.ts";

const clock = fakeClock("2026-03-01T00:00:00.000Z");
const matchOf = (db: Database, id: number) => num(db.prepare("SELECT term_match FROM articles WHERE id = ?").get(id)!.term_match);

function term(db: Database, text: string, groupName = "Group"): { groupId: number; termId: number } {
  const existing = db.prepare("SELECT id FROM term_groups WHERE name = ?").get(groupName);
  const groupId = existing ? num(existing.id) : createTermGroup(db, { name: groupName }, clock).id;
  const group = addHighlightTerm(db, groupId, { text }, clock);
  return { groupId, termId: group.terms.at(-1)!.id };
}

describe("matching the highlight terms for the relevance order", () => {
  it("matches the title, the summary and the translated title, whatever the case and width", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const byTitle = seedFeedArticle(db, feed, { title: "New gpu ships", body: "nothing" });
    const bySummary = seedFeedArticle(db, feed, { title: "Plain", body: "A GPU inside" });
    const byTranslation = seedFeedArticle(db, feed, { title: "Chip plant opens", body: "nothing" });
    const none = seedFeedArticle(db, feed, { title: "Weather", body: "Rain" });
    db.prepare("INSERT INTO term_groups (name, color, position, created_at) VALUES ('g', 'green', 1, ?)").run("2026-03-01T00:00:00.000Z");
    db.prepare("INSERT INTO highlight_terms (group_id, text, normalized, created_at) VALUES (1, 'ＧＰＵ', 'gpu', ?), (1, '半導体', '半導体', ?)").run(
      "2026-03-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    );
    db.prepare("UPDATE articles SET translated_title = '半導体の工場' WHERE id = ?").run(byTranslation);

    refreshTermMatches(db, [byTitle, bySummary, byTranslation, none]);
    expect([byTitle, bySummary, byTranslation, none].map((id) => matchOf(db, id))).toEqual([1, 1, 1, 0]);
  });

  it("does not match across the end of one text and the start of the next", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const id = seedFeedArticle(db, feed, { title: "ab", body: "cd" });
    term(db, "bc");
    refreshTermMatches(db, [id]);
    expect(matchOf(db, id)).toBe(0);
  });

  it("matches every feed article again when a term or a group is added or removed", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const a = seedFeedArticle(db, feed, { title: "Battery news" });
    const b = seedFeedArticle(db, feed, { title: "Solar news" });

    const battery = term(db, "battery");
    expect([matchOf(db, a), matchOf(db, b)]).toEqual([1, 0]);
    const solar = term(db, "SOLAR", "Other");
    expect([matchOf(db, a), matchOf(db, b)]).toEqual([1, 1]);
    deleteHighlightTerm(db, battery.groupId, battery.termId);
    expect([matchOf(db, a), matchOf(db, b)]).toEqual([0, 1]);
    expect(getTermGroup(db, solar.groupId).terms).toHaveLength(1);
    deleteTermGroup(db, solar.groupId);
    expect([matchOf(db, a), matchOf(db, b)]).toEqual([0, 0]);
  });

  it("matches an article again when its translated title is saved", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const id = seedFeedArticle(db, feed, { title: "Chip plant opens", body: "nothing" });
    term(db, "半導体");
    expect(matchOf(db, id)).toBe(0);
    saveTranslatedTitle(db, id, { original: "Chip plant opens", title: "半導体の工場が開く", sourceLanguage: "en" });
    expect(matchOf(db, id)).toBe(1);
  });

  it("leaves generated articles alone, and gives every feed article its value when all are matched", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    const id = seedFeedArticle(db, feed, { title: "Battery" });
    db.prepare("INSERT INTO term_groups (name, color, position, created_at) VALUES ('g', 'green', 1, ?)").run("2026-03-01T00:00:00.000Z");
    db.prepare("INSERT INTO highlight_terms (group_id, text, normalized, created_at) VALUES (1, 'battery', 'battery', ?)").run("2026-03-01T00:00:00.000Z");
    const category = createCategory(db, { name: "Tools", kind: "news" }, clock);
    db.prepare(
      `INSERT INTO articles (id, category_id, kind, title, summary, body, importance, first_published_at, updated_at, created_at)
       VALUES (900, ?, 'news', 'Battery', 's', 'b', 3, ?, ?, ?)`,
    ).run(category.id, "2026-03-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z");

    expect(refreshAllTermMatches(db)).toBe(1);
    expect([matchOf(db, id), matchOf(db, 900)]).toEqual([1, 0]);
    // Nothing changes the second time, and nothing is written.
    expect(refreshAllTermMatches(db)).toBe(0);
  });
});
