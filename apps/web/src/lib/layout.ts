import { useSyncExternalStore } from "react";

/** wide: three panes. medium: list and article, navigation behind a button. narrow: one pane at a time. */
export type Layout = "wide" | "medium" | "narrow";

const WIDE = "(min-width: 1100px)";
const MEDIUM = "(min-width: 720px)";

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
