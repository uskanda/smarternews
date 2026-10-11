// Which groups of the drawer are folded. Kept on the device, so it survives closing the app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const KEY = "smarternews.drawer.collapsed";

async function load(): Promise<string[]> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function useCollapsed(): { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void load().then((stored) => {
      if (alive) setKeys(stored);
    });
    return () => {
      alive = false;
    };
  }, []);
  const toggle = useCallback((key: string) => {
    setKeys((current) => {
      const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
      void AsyncStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { isCollapsed: (key) => keys.includes(key), toggle };
}
