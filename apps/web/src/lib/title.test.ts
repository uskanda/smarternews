import { describe, expect, it } from "vitest";
import { pageTitle, TITLE_CHARS } from "./title.ts";

describe("pageTitle", () => {
  it("shows the number of unread articles", () => {
    expect(pageTitle(12)).toBe("SmarterNews(12)");
    expect(pageTitle(0)).toBe("SmarterNews(0)");
  });

  it("adds the start of the open article's title", () => {
    expect(pageTitle(3, "Widget maker confirms outage")).toBe("SmarterNews(3)-Widget maker confirms outage");
    expect(pageTitle(3, "あ".repeat(TITLE_CHARS + 5))).toBe(`SmarterNews(3)-${"あ".repeat(TITLE_CHARS)}`);
  });

  it("cuts between characters, not inside one", () => {
    expect(pageTitle(1, "😀".repeat(TITLE_CHARS + 1))).toBe(`SmarterNews(1)-${"😀".repeat(TITLE_CHARS)}`);
  });

  it("is the bare name until the count is known", () => {
    expect(pageTitle(undefined)).toBe("SmarterNews");
    expect(pageTitle(undefined, "Story")).toBe("SmarterNews-Story");
  });
});
