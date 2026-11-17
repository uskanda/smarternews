import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetNoteDraft, keepNoteDraft, noteDraftOf } from "./note-drafts.ts";

describe("the drafts of notes on whole articles", () => {
  afterEach(() => vi.restoreAllMocks());

  it("are kept in the tab, one for each article", () => {
    keepNoteDraft(1, "あとで比べる");
    keepNoteDraft(2, "数字を確かめる");
    expect(noteDraftOf(1)).toBe("あとで比べる");
    expect(noteDraftOf(2)).toBe("数字を確かめる");
    expect(window.sessionStorage.getItem("smarternews.noteDraft.1")).toBe("あとで比べる");
    expect(window.localStorage.length).toBe(0);
  });

  it("are gone once forgotten, and none is there for an article without one", () => {
    keepNoteDraft(1, "あとで比べる");
    forgetNoteDraft(1);
    expect(noteDraftOf(1)).toBeNull();
    expect(noteDraftOf(3)).toBeNull();
  });

  it("keep an empty draft, which differs from a note that was saved", () => {
    keepNoteDraft(1, "");
    expect(noteDraftOf(1)).toBe("");
  });

  it("are not kept where the browser refuses the storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => keepNoteDraft(1, "あとで比べる")).not.toThrow();
    expect(noteDraftOf(1)).toBeNull();
    expect(() => forgetNoteDraft(1)).not.toThrow();
  });
});
