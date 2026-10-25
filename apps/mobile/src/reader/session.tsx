import type { ArticleSummary } from "@smarternews/core/api";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface Kept {
  /** Which list the kept articles belong to. Another list starts empty. */
  key: string;
  items: ArticleSummary[];
}

interface ReaderSession {
  /** Articles read during this visit to a list. They stay in an unread list until the user refreshes it. */
  keptFor(key: string): ArticleSummary[];
  keep(key: string, item: ArticleSummary): void;
  patch(id: number, patch: Partial<ArticleSummary>): void;
  reset(key: string): void;
  /**
   * Articles the user put back to unread during this visit to a list: scrolling past them does not read them
   * again until the list is pulled or another list is opened.
   */
  excludedFor(key: string): ReadonlySet<number>;
  exclude(key: string, id: number): void;
  /** The list shown now. Opening another one ends the visit to the last, and what it excluded. */
  visit(key: string): void;
}

const SessionContext = createContext<ReaderSession | null>(null);
const NONE: ArticleSummary[] = [];
const NO_IDS: ReadonlySet<number> = new Set();

export function useReaderSession(): ReaderSession {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useReaderSession needs a ReaderSessionProvider above it");
  return value;
}

/** Shared by the list and the article screen, which are separate screens showing the same list. */
export function ReaderSessionProvider({ children }: { children: ReactNode }) {
  const [kept, setKept] = useState<Kept>({ key: "", items: [] });
  const keptFor = useCallback((key: string) => (kept.key === key ? kept.items : NONE), [kept]);
  const keep = useCallback((key: string, item: ArticleSummary) => {
    setKept((current) => ({ key, items: [...(current.key === key ? current.items : []).filter((entry) => entry.id !== item.id), item] }));
  }, []);
  const patch = useCallback((id: number, change: Partial<ArticleSummary>) => {
    setKept((current) => ({ key: current.key, items: current.items.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)) }));
  }, []);
  // Read only when the list is scrolled, so it needs no drawing of its own.
  const excluded = useRef<{ key: string; ids: Set<number> }>({ key: "", ids: new Set() });
  const excludedFor = useCallback((key: string) => (excluded.current.key === key ? excluded.current.ids : NO_IDS), []);
  const exclude = useCallback((key: string, id: number) => {
    if (excluded.current.key !== key) excluded.current = { key, ids: new Set() };
    excluded.current.ids.add(id);
  }, []);
  const visit = useCallback((key: string) => {
    if (excluded.current.key !== key) excluded.current = { key, ids: new Set() };
  }, []);
  const reset = useCallback((key: string) => {
    setKept({ key, items: [] });
    excluded.current = { key, ids: new Set() };
  }, []);
  const value = useMemo(() => ({ keptFor, keep, patch, reset, excludedFor, exclude, visit }), [keptFor, keep, patch, reset, excludedFor, exclude, visit]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
