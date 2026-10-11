import { describe, expect, it } from "vitest";
import { followScroll } from "./follow.ts";

describe("followScroll", () => {
  const view = { top: 200, height: 300 };

  it("stays where it is while the whole row is in view", () => {
    expect(followScroll({ ...view, rowTop: 200, rowBottom: 260, step: 1 })).toBeNull();
    expect(followScroll({ ...view, rowTop: 440, rowBottom: 500, step: 1 })).toBeNull();
    expect(followScroll({ ...view, rowTop: 300, rowBottom: 360, step: -1 })).toBeNull();
  });

  it("puts a row that passed the bottom edge at the top when moving forward", () => {
    expect(followScroll({ ...view, rowTop: 500, rowBottom: 560, step: 1 })).toBe(500);
    expect(followScroll({ ...view, rowTop: 460, rowBottom: 520, step: 1 })).toBe(460);
  });

  it("puts a row that passed the top edge at the bottom when moving back", () => {
    expect(followScroll({ ...view, rowTop: 140, rowBottom: 200, step: -1 })).toBe(0);
    expect(followScroll({ ...view, rowTop: 560, rowBottom: 620, step: -1 })).toBe(320);
  });

  it("follows a row that is out of view on the other side as well", () => {
    expect(followScroll({ ...view, rowTop: 0, rowBottom: 60, step: 1 })).toBe(0);
    expect(followScroll({ ...view, rowTop: 900, rowBottom: 960, step: -1 })).toBe(660);
  });

  it("shows the start of a row that is taller than the view", () => {
    expect(followScroll({ ...view, rowTop: 600, rowBottom: 1000, step: -1 })).toBe(600);
    expect(followScroll({ ...view, rowTop: 600, rowBottom: 1000, step: 1 })).toBe(600);
  });
});
