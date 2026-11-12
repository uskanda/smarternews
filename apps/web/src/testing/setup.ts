import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure } from "@testing-library/react";
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

// jsdom lays nothing out, so nothing ever comes into view by itself. Tests say what does, through `intersect`.
// As in a browser, an observer is told of what it starts to observe: here, of what a test left in view.
const intersectionObservers = new Set<FakeIntersectionObserver>();
let inView = new WeakSet<Element>();
class FakeIntersectionObserver {
  readonly targets = new Set<Element>();
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.targets.add(target);
    intersectionObservers.add(this);
    if (!inView.has(target)) return;
    setTimeout(() => {
      if (this.targets.has(target) && inView.has(target)) act(() => this.tell(target, true));
    }, 0);
  }
  tell(target: Element, isIntersecting: boolean) {
    const entry = { target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    intersectionObservers.delete(this);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
/** Tells every observer of `target` that it came into view, or went out of it. Call it inside `act`. */
export function intersect(target: Element, isIntersecting = true, { stays = isIntersecting }: { stays?: boolean } = {}): void {
  // `stays: false` is a target that what happens next pushes out of view: an observer that starts later hears nothing.
  if (stays) inView.add(target);
  else inView.delete(target);
  for (const observer of [...intersectionObservers]) {
    if (observer.targets.has(target)) observer.tell(target, isIntersecting);
  }
}
afterEach(() => {
  intersectionObservers.clear();
  inView = new WeakSet();
});
globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
