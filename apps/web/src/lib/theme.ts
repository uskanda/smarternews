import { useSyncExternalStore } from "react";
import { parseThemeChoice, THEME_STORAGE_KEY, type ThemeChoice } from "@smarternews/client";

// The colour scheme is the `data-theme` attribute of the root element: the generated CSS holds the values of
// each scheme under it. Following the device is no attribute at all. `public/theme.js` sets the attribute
// before the first paint; this module does it again when the app starts, and whenever the user chooses.

function read(): ThemeChoice {
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // without storage the page follows the device
    return "system";
  }
}

// One state for the page: the settings show the choice, and the root element carries it.
let choice: ThemeChoice | null = null;
const listeners = new Set<() => void>();

function apply(next: ThemeChoice): void {
  if (next === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", next);
}

/** The colour scheme the user chose in this browser. */
export function readTheme(): ThemeChoice {
  choice ??= read();
  return choice;
}

/** Shows the page in the stored colour scheme. */
export function applyStoredTheme(): void {
  apply(readTheme());
}

/** Shows the page in this colour scheme from now on, and keeps the choice in the browser. */
export function chooseTheme(next: ThemeChoice): void {
  choice = next;
  apply(next);
  try {
    if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // without storage the choice lasts until the page is closed
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets what this page holds, so that the next read comes from the browser's storage. For tests. */
export function resetThemeState(): void {
  choice = null;
  document.documentElement.removeAttribute("data-theme");
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readTheme);
}
