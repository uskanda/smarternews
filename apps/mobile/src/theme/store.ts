// The colour scheme the user chose. Kept on the device, so it survives closing the app. One state for the
// whole app: the settings change it, and everything that is drawn reads it through `useTheme`.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_THEME_CHOICE, parseThemeChoice, THEME_STORAGE_KEY, type ThemeChoice } from "@smarternews/client";
import { useSyncExternalStore } from "react";

// Until the stored choice has been read, the app follows the device, as the splash screen before it does.
let choice: ThemeChoice = DEFAULT_THEME_CHOICE;
let chosen = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: ThemeChoice): void {
  choice = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the stored choice once. A choice the user makes in the meantime is not overwritten. */
export function loadThemeChoice(): Promise<void> {
  loading ??= AsyncStorage.getItem(THEME_STORAGE_KEY)
    .then((stored) => {
      if (!chosen) set(parseThemeChoice(stored));
    })
    .catch(() => {
      // without the stored value the app follows the device
    });
  return loading;
}

/** Draws the app in this colour scheme from now on, and keeps the choice on the device. */
export async function chooseTheme(next: ThemeChoice): Promise<void> {
  chosen = true;
  set(next);
  // Following the device is stored as no value at all.
  if (next === "system") await AsyncStorage.removeItem(THEME_STORAGE_KEY);
  else await AsyncStorage.setItem(THEME_STORAGE_KEY, next);
}

/** Forgets what the app holds, so that the next use reads the device's storage again. For tests. */
export function resetThemeState(): void {
  choice = DEFAULT_THEME_CHOICE;
  chosen = false;
  loading = null;
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice);
}
