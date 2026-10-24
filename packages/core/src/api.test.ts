import { describe, expect, it } from "vitest";
import { filterCreateSchema, filterPreviewSchema, filterUpdateSchema, MAX_FILTER_CONDITIONS, MAX_FILTER_VALUE_CHARS, settingsFileSchema } from "./api.ts";

const condition = { fields: ["title"], match: "contains", value: "特売" } as const;

function issuesOf(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  return (result.error?.issues ?? []).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("the shape of a filter", () => {
  it("takes a hide filter over everything, enabled unless told otherwise", () => {
    const parsed = filterCreateSchema.parse({ action: "hide", scope: { type: "all" }, conditions: [condition] });
    expect(parsed).toEqual({ action: "hide", scope: { type: "all" }, conditions: [condition] });
  });

  it("takes a keep filter over a category or a feed", () => {
    expect(filterCreateSchema.safeParse({ action: "keep", scope: { type: "category", categoryId: 1 }, conditions: [condition] }).success).toBe(true);
    expect(filterCreateSchema.safeParse({ action: "keep", scope: { type: "feed", feedId: 2 }, conditions: [condition] }).success).toBe(true);
  });

  it("refuses a keep filter over everything, on the scope", () => {
    const result = filterCreateSchema.safeParse({ action: "keep", scope: { type: "all" }, conditions: [condition] });
    expect(issuesOf(result)).toEqual([{ path: "scope", message: "a keep filter cannot apply to everything" }]);
    expect(filterPreviewSchema.safeParse({ action: "keep", scope: { type: "all" }, conditions: [condition] }).success).toBe(false);
    expect(filterUpdateSchema.safeParse({ action: "keep", scope: { type: "all" } }).success).toBe(false);
  });

  it("refuses a filter without conditions", () => {
    const result = filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: [] });
    expect(issuesOf(result)).toEqual([{ path: "conditions", message: "a filter needs at least one condition" }]);
  });

  it("refuses more conditions than the limit, and a value longer than the limit", () => {
    const many = Array.from({ length: MAX_FILTER_CONDITIONS + 1 }, () => condition);
    expect(filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: many }).success).toBe(false);
    const ten = Array.from({ length: MAX_FILTER_CONDITIONS }, () => condition);
    expect(filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: ten }).success).toBe(true);

    const long = { ...condition, value: "x".repeat(MAX_FILTER_VALUE_CHARS + 1) };
    const result = filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: [condition, long] });
    expect(issuesOf(result).map((issue) => issue.path)).toEqual(["conditions.1.value"]);
  });

  it("refuses a condition without fields, with a field twice, or with an empty value", () => {
    const bad = (patch: object) =>
      issuesOf(filterCreateSchema.safeParse({ action: "hide", scope: { type: "all" }, conditions: [{ ...condition, ...patch }] })).map((issue) => issue.path);
    expect(bad({ fields: [] })).toEqual(["conditions.0.fields"]);
    expect(bad({ fields: ["title", "title"] })).toEqual(["conditions.0.fields"]);
    expect(bad({ value: "  " })).toEqual(["conditions.0.value"]);
    expect(bad({ fields: ["body"] })).toEqual(["conditions.0.fields.0"]);
  });
});

describe("filters in the settings file", () => {
  it("names the scope by a category's slug or a feed's URL", () => {
    const file = settingsFileSchema.parse({
      version: 1,
      filters: [
        { action: "hide", scope: "all", conditions: [condition] },
        { action: "keep", scope: { category: "tools" }, conditions: [condition] },
        { action: "keep", scope: { feed: "https://example.com/feed.xml" }, enabled: false, conditions: [condition] },
      ],
    });
    expect(file.filters.map((filter) => filter.scope)).toEqual(["all", { category: "tools" }, { feed: "https://example.com/feed.xml" }]);
  });

  it("refuses a keep filter over everything", () => {
    expect(settingsFileSchema.safeParse({ version: 1, filters: [{ action: "keep", scope: "all", conditions: [condition] }] }).success).toBe(false);
  });

  it("still reads the stop words of an older file", () => {
    const file = settingsFileSchema.parse({ version: 1, stopWords: [{ text: "広告" }, { text: "提供", scope: "title_and_content" }] });
    expect(file.stopWords).toEqual([{ text: "広告" }, { text: "提供", scope: "title_and_content" }]);
    expect(file.filters).toEqual([]);
  });
});
