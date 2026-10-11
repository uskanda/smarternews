// Which groups of the drawer are folded. Kept on the device, so it survives closing the app. One state for
// the whole app: the drawer folds groups, and a list opens the one it moves into.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";

const KEY = "smarternews.drawer.collapsed";

async function load(): Promise<string[]> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

let keys: string[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: string[]): void {
  keys = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toggle(key: string): void {
  set(keys.includes(key) ? keys.filter((entry) => entry !== key) : [...keys, key]);
  void AsyncStorage.setItem(KEY, JSON.stringify(keys));
}

/** Opens a group if it is folded. */
export function unfold(key: string): void {
  if (keys.includes(key)) toggle(key);
}

/** Forgets what the app holds, so that the next use reads the device's storage again. For tests. */
export function resetCollapsedState(): void {
  keys = [];
  loading = null;
}

export function useCollapsed(): { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } {
  const folded = useSyncExternalStore(subscribe, () => keys);
  useEffect(() => {
    loading ??= load().then(set);
  }, []);
  return { isCollapsed: (key) => folded.includes(key), toggle };
}
