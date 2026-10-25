import { createReadQueue, passedRows, type BelowTop, type ReadQueue } from "@smarternews/client";
import type { ArticleSummary, SeenArticle } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, type ViewToken } from "react-native";
import { useApp } from "../api/AppProvider";

/** Any part of a row on screen makes it seen: a row only goes past once its last pixel is above the top. */
export const SCROLL_READ_VIEWABILITY = { itemVisiblePercentThreshold: 0 } as const;

export interface ScrollToReadOptions {
  /** Whether the list marks read what it is scrolled past now. */
  enabled: boolean;
  items: readonly ArticleSummary[];
  /** The list shown: another one, or a pull, starts without a last look. */
  resetKey: string;
  /** What the user put back to unread in this visit to the list. */
  excluded: ReadonlySet<number>;
  /** Shows the rows read, or unread again after a failure. */
  show: (rows: readonly ArticleSummary[], isRead: boolean) => void;
  /** After a request failed, with a way to send it again. */
  onFailed: (retry: () => void) => void;
}

/**
 * Marks read the unread rows that a `FlatList` is scrolled past, while `enabled`. Rows are drawn only near the
 * screen, so where they are is not known: the first row partly on screen says, by its place in the list, that
 * every row before it is above the top. The rows look read at once and go to the server together a moment
 * later, or at once when the list is left or the app goes to the background.
 */
export function useScrollToRead(options: ScrollToReadOptions) {
  const { api } = useApp();
  const client = useQueryClient();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const [queue] = useState<ReadQueue>(() =>
    createReadQueue({
      send: (articles: SeenArticle[]) => api.markSeenRead(articles),
      onSent: () => {
        void client.invalidateQueries({ queryKey: ["counts"] });
        void client.invalidateQueries({ queryKey: ["articles", { recentlyRead: "true" }] });
      },
      onFailed: (articles) => {
        const ids = new Set(articles.map((article) => article.id));
        const rows = latest.current.items.filter((item) => ids.has(item.id));
        latest.current.show(rows, false);
        latest.current.onFailed(() => {
          latest.current.show(rows, true);
          queue.retry(articles);
        });
      },
    }),
  );

  const below = useRef<BelowTop | null>(null);
  /** The first row partly on screen at the last look, or null at the very end of the list. */
  const firstSeen = useRef<number | null>(null);
  // A list read anew starts without a last look; what waits from the last one goes first.
  useEffect(() => {
    below.current = null;
    return () => queue.flush();
  }, [options.resetKey, queue]);
  useEffect(() => {
    if (!options.enabled) below.current = null;
  }, [options.enabled]);
  // Rows that come, such as the next page, are below the first one on screen and seen from now on. A row
  // put in above it, such as a new article at the head, is not: it was never below the top.
  useEffect(() => {
    if (below.current === null) return;
    const at = firstSeen.current === null ? options.items.length : options.items.findIndex((item) => item.id === firstSeen.current);
    below.current = at === -1 ? null : passedRows(null, options.items, at).below;
  }, [options.items]);

  // The list stays below the article screen: what waits goes before the user can do anything there.
  useFocusEffect(useCallback(() => () => queue.flush(), [queue]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") queue.flush();
    });
    return () => {
      subscription.remove();
      queue.flush();
    };
  }, [queue]);

  // The list must be given the same function for as long as it lives: it reads the latest options.
  const [onViewableItemsChanged] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<ArticleSummary>[] }) => {
    const { enabled, items, excluded, show } = latest.current;
    if (!enabled) return;
    const indexes = viewableItems.map((token) => token.index).filter((index): index is number => index !== null);
    // Nothing on screen: the list is scrolled into the room below its last row.
    const firstBelow = indexes.length > 0 ? Math.min(...indexes) : items.length;
    const result = passedRows(below.current, items, firstBelow, excluded);
    below.current = result.below;
    firstSeen.current = items[firstBelow]?.id ?? null;
    if (result.passed.length === 0) return;
    show(result.passed, true);
    queue.add(result.passed.map((row) => ({ id: row.id, updatedAt: row.updatedAt })));
  });

  return {
    onViewableItemsChanged,
    /** Takes a row out of what waits, as when the user puts it back to unread before it went. */
    drop: (id: number) => queue.drop([id]),
  };
}
