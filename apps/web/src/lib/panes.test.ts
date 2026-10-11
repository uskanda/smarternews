import { describe, expect, it } from "vitest";
import { fitPanes, PANES, readPaneWidths, widestFor, writePaneWidths } from "./panes.ts";

describe("fitPanes", () => {
  it("shows the stored widths when the article keeps its room", () => {
    expect(fitPanes({ viewport: 1280, layout: "wide", stored: { nav: 260, list: 380 } })).toEqual({ nav: 260, list: 380 });
  });

  it("narrows the list first, then the navigation, so that the article never gets under its smallest width", () => {
    expect(fitPanes({ viewport: 1100, layout: "wide", stored: { nav: 200, list: 640 } })).toEqual({ nav: 200, list: 540 });
    expect(fitPanes({ viewport: 1100, layout: "wide", stored: { nav: 400, list: 640 } })).toEqual({ nav: 400, list: 340 });
    expect(fitPanes({ viewport: 1100, layout: "wide", stored: { nav: 400, list: 280 } })).toEqual({ nav: 400, list: 280 });
  });

  it("does not count the navigation where it is behind a button", () => {
    expect(fitPanes({ viewport: 900, layout: "medium", stored: { nav: 400, list: 640 } })).toEqual({ nav: 400, list: 540 });
    expect(fitPanes({ viewport: 720, layout: "medium", stored: { nav: 200, list: 380 } })).toEqual({ nav: 200, list: 360 });
  });

  it("brings widths from outside the range back into it", () => {
    expect(fitPanes({ viewport: 1920, layout: "wide", stored: { nav: 20, list: 5000 } })).toEqual({ nav: PANES.nav.min, list: PANES.list.max });
  });
});

describe("widestFor", () => {
  it("is the largest width of the range while the article keeps its room", () => {
    expect(widestFor("nav", { viewport: 1920, layout: "wide", shown: { nav: 200, list: 380 } })).toBe(400);
    expect(widestFor("list", { viewport: 1920, layout: "wide", shown: { nav: 200, list: 380 } })).toBe(640);
  });

  it("is less when the screen has no more room to give", () => {
    expect(widestFor("list", { viewport: 1100, layout: "wide", shown: { nav: 200, list: 380 } })).toBe(540);
    expect(widestFor("nav", { viewport: 1100, layout: "wide", shown: { nav: 200, list: 380 } })).toBe(360);
    expect(widestFor("list", { viewport: 900, layout: "medium", shown: { nav: 200, list: 380 } })).toBe(540);
  });
});

describe("the stored widths", () => {
  it("are the defaults until something was stored", () => {
    expect(readPaneWidths()).toEqual({ nav: 200, list: 380 });
  });

  it("come back after being stored", () => {
    writePaneWidths({ nav: 260, list: 300 });
    expect(readPaneWidths()).toEqual({ nav: 260, list: 300 });
  });

  it("fall back to the defaults when what is stored cannot be read or is not a width", () => {
    window.localStorage.setItem("smarternews.panes", "{not json");
    expect(readPaneWidths()).toEqual({ nav: 200, list: 380 });
    window.localStorage.setItem("smarternews.panes", JSON.stringify({ nav: "wide", list: null }));
    expect(readPaneWidths()).toEqual({ nav: 200, list: 380 });
    window.localStorage.setItem("smarternews.panes", JSON.stringify({ nav: 9999, list: 1 }));
    expect(readPaneWidths()).toEqual({ nav: 400, list: 280 });
  });
});
