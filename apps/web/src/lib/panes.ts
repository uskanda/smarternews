// The widths of the two panes a reader can resize: the navigation and the list of articles. The stored
// widths are what the reader chose; what is shown may be narrower, because the article always keeps room.
import { useCallback, useSyncExternalStore } from "react";
import { spacing } from "../styles/sizes.ts";
import type { Layout } from "./layout.ts";

export type PaneName = "nav" | "list";
export type PaneWidths = Record<PaneName, number>;

export const PANES: Record<PaneName, { initial: number; min: number; max: number }> = {
  nav: { initial: spacing.nav, min: spacing["nav-min"], max: spacing["nav-max"] },
  list: { initial: spacing.list, min: spacing["list-min"], max: spacing["list-max"] },
};
/** The article is never narrower than this while it shares the screen. */
export const ARTICLE_MIN = spacing["article-min"];
/** How far one press of an arrow key moves a border. */
export const KEY_STEP = spacing.lg;

const KEY = "smarternews.panes";
const DEFAULTS: PaneWidths = { nav: PANES.nav.initial, list: PANES.list.initial };

function clamp(name: PaneName, width: number): number {
  return Math.round(Math.min(PANES[name].max, Math.max(PANES[name].min, width)));
}

export function readPaneWidths(): PaneWidths {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Record<PaneName, unknown>>;
    const width = (name: PaneName) => (typeof stored[name] === "number" && Number.isFinite(stored[name]) ? clamp(name, stored[name]) : DEFAULTS[name]);
    return { nav: width("nav"), list: width("list") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePaneWidths(widths: PaneWidths): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(widths));
  } catch {
    // without storage the widths last until the page is closed
  }
}

/** The room the panes other than the article may take together. The navigation counts only where it is a pane. */
function roomFor(viewport: number): number {
  return Math.max(0, viewport - ARTICLE_MIN);
}

/**
 * The widths to show: the stored ones, narrowed where the screen is too small to leave the article its
 * smallest width. The list gives way first, then the navigation; neither goes under its own smallest width.
 */
export function fitPanes(input: { viewport: number; layout: Layout; stored: PaneWidths }): PaneWidths {
  let nav = clamp("nav", input.stored.nav);
  let list = clamp("list", input.stored.list);
  const navShown = input.layout === "wide" ? nav : 0;
  const over = navShown + list - roomFor(input.viewport);
  if (over > 0) {
    const fromList = Math.min(over, list - PANES.list.min);
    list -= fromList;
    if (input.layout === "wide") nav -= Math.min(over - fromList, nav - PANES.nav.min);
  }
  return { nav, list };
}

/** How wide a pane may be made right now: its largest width, or less when the article would lose its room. */
export function widestFor(name: PaneName, input: { viewport: number; layout: Layout; shown: PaneWidths }): number {
  const other = name === "nav" ? input.shown.list : input.layout === "wide" ? input.shown.nav : 0;
  return Math.max(PANES[name].min, Math.min(PANES[name].max, roomFor(input.viewport) - other));
}

// ---- one state for the whole page: the navigation and the list are in different components ---------------

let widths: PaneWidths | null = null;
const listeners = new Set<() => void>();

function snapshot(): PaneWidths {
  widths ??= readPaneWidths();
  return widths;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setStored(next: PaneWidths): void {
  widths = next;
  writePaneWidths(next);
  for (const listener of listeners) listener();
}

/** Forgets what this page holds, so that the next read comes from the browser's storage. For tests. */
export function resetPaneState(): void {
  widths = null;
}

function subscribeViewport(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** The widths to show at the current size of the window, and the ways to change what is stored. */
export function usePanes(layout: Layout) {
  const stored = useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
  const viewport = useSyncExternalStore(subscribeViewport, () => window.innerWidth, () => 1280);
  const shown = fitPanes({ viewport, layout, stored });
  const set = useCallback((name: PaneName, width: number) => setStored({ ...snapshot(), [name]: clamp(name, width) }), []);
  const reset = useCallback((name: PaneName) => setStored({ ...snapshot(), [name]: PANES[name].initial }), []);
  return {
    shown,
    /** The largest width the pane can take now. */
    widest: (name: PaneName) => widestFor(name, { viewport, layout, shown }),
    set,
    reset,
  };
}
