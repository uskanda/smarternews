import { useSyncExternalStore } from "react";
import { HIDE_READ_ON, HIDE_READ_STORAGE_KEY, parseHideRead } from "@smarternews/client";

// Whether the left pane hides the entries without unread articles. Each browser keeps its own setting; the
// server holds none. A browser that cannot store it keeps the setting off.

function read(): boolean {
  try {
    return parseHideRead(window.localStorage.getItem(HIDE_READ_STORAGE_KEY));
  } catch {
    return false;
  }
}

let on: boolean | null = null;
const listeners = new Set<() => void>();

/** Whether the setting is on in this browser. */
export function readHideRead(): boolean {
  on ??= read();
  return on;
}

/** Turns the setting on or off from now on, and keeps it in the browser. Without storage it stays off. */
export function chooseHideRead(next: boolean): void {
  try {
    if (next) window.localStorage.setItem(HIDE_READ_STORAGE_KEY, HIDE_READ_ON);
    else window.localStorage.removeItem(HIDE_READ_STORAGE_KEY);
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
export function resetHideReadState(): void {
  on = null;
}

export function useHideRead(): boolean {
  return useSyncExternalStore(subscribe, readHideRead);
}
