import { describe, expect, it } from "vitest";
import type { FilterCondition } from "../api.ts";
import { compileConditions, conditionProblems, matchesAll, normalizeForMatch, regexProblem, type MatchableArticle } from "./match.ts";

const article = (patch: Partial<MatchableArticle> = {}): MatchableArticle => ({
  title: "新製品の発表",
  contentText: "",
  author: null,
  url: null,
  ...patch,
});

function meets(conditions: FilterCondition[], target: MatchableArticle): boolean {
  return matchesAll(compileConditions(conditions), target);
}
const contains = (fields: FilterCondition["fields"], value: string): FilterCondition => ({ fields, match: "contains", value });
const regex = (fields: FilterCondition["fields"], value: string): FilterCondition => ({ fields, match: "regex", value });

describe("normalizeForMatch", () => {
  it("makes full-width and half-width, upper and lower case alike", () => {
    expect(normalizeForMatch("ＰＲ　ｶﾒﾗ")).toBe("pr カメラ");
  });
});

describe("a condition that looks for a part of the text", () => {
  it("finds the value anywhere in the field", () => {
    expect(meets([contains(["title"], "特売")], article({ title: "春の特売の情報" }))).toBe(true);
    expect(meets([contains(["title"], "特売")], article({ title: "春の新製品" }))).toBe(false);
  });

  it("does not tell upper case from lower case, or full-width from half-width", () => {
    expect(meets([contains(["title"], "pr")], article({ title: "ＰＲ　新しい店" }))).toBe(true);
    expect(meets([contains(["title"], "ＰＲ")], article({ title: "[pr] new shop" }))).toBe(true);
    expect(meets([contains(["title"], "ｶﾒﾗ")], article({ title: "新しいカメラ" }))).toBe(true);
  });

  it("compares signs as the characters they are, not as a pattern", () => {
    expect(meets([contains(["title"], ".*")], article({ title: "新製品の発表" }))).toBe(false);
    expect(meets([contains(["title"], ".*")], article({ title: "glob .* explained" }))).toBe(true);
  });
});

describe("a condition with a regular expression", () => {
  it("matches anywhere in the field, without telling case apart", () => {
    expect(meets([regex(["title"], "^\\[pr\\]")], article({ title: "[PR]新しいサービス" }))).toBe(true);
    expect(meets([regex(["title"], "^\\[pr\\]")], article({ title: "新しい[PR]サービス" }))).toBe(false);
    expect(meets([regex(["title"], "release|announce")], article({ title: "We Announce v2" }))).toBe(true);
  });

  it("matches a title written in full-width letters and digits", () => {
    expect(meets([regex(["title"], "sale\\s*\\d+%")], article({ title: "夏のＳＡＬＥ　５０％オフ" }))).toBe(true);
  });

  it("keeps the meaning of escapes that differ in upper case", () => {
    expect(meets([regex(["title"], "^\\D+$")], article({ title: "ABC" }))).toBe(true);
    expect(meets([regex(["title"], "^\\D+$")], article({ title: "A1C" }))).toBe(false);
  });
});

describe("the fields of a condition", () => {
  it("meets a condition when any chosen field matches", () => {
    const sponsored = article({ title: "新製品", contentText: "この記事は提供でお送りします" });
    expect(meets([contains(["title", "content"], "提供")], sponsored)).toBe(true);
    expect(meets([contains(["title"], "提供")], sponsored)).toBe(false);
  });

  it("never meets an author condition for an article without an author", () => {
    expect(meets([regex(["author"], ".*")], article({ author: null }))).toBe(false);
    expect(meets([regex(["author"], ".*")], article({ author: "広報部" }))).toBe(true);
    expect(meets([regex(["title", "author"], "^新製品")], article({ author: null }))).toBe(true);
  });

  it("matches the URL of the article's page", () => {
    expect(meets([contains(["url"], "/sponsored/")], article({ url: "https://example.com/sponsored/1" }))).toBe(true);
    expect(meets([contains(["url"], "/sponsored/")], article({ url: null }))).toBe(false);
  });

  it("matches the content text, which holds no link targets", () => {
    // The stored content text has the link targets taken out already: only the words of the link remain.
    expect(meets([contains(["content"], "campaign")], article({ contentText: "詳しくはこちら" }))).toBe(false);
  });
});

describe("several conditions", () => {
  it("meet an article only when all of them do", () => {
    const conditions = [contains(["title"], "セール"), contains(["author"], "広報")];
    expect(meets(conditions, article({ title: "夏のセール", author: "営業" }))).toBe(false);
    expect(meets(conditions, article({ title: "夏のセール", author: "広報部" }))).toBe(true);
  });
});

describe("regexProblem", () => {
  it("says why a value is not a regular expression", () => {
    expect(regexProblem("(sale")).toMatch(/not a valid regular expression/);
    expect(regexProblem("sale")).toBeNull();
  });

  it("names the condition whose value is wrong", () => {
    const problems = conditionProblems([contains(["title"], "(sale"), regex(["title"], "ok"), regex(["title"], "(sale")]);
    expect(problems).toEqual([{ path: "conditions.2.value", message: expect.stringMatching(/not a valid regular expression/) }]);
  });
});
