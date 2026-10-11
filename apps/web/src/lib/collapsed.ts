import { useSyncExternalStore } from "react";

const KEY = "smarternews.nav.collapsed";

function read(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

// One state for the page: the navigation folds groups, and the reader opens the one it moves into.
let keys: string[] | null = null;
const listeners = new Set<() => void>();

function current(): string[] {
  keys ??= read();
  return keys;
}

function store(next: string[]): void {
  keys = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // without storage the choice lasts until the page is closed
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toggle(key: string): void {
  const now = current();
  store(now.includes(key) ? now.filter((entry) => entry !== key) : [...now, key]);
}

/** Opens a group if it is folded. */
export function unfold(key: string): void {
  if (current().includes(key)) toggle(key);
}

/** Forgets what this page holds, so that the next read comes from the browser's storage. For tests. */
export function resetCollapsedState(): void {
  keys = null;
}

/** Which groups of the navigation are folded. Kept in the browser, so it survives a reload. */
export function useCollapsed(): { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } {
  const folded = useSyncExternalStore(subscribe, current);
  return { isCollapsed: (key) => folded.includes(key), toggle };
}
