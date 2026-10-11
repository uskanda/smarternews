import { useCallback, useState } from "react";

const KEY = "smarternews.nav.collapsed";

function read(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Which groups of the navigation are folded. Kept in the browser, so it survives a reload. */
export function useCollapsed(): { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } {
  const [keys, setKeys] = useState<string[]>(read);
  const toggle = useCallback((key: string) => {
    setKeys((current) => {
      const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // without storage the choice lasts until the page is closed
      }
      return next;
    });
  }, []);
  return { isCollapsed: (key) => keys.includes(key), toggle };
}
