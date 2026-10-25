import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseScrollRead, readScrollRead, resetScrollReadState } from "./scroll-read.ts";

describe("the stored setting to mark read what the list is scrolled past", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is off until the user turns it on", () => {
    expect(readScrollRead()).toBe(false);
  });

  it("is kept in the browser's storage when turned on, and taken out when turned off", () => {
    chooseScrollRead(true);
    expect(readScrollRead()).toBe(true);
    expect(window.localStorage.getItem("smarternews.scrollRead")).toBe("on");
    chooseScrollRead(false);
    expect(readScrollRead()).toBe(false);
    expect(window.localStorage.getItem("smarternews.scrollRead")).toBeNull();
  });

  it("is on again when the page is opened again", () => {
    chooseScrollRead(true);
    resetScrollReadState();
    expect(readScrollRead()).toBe(true);
  });

  it("is off for something unknown that is stored", () => {
    window.localStorage.setItem("smarternews.scrollRead", "yes");
    resetScrollReadState();
    expect(readScrollRead()).toBe(false);
  });

  it("is off where the browser keeps no storage, even after the user turns it on", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    resetScrollReadState();
    expect(readScrollRead()).toBe(false);
    chooseScrollRead(true);
    expect(readScrollRead()).toBe(false);
  });
});
