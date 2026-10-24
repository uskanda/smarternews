import { normalizeForMatch, type TermColor, type TermGroup } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { createTermMatcher, splitHighlights } from "./highlight.ts";

let serial = 0;
function group(name: string, color: TermColor, ...terms: string[]): TermGroup {
  serial += 1;
  return { id: serial, name, color, terms: terms.map((text, index) => ({ id: serial * 100 + index, text })) };
}

/** The parts of a text as `[text, colour or null]`. */
function colored(groups: TermGroup[], text: string): Array<[string, TermColor | null]> {
  return createTermMatcher(groups)
    .split(text)
    .map((part) => [part.text, part.group?.color ?? null]);
}

describe("splitting a text by the terms of the groups", () => {
  it("leaves a text without terms whole", () => {
    expect(colored([], "新しい規制案")).toEqual([["新しい規制案", null]]);
    expect(colored([group("A", "green")], "新しい規制案")).toEqual([["新しい規制案", null]]);
  });

  it("colours a term written in full-width capitals", () => {
    expect(colored([group("A", "green", "ai")], "生成ＡＩの話")).toEqual([
      ["生成", null],
      ["ＡＩ", "green"],
      ["の話", null],
    ]);
  });

  it("colours only the part of a word that is the term", () => {
    expect(colored([group("A", "green", "規制")], "新しい規制案")).toEqual([
      ["新しい", null],
      ["規制", "green"],
      ["案", null],
    ]);
  });

  it("matches symbols as symbols", () => {
    expect(colored([group("A", "green", ".*")], "新製品の発表")).toEqual([["新製品の発表", null]]);
    expect(colored([group("A", "green", ".*")], "a.*b")).toEqual([
      ["a", null],
      [".*", "green"],
      ["b", null],
    ]);
  });

  it("colours the whole of half-width katakana with its sound mark", () => {
    expect(colored([group("A", "green", "ガス")], "都市ｶﾞｽの料金")).toEqual([
      ["都市", null],
      ["ｶﾞｽ", "green"],
      ["の料金", null],
    ]);
  });

  it("colours the whole of a ligature and of full-width digits", () => {
    expect(colored([group("A", "pink", "fi")], "ﬁnance")).toEqual([
      ["ﬁ", "pink"],
      ["nance", null],
    ]);
    expect(colored([group("A", "pink", "2026")], "２０２６年")).toEqual([
      ["２０２６", "pink"],
      ["年", null],
    ]);
  });

  it("colours a place two groups match with the upper group", () => {
    const a = group("A", "green", "半導体");
    const b = group("B", "purple", "半導体の規制");
    expect(colored([a, b], "新しい半導体の規制")).toEqual([
      ["新しい", null],
      ["半導体", "green"],
      ["の規制", "purple"],
    ]);
    expect(colored([b, a], "新しい半導体の規制")).toEqual([
      ["新しい", null],
      ["半導体の規制", "purple"],
    ]);
  });

  it("joins terms of one group that overlap or touch", () => {
    expect(colored([group("A", "orange", "半導", "導体", "の")], "半導体の")).toEqual([["半導体の", "orange"]]);
  });

  it("finds occurrences that overlap one another", () => {
    const a = group("A", "green", "aba");
    expect(colored([a], "ababa")).toEqual([["ababa", "green"]]);
  });

  it("matches as stop words matched: what a filter finds in the normalized text, a group colours", () => {
    const cases: Array<[string, string]> = [
      ["都市ｶﾞｽの料金", "ガス"],
      ["ﾊﾟﾝの値段", "パン"],
      ["ＴＳＭＣの工場", "tsmc"],
      ["２０２６年の予算", "2026"],
      ["ﬁnance news", "fin"],
      ["㍿の表記", "株式会社"],
      ["新製品の発表", ".*"],
      ["Chip makers", "CHIP"],
    ];
    for (const [text, term] of cases) {
      const matcher = createTermMatcher([group("A", "green", term)]);
      const filterFinds = normalizeForMatch(text).includes(normalizeForMatch(term));
      expect(matcher.groupsIn([text]).length > 0, `${term} in ${text}`).toBe(filterFinds);
      expect(matcher.split(text).some((part) => part.group !== null)).toBe(filterFinds);
    }
  });
});

describe("the groups that texts match", () => {
  it("are in the order of the groups, each once, whichever text matched", () => {
    const a = group("半導体", "green", "半導体", "TSMC");
    const b = group("通商", "orange", "関税");
    const c = group("その他", "pink", "天気");
    const matcher = createTermMatcher([a, b, c]);
    expect(matcher.groupsIn(["関税と半導体", "TSMCの関税"]).map((found) => found.name)).toEqual(["半導体", "通商"]);
  });

  it("are none when no text matches, and texts that are missing are skipped", () => {
    const matcher = createTermMatcher([group("A", "green", "規制")]);
    expect(matcher.groupsIn(["新製品", null, undefined])).toEqual([]);
  });
});

describe("splitting a text by search terms and groups together", () => {
  it("marks the search and the group each where they match, and both where both do", () => {
    const matcher = createTermMatcher([group("A", "green", "半導体")]);
    expect(splitHighlights("新しい半導体の規制", matcher, ["導体の規"])).toEqual([
      { text: "新しい", group: null, search: false },
      { text: "半", group: expect.objectContaining({ color: "green" }), search: false },
      { text: "導体", group: expect.objectContaining({ color: "green" }), search: true },
      { text: "の規", group: null, search: true },
      { text: "制", group: null, search: false },
    ]);
  });

  it("works with only one of the two", () => {
    expect(splitHighlights("規制", null, ["規制"])).toEqual([{ text: "規制", group: null, search: true }]);
    expect(splitHighlights("規制", createTermMatcher([]), undefined)).toEqual([{ text: "規制", group: null, search: false }]);
    expect(splitHighlights("", createTermMatcher([group("A", "green", "a")]), ["a"])).toEqual([]);
  });
});

describe("the time to split a long text", () => {
  it("stays short for 100,000 characters and 50 terms", () => {
    const words = Array.from({ length: 50 }, (_, index) => `語${index}番`);
    const groups = [group("A", "green", ...words.slice(0, 25)), group("B", "purple", ...words.slice(25))];
    const sentence = "新しい規制案について、半導体の工場と通商の話題を伝える文。語7番と語42番も出てくる。";
    const text = sentence.repeat(Math.ceil(100_000 / sentence.length)).slice(0, 100_000);
    const matcher = createTermMatcher(groups);
    const started = performance.now();
    const parts = matcher.split(text);
    const took = performance.now() - started;
    console.log(`[highlight] 100,000 characters, 50 terms: ${took.toFixed(1)} ms`);
    expect(parts.filter((part) => part.group !== null).length).toBeGreaterThan(1000);
    expect(took).toBeLessThan(1000);
    // The same text again comes from what was kept.
    const again = performance.now();
    expect(matcher.split(text)).toBe(parts);
    expect(performance.now() - again).toBeLessThan(5);
  });
});
