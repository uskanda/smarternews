import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, seedFeed, seedFeedArticle } from "../testing/db.ts";
import { getCounts, listArticles, setArticleFlags } from "./articles.ts";
import {
  addHighlightTerm,
  createTermGroup,
  deleteHighlightTerm,
  deleteTermGroup,
  listTermGroups,
  moveTermGroup,
  updateTermGroup,
} from "./term-highlights.ts";

const clock = fakeClock("2026-03-01T00:00:00.000Z");

const names = (db: ReturnType<typeof createTestDb>) => listTermGroups(db).map((group) => group.name);

describe("term groups", () => {
  it("are green unless a colour is given", () => {
    const db = createTestDb();
    expect(createTermGroup(db, { name: "半導体" }, clock)).toMatchObject({ name: "半導体", color: "green", terms: [] });
    expect(createTermGroup(db, { name: "通商", color: "orange" }, clock)).toMatchObject({ color: "orange" });
  });

  it("refuse a name that is taken, as a conflict", () => {
    const db = createTestDb();
    createTermGroup(db, { name: "半導体" }, clock);
    expect(() => createTermGroup(db, { name: "半導体", color: "pink" }, clock)).toThrow(expect.objectContaining({ code: "conflict" }));
    const other = createTermGroup(db, { name: "通商" }, clock);
    expect(() => updateTermGroup(db, other.id, { name: "半導体" })).toThrow(expect.objectContaining({ code: "conflict" }));
    expect(names(db)).toEqual(["半導体", "通商"]);
  });

  it("are not limited by the number of colours, and share colours", () => {
    const db = createTestDb();
    for (const [name, color] of [["A", "green"], ["B", "purple"], ["C", "pink"], ["D", "orange"]] as const) createTermGroup(db, { name, color }, clock);
    createTermGroup(db, { name: "E", color: "green" }, clock);
    expect(listTermGroups(db)).toHaveLength(5);
    expect(listTermGroups(db).filter((group) => group.color === "green")).toHaveLength(2);
  });

  it("are listed in the order they were added", () => {
    const db = createTestDb();
    createTermGroup(db, { name: "A" }, clock);
    createTermGroup(db, { name: "B" }, clock);
    expect(names(db)).toEqual(["A", "B"]);
  });

  it("change name and colour and keep their terms and place", () => {
    const db = createTestDb();
    const a = createTermGroup(db, { name: "A" }, clock);
    createTermGroup(db, { name: "B" }, clock);
    for (const text of ["規制", "関税", "補助金"]) addHighlightTerm(db, a.id, { text }, clock);
    expect(updateTermGroup(db, a.id, { color: "purple" })).toMatchObject({ name: "A", color: "purple", terms: [{ text: "規制" }, { text: "関税" }, { text: "補助金" }] });
    expect(updateTermGroup(db, a.id, { name: "A2" })).toMatchObject({ name: "A2", color: "purple" });
    expect(names(db)).toEqual(["A2", "B"]);
  });

  it("take their terms with them when deleted", () => {
    const db = createTestDb();
    const a = createTermGroup(db, { name: "A" }, clock);
    addHighlightTerm(db, a.id, { text: "規制" }, clock);
    addHighlightTerm(db, a.id, { text: "関税" }, clock);
    deleteTermGroup(db, a.id);
    expect(listTermGroups(db)).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM highlight_terms").get()).toEqual({ n: 0 });
    expect(() => deleteTermGroup(db, a.id)).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  describe("moving", () => {
    function abc() {
      const db = createTestDb();
      const [a, b, c] = ["A", "B", "C"].map((name) => createTermGroup(db, { name }, clock));
      return { db, a: a!, b: b!, c: c! };
    }

    it("puts a group before another, and answers with the list", () => {
      const { db, a, c } = abc();
      expect(moveTermGroup(db, c.id, a.id).map((group) => group.name)).toEqual(["C", "A", "B"]);
    });

    it("puts a group last", () => {
      const { db, a } = abc();
      expect(moveTermGroup(db, a.id, null).map((group) => group.name)).toEqual(["B", "C", "A"]);
    });

    it("refuses a group that does not exist as the place, and keeps the order", () => {
      const { db, a } = abc();
      expect(() => moveTermGroup(db, a.id, 999)).toThrow(expect.objectContaining({ code: "invalid" }));
      expect(names(db)).toEqual(["A", "B", "C"]);
      expect(() => moveTermGroup(db, 999, a.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    });

    it("puts a group added after moving at the end", () => {
      const { db, a } = abc();
      moveTermGroup(db, a.id, null);
      createTermGroup(db, { name: "D" }, clock);
      expect(names(db)).toEqual(["B", "C", "A", "D"]);
    });
  });
});

describe("highlight terms", () => {
  it("refuse the same term in the same group, whatever its case and width", () => {
    const db = createTestDb();
    const a = createTermGroup(db, { name: "A" }, clock);
    addHighlightTerm(db, a.id, { text: "tsmc" }, clock);
    expect(() => addHighlightTerm(db, a.id, { text: "ＴＳＭＣ" }, clock)).toThrow(expect.objectContaining({ code: "conflict" }));
    expect(listTermGroups(db)[0]!.terms.map((term) => term.text)).toEqual(["tsmc"]);
  });

  it("may be in two groups", () => {
    const db = createTestDb();
    const a = createTermGroup(db, { name: "A" }, clock);
    const b = createTermGroup(db, { name: "B" }, clock);
    addHighlightTerm(db, a.id, { text: "規制" }, clock);
    expect(addHighlightTerm(db, b.id, { text: "規制" }, clock).terms.map((term) => term.text)).toEqual(["規制"]);
    expect(listTermGroups(db).map((group) => group.terms.map((term) => term.text))).toEqual([["規制"], ["規制"]]);
  });

  it("leave the group without terms when the last one goes", () => {
    const db = createTestDb();
    const a = createTermGroup(db, { name: "A" }, clock);
    const term = addHighlightTerm(db, a.id, { text: "規制" }, clock).terms[0]!;
    deleteHighlightTerm(db, a.id, term.id);
    expect(listTermGroups(db)).toEqual([expect.objectContaining({ name: "A", terms: [] })]);
  });

  it("are refused for a group that does not exist, and a term of another group is not found", () => {
    const db = createTestDb();
    const a = createTermGroup(db, { name: "A" }, clock);
    const b = createTermGroup(db, { name: "B" }, clock);
    const term = addHighlightTerm(db, a.id, { text: "規制" }, clock).terms[0]!;
    expect(() => addHighlightTerm(db, 999, { text: "x" }, clock)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => deleteHighlightTerm(db, b.id, term.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => deleteHighlightTerm(db, a.id, 999)).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("change nothing of the articles: read, starred, the list and the counts stay", () => {
    const db = createTestDb();
    const feed = seedFeed(db);
    for (const title of ["規制の話 1", "規制の話 2", "規制の話 3"]) seedFeedArticle(db, feed, { title });
    const now = clock().toISOString();
    const first = listArticles(db, {}, now).items[0]!;
    setArticleFlags(db, first.id, { starred: true, isRead: true }, now);
    const snapshot = () => ({ list: listArticles(db, {}, now), unread: listArticles(db, { unread: "true" }, now), counts: getCounts(db, now) });
    const before = snapshot();

    const a = createTermGroup(db, { name: "A" }, clock);
    const term = addHighlightTerm(db, a.id, { text: "規制" }, clock).terms[0]!;
    expect(snapshot()).toEqual(before);
    deleteHighlightTerm(db, a.id, term.id);
    deleteTermGroup(db, a.id);
    expect(snapshot()).toEqual(before);
  });
});
