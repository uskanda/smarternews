import type { ArticleSummary } from "@smarternews/core/api";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

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
}

const SessionContext = createContext<ReaderSession | null>(null);
const NONE: ArticleSummary[] = [];

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
  const reset = useCallback((key: string) => setKept({ key, items: [] }), []);
  const value = useMemo(() => ({ keptFor, keep, patch, reset }), [keptFor, keep, patch, reset]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
