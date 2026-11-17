import { describe, expect, it } from "vitest";
import { countNewArticles } from "./count-new.ts";

describe("countNewArticles", () => {
  it("counts the articles that came in at the top", () => {
    expect(countNewArticles({ before: [3, 2, 1], after: [5, 4, 3, 2, 1], complete: false })).toBe(2);
  });

  it("counts nothing when the list came back the same", () => {
    expect(countNewArticles({ before: [3, 2, 1], after: [3, 2, 1], complete: false })).toBe(0);
  });

  it("does not count the articles moved up from a page not loaded when read rows went away", () => {
    // 2 and 1 were read and leave the unread list; 0 and -1 come up from the next page.
    expect(countNewArticles({ before: [4, 3, 2, 1], after: [4, 3, 0, -1], complete: false })).toBe(0);
    expect(countNewArticles({ before: [4, 3, 2, 1], after: [9, 4, 3, 0], complete: false })).toBe(1);
  });

  it("counts nothing when every row went away and more pages were there to move up", () => {
    expect(countNewArticles({ before: [4, 3], after: [2, 1], complete: false })).toBe(0);
  });

  it("does not count an article added at the end of an oldest-first list past what was loaded", () => {
    expect(countNewArticles({ before: [1, 2, 3], after: [1, 2, 3, 4], complete: false })).toBe(0);
  });

  it("counts every article not shown before when the whole list was loaded", () => {
    expect(countNewArticles({ before: [1, 2, 3], after: [1, 2, 3, 4], complete: true })).toBe(1);
    expect(countNewArticles({ before: [4, 3], after: [6, 5], complete: true })).toBe(2);
  });

  it("counts every article when the list was empty", () => {
    expect(countNewArticles({ before: [], after: [2, 1], complete: true })).toBe(2);
  });
});
