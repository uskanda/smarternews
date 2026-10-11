import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyStoredTheme, chooseTheme, readTheme, resetThemeState } from "./theme.ts";

const root = document.documentElement;
const WEB = join(import.meta.dirname, "..", "..");

describe("the stored colour scheme", () => {
  afterEach(() => vi.restoreAllMocks());

  it("follows the device, with no attribute on the root element, until the user chooses", () => {
    applyStoredTheme();
    expect(readTheme()).toBe("system");
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("puts the chosen scheme on the root element and into the browser's storage", () => {
    chooseTheme("dark");
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("smarternews.theme")).toBe("dark");
    expect(readTheme()).toBe("dark");
  });

  it("takes the attribute and the stored value away again when the user goes back to following the device", () => {
    chooseTheme("darkblue");
    chooseTheme("system");
    expect(root).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem("smarternews.theme")).toBeNull();
  });

  it("applies what was stored when the page is opened again", () => {
    window.localStorage.setItem("smarternews.theme", "light");
    resetThemeState();
    applyStoredTheme();
    expect(root).toHaveAttribute("data-theme", "light");
  });

  it("follows the device when something unknown is stored", () => {
    window.localStorage.setItem("smarternews.theme", "sepia");
    resetThemeState();
    applyStoredTheme();
    expect(readTheme()).toBe("system");
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("follows the device where the browser keeps no storage, and still shows a choice until the page is closed", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    resetThemeState();
    applyStoredTheme();
    expect(readTheme()).toBe("system");
    expect(root).not.toHaveAttribute("data-theme");

    chooseTheme("dark");
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(readTheme()).toBe("dark");
  });
});

describe("the script that runs before the first paint", () => {
  const script = readFileSync(join(WEB, "public", "theme.js"), "utf8");
  const run = () => new Function(script)();
  afterEach(() => vi.restoreAllMocks());

  it.each(["light", "dark", "darkblue"])("puts a stored %s on the root element", (stored) => {
    window.localStorage.setItem("smarternews.theme", stored);
    run();
    expect(root).toHaveAttribute("data-theme", stored);
  });

  it("leaves the root element alone when nothing or something unknown is stored", () => {
    run();
    expect(root).not.toHaveAttribute("data-theme");
    window.localStorage.setItem("smarternews.theme", "sepia");
    run();
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("leaves the root element alone where the browser keeps no storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(run).not.toThrow();
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("is loaded by the page from its own origin, in the head and before the app", () => {
    const page = readFileSync(join(WEB, "index.html"), "utf8");
    const head = page.slice(0, page.indexOf("</head>"));
    expect(head).toContain('<script src="/theme.js"></script>');
    // A script written into the page would be refused by the Content-Security-Policy the server sends.
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});
