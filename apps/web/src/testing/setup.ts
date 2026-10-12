import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetCollapsedState } from "../lib/collapsed.ts";
import { resetPaneState } from "../lib/panes.ts";
import { resetThemeState } from "../lib/theme.ts";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPaneState();
  resetCollapsedState();
  resetThemeState();
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

function matches(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
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
