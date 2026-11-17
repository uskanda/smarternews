import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure } from "@testing-library/react";
import { afterEach, onTestFinished } from "vitest";
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
globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;

/** What a test sees of the intersection observers the app makes, after `watchIntersections`. */
export interface Intersections {
  /** Puts the element in view: its observers are told now, and those made later are told when they start. */
  show(element: Element): void;
  /** Takes the element out of view, telling its observers. */
  hide(element: Element): void;
  /** The options of the observers watching the element now. */
  optionsFor(element: Element): IntersectionObserverInit[];
}

/**
 * Replaces the observer that does nothing, for this test, with one the test drives: jsdom has no layout, so
 * the test says which elements are in view. As in a browser, an observer tells what it watches once it starts.
 */
export function watchIntersections(): Intersections {
  const inView = new Set<Element>();
  const observers = new Set<DrivenObserver>();
  const entry = (target: Element): IntersectionObserverEntry =>
    ({ target, isIntersecting: inView.has(target), intersectionRatio: inView.has(target) ? 1 : 0 }) as IntersectionObserverEntry;
  class DrivenObserver {
    readonly targets = new Set<Element>();
    readonly callback: IntersectionObserverCallback;
    readonly options: IntersectionObserverInit;
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      this.callback = callback;
      this.options = options;
    }
    observe(target: Element) {
      this.targets.add(target);
      observers.add(this);
      queueMicrotask(() => {
        if (this.targets.has(target)) this.callback([entry(target)], this as unknown as IntersectionObserver);
      });
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
  }
  const tell = (element: Element) =>
    act(() => {
      for (const observer of [...observers]) {
        if (observer.targets.has(element)) observer.callback([entry(element)], observer as unknown as IntersectionObserver);
      }
    });
  globalThis.IntersectionObserver = DrivenObserver as unknown as typeof IntersectionObserver;
  onTestFinished(() => {
    globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
  });
  return {
    show(element) {
      inView.add(element);
      tell(element);
    },
    hide(element) {
      inView.delete(element);
      tell(element);
    },
    optionsFor: (element) => [...observers].filter((observer) => observer.targets.has(element)).map((observer) => observer.options),
  };
}
