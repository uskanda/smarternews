import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetCollapsedState } from "../lib/collapsed.ts";
import { resetHideReadState } from "../lib/hide-read.ts";
import { resetHotkeys } from "../lib/keys.ts";
import { resetPaneState } from "../lib/panes.ts";
import { resetScrollReadState } from "../lib/scroll-read.ts";
import { resetThemeState } from "../lib/theme.ts";

// Screens answer from a real API, so on a busy machine a list can take longer than the 1 s default to appear.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPaneState();
  resetCollapsedState();
  resetThemeState();
  resetScrollReadState();
  resetHideReadState();
  resetHotkeys();
});

// jsdom has no layout, so it has no media queries either. Tests choose the width through `setViewport`.
let width = 1280;
Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
export function setViewport(next: number): void {
  width = next;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: next });
  window.dispatchEvent(new Event("resize"));
  for (const listener of listeners) listener();
}
const listeners = new Set<() => void>();

// The font size the browser is set to: what an em in a media query and the root element's font size measure.
// Tests choose it through `setFontSize`; 16px is the browser's default.
let fontSize = 16;
export function setFontSize(next: number): void {
  fontSize = next;
  document.documentElement.style.fontSize = `${next}px`;
  for (const listener of listeners) listener();
}

/** A length of a media query in pixels: `720px`, or `45em` at the font size the browser is set to. */
function length(query: string, feature: string): number | null {
  const match = new RegExp(`${feature}:\\s*(\\d+(?:\\.\\d+)?)(px|em)`).exec(query);
  if (!match) return null;
  return Number(match[1]) * (match[2] === "em" ? fontSize : 1);
}

function matches(query: string): boolean {
  const min = length(query, "min-width");
  const max = length(query, "max-width");
  return (min === null || width >= min) && (max === null || width <= max);
}

window.matchMedia = ((query: string) => {
  const list = {
    get matches() {
      return matches(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  };
  return list as unknown as MediaQueryList;
}) as typeof window.matchMedia;

afterEach(() => {
  width = 1280;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  fontSize = 16;
  document.documentElement.style.fontSize = "";
  listeners.clear();
});

// jsdom does not implement these, and the app calls them.
Element.prototype.scrollIntoView = () => {};
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
