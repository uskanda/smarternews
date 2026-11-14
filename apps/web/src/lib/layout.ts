import { useSyncExternalStore } from "react";

/** wide: three panes. medium: list and article, navigation behind a button. narrow: one pane at a time. */
export type Layout = "wide" | "medium" | "narrow";

// In em, which a media query measures in the font size the browser is set to: 1100px and 720px at the default
// 16px, and larger text takes fewer panes the way zooming the page does.
const WIDE = "(min-width: 68.75em)";
const MEDIUM = "(min-width: 45em)";

function current(): Layout {
  if (window.matchMedia(WIDE).matches) return "wide";
  return window.matchMedia(MEDIUM).matches ? "medium" : "narrow";
}

function subscribe(onChange: () => void): () => void {
  const lists = [window.matchMedia(WIDE), window.matchMedia(MEDIUM)];
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, current, () => "wide");
}
