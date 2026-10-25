// Whether the article list marks read the rows scrolled past its top. Kept on the device, so it survives
// closing the app, and apart from the server: the web app keeps its own. One state for the whole app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseScrollRead, SCROLL_READ_ON, SCROLL_READ_STORAGE_KEY } from "@smarternews/client";
import { useSyncExternalStore } from "react";

// Until the stored setting has been read, it is off.
let on = false;
let chosen = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  on = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the stored setting once. A choice the user makes in the meantime is not overwritten. */
export function loadScrollRead(): Promise<void> {
  loading ??= AsyncStorage.getItem(SCROLL_READ_STORAGE_KEY)
    .then((stored) => {
      if (!chosen) set(parseScrollRead(stored));
    })
    .catch(() => {
      // without the stored value the setting stays off
    });
  return loading;
}

/** Turns the setting on or off from now on, and keeps it on the device. Off is stored as no value at all. */
export async function chooseScrollRead(next: boolean): Promise<void> {
  chosen = true;
  set(next);
  if (next) await AsyncStorage.setItem(SCROLL_READ_STORAGE_KEY, SCROLL_READ_ON);
  else await AsyncStorage.removeItem(SCROLL_READ_STORAGE_KEY);
}

/** Forgets what the app holds, so that the next use reads the device's storage again. For tests. */
export function resetScrollReadState(): void {
  on = false;
  chosen = false;
  loading = null;
}

export function useScrollRead(): boolean {
  return useSyncExternalStore(subscribe, () => on);
}
