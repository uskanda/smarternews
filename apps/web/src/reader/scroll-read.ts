import type { ArticleSummary, SeenArticle } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createReadQueue, passedRows, type BelowTop, type ReadQueue } from "@smarternews/client";
import { useApp } from "../app/context.ts";

/**
 * The index of the first row that is not wholly above the top of the list. Rows are not virtualised, so they
 * are all there to measure; a binary search measures a few of them.
 */
export function firstRowBelow(container: HTMLElement, rows: ArrayLike<Element>): number {
  const top = container.getBoundingClientRect().top;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rows[middle]!.getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  return low;
}

export interface ScrollToReadOptions {
  /** Whether the list marks read what it is scrolled past now. */
  enabled: boolean;
  /** The element that scrolls, and the list whose items are the rows, in the order of `items`. */
  scrollRef: RefObject<HTMLElement | null>;
  rowsRef: RefObject<HTMLElement | null>;
  items: readonly ArticleSummary[];
  /** Changes when the list is read anew: another entry, or a refresh. What was put back to unread counts again. */
  resetKey: string;
  /** Shows the rows read, or unread again after a failure. */
  show: (rows: readonly number[], isRead: boolean) => void;
  /** After a request failed, with a way to send it again. */
  onFailed: (retry: () => void) => void;
}

/**
 * Marks read the unread rows that the list is scrolled past, while `enabled`. The rows look read at once and
 * go to the server together a moment later, or at once when the list is left or the page goes away.
 * Returns what puts a row out of reach until the list is read anew: one the user put back to unread.
 */
export function useScrollToRead(options: ScrollToReadOptions): { exclude: (id: number) => void } {
  const { api } = useApp();
  const client = useQueryClient();
  const latest = useRef(options);
  latest.current = options;

  const [queue] = useState<ReadQueue>(() =>
    createReadQueue({
      send: (articles: SeenArticle[], sendOptions) => api.markSeenRead(articles, sendOptions),
      onSent: () => {
        void client.invalidateQueries({ queryKey: ["counts"] });
        void client.invalidateQueries({ queryKey: ["articles", { recentlyRead: "true" }] });
      },
      onFailed: (articles) => {
        const ids = articles.map((article) => article.id);
        latest.current.show(ids, false);
        latest.current.onFailed(() => {
          latest.current.show(ids, true);
          queue.retry(articles);
        });
      },
    }),
  );

  const below = useRef<BelowTop | null>(null);
  const excluded = useRef(new Set<number>());

  // A list read anew starts without a last look, and with nothing put out of reach. What waits goes first.
  useLayoutEffect(() => {
    below.current = null;
    excluded.current = new Set();
    return () => queue.flush();
  }, [options.resetKey, queue]);

  /** Looks at where the rows are, and returns the ones that went past the top since the last look. */
  function look(): ArticleSummary[] {
    const { scrollRef, rowsRef, items } = latest.current;
    const container = scrollRef.current;
    const rows = rowsRef.current?.children;
    if (!container || !rows || rows.length !== items.length) return [];
    const result = passedRows(below.current, items, firstRowBelow(container, rows), excluded.current);
    below.current = result.below;
    return result.passed;
  }

  // Rows that come or go move the others without a scroll: that is a new last look, and passes nothing.
  useLayoutEffect(() => {
    if (!options.enabled) {
      below.current = null;
      return;
    }
    look();
  }, [options.enabled, options.items, options.resetKey]);

  useEffect(() => {
    const container = options.scrollRef.current;
    if (!options.enabled || !container) return;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const passed = look();
        if (passed.length === 0) return;
        latest.current.show(
          passed.map((row) => row.id),
          true,
        );
        queue.add(passed.map((row) => ({ id: row.id, updatedAt: row.updatedAt })));
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [options.enabled, options.scrollRef, queue]);

  // A page that goes away or out of sight sends what waits, and lets the request outlive it.
  useEffect(() => {
    const leave = () => queue.flush({ keepalive: true });
    const hide = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
      queue.flush();
    };
  }, [queue]);

  return {
    exclude: (id) => {
      excluded.current.add(id);
      queue.drop([id]);
    },
  };
}
