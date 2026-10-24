import { describe, expect, it } from "vitest";
import { DomainError } from "../errors.ts";
import { excerptOf, matchRanges, MAX_QUERY_CHARS, normalizeForMatch, parseSearchTerms } from "./text.ts";

describe("normalizeForMatch", () => {
  it("makes full-width and half-width, upper and lower case alike", () => {
    expect(normalizeForMatch("ＰＲ　ｶﾒﾗ")).toBe("pr カメラ");
  });
});

describe("parseSearchTerms", () => {
  it("splits on half-width and full-width spaces, normalized", () => {
    expect(parseSearchTerms("ＡＩ　半導体")).toEqual(["ai", "半導体"]);
    expect(parseSearchTerms("  電池   工場 ")).toEqual(["電池", "工場"]);
  });

  it("drops a term given twice, in any width or case", () => {
    expect(parseSearchTerms("AI ai ＡＩ 電池")).toEqual(["ai", "電池"]);
  });

  it("keeps signs and operator words as they are", () => {
    expect(parseSearchTerms("C++ OR \"x\"")).toEqual(["c++", "or", '"x"']);
  });

  it("refuses an empty query", () => {
    expect(() => parseSearchTerms(" 　 ")).toThrow(DomainError);
    try {
      parseSearchTerms("");
    } catch (error) {
      expect((error as DomainError).fields).toEqual([{ path: "q", message: "is empty" }]);
    }
  });

  it("refuses a query of more than 200 characters", () => {
    expect(parseSearchTerms("a".repeat(MAX_QUERY_CHARS))).toHaveLength(1);
    expect(() => parseSearchTerms("a".repeat(MAX_QUERY_CHARS + 1))).toThrow(/too long/);
    // Counted in characters, not in UTF-16 units.
    expect(parseSearchTerms("😀".repeat(MAX_QUERY_CHARS))).toHaveLength(1);
  });
});

/** The parts of `text` the ranges cover. */
function marked(text: string, terms: string[]): string[] {
  return matchRanges(text, terms).map(([start, end]) => text.slice(start, end));
}

describe("matchRanges", () => {
  it("finds every occurrence, in the original's positions", () => {
    expect(matchRanges("電池と電池", ["電池"])).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it("does not tell full-width upper case from half-width lower case", () => {
    expect(marked("新しいＡＩの話とAiの話", ["ai"])).toEqual(["ＡＩ", "Ai"]);
  });

  it("matches half-width katakana with its voiced marks as one character", () => {
    // ｻｰﾊﾞｰ: the half-width voiced mark is a character of its own in the original.
    expect(marked("新しいｻｰﾊﾞｰです", ["サーバー"])).toEqual(["ｻｰﾊﾞｰ"]);
    expect(marked("ｶﾞｲﾄﾞ", ["ガ"])).toEqual(["ｶﾞ"]);
  });

  it("tells hiragana from katakana", () => {
    expect(matchRanges("ニュースの話", ["にゅーす"])).toEqual([]);
  });

  it("marks the whole of a character that widens when normalized", () => {
    // ㍿ is 株式会社 when normalized: a part of it marks all of it.
    expect(marked("新しい㍿の話", ["株式"])).toEqual(["㍿"]);
    expect(marked("新しい㍿の話", ["株式会社の"])).toEqual(["㍿の"]);
  });

  it("joins the ranges of terms that overlap", () => {
    expect(marked("データベース", ["データ", "ベース", "タベ"])).toEqual(["データベース"]);
  });

  it("returns nothing without terms", () => {
    expect(matchRanges("電池", [])).toEqual([]);
  });
});

describe("excerptOf", () => {
  const fields = (patch: Partial<Parameters<typeof excerptOf>[0]> = {}) => ({
    summary: "",
    autoSummary: null,
    body: "",
    impact: null,
    venue: null,
    ...patch,
  });

  it("cuts the text around a match in the middle, with marks where it was cut", () => {
    const body = `${"あ".repeat(2000)}電池${"い".repeat(2000)}`;
    const excerpt = excerptOf(fields({ body }), ["電池"])!;
    expect(excerpt).toContain("電池");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.indexOf("電池")).toBeGreaterThan(30);
    expect(excerpt.length).toBeLessThanOrEqual(124);
  });

  it("starts at the beginning when the match is near it", () => {
    expect(excerptOf(fields({ body: "電池の新しい工場ができた。" }), ["工場"])).toBe("電池の新しい工場ができた。");
  });

  it("takes the first field that matches: summary, automatic summary, body, impact, venue", () => {
    expect(excerptOf(fields({ summary: "要約に電池", body: "本文に電池" }), ["電池"])).toBe("要約に電池");
    expect(excerptOf(fields({ autoSummary: "自動の要約に電池", body: "本文に電池" }), ["電池"])).toBe("自動の要約に電池");
    expect(excerptOf(fields({ impact: "影響に金利" }), ["金利"])).toBe("影響に金利");
    expect(excerptOf(fields({ venue: "市民公会堂" }), ["公会堂"])).toBe("市民公会堂");
  });

  it("puts the text on one line", () => {
    expect(excerptOf(fields({ body: "一行目\n\n二行目に電池" }), ["電池"])).toBe("一行目 二行目に電池");
  });

  it("is null when no field but the title matches", () => {
    expect(excerptOf(fields({ summary: "別の話", body: "別の本文" }), ["電池"])).toBeNull();
  });
});
