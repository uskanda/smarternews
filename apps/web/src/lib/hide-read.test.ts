import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseHideRead, readHideRead, resetHideReadState } from "./hide-read.ts";

describe("the stored setting to hide the entries without unread articles", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is off until the user turns it on", () => {
    expect(readHideRead()).toBe(false);
  });

  it("is kept in the browser's storage when turned on, and taken out when turned off", () => {
    chooseHideRead(true);
    expect(readHideRead()).toBe(true);
    expect(window.localStorage.getItem("smarternews.nav.hideRead")).toBe("on");
    chooseHideRead(false);
    expect(readHideRead()).toBe(false);
    expect(window.localStorage.getItem("smarternews.nav.hideRead")).toBeNull();
  });

  it("is on again when the page is opened again", () => {
    chooseHideRead(true);
    resetHideReadState();
    expect(readHideRead()).toBe(true);
  });

  it("is off for something unknown that is stored", () => {
    window.localStorage.setItem("smarternews.nav.hideRead", "yes");
    resetHideReadState();
    expect(readHideRead()).toBe(false);
  });

  it("is off where the browser keeps no storage, even after the user turns it on", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    resetHideReadState();
    expect(readHideRead()).toBe(false);
    chooseHideRead(true);
    expect(readHideRead()).toBe(false);
  });
});
