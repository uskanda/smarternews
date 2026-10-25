import { useSyncExternalStore } from "react";
import { parseScrollRead, SCROLL_READ_ON, SCROLL_READ_STORAGE_KEY } from "@smarternews/client";

// Whether the article list marks read the rows scrolled past its top. Each browser keeps its own setting; the
// server holds none. A browser that cannot store it keeps the setting off.

function read(): boolean {
  try {
    return parseScrollRead(window.localStorage.getItem(SCROLL_READ_STORAGE_KEY));
  } catch {
    return false;
  }
}

let on: boolean | null = null;
const listeners = new Set<() => void>();

/** Whether the setting is on in this browser. */
export function readScrollRead(): boolean {
  on ??= read();
  return on;
}

/** Turns the setting on or off from now on, and keeps it in the browser. Without storage it stays off. */
export function chooseScrollRead(next: boolean): void {
  try {
    if (next) window.localStorage.setItem(SCROLL_READ_STORAGE_KEY, SCROLL_READ_ON);
    else window.localStorage.removeItem(SCROLL_READ_STORAGE_KEY);
    on = next;
  } catch {
    on = false;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets what this page holds, so that the next read comes from the browser's storage. For tests. */
export function resetScrollReadState(): void {
  on = null;
}

export function useScrollRead(): boolean {
  return useSyncExternalStore(subscribe, readScrollRead);
}
