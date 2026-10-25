// Marking read the rows a list was scrolled past. The web app and the Android app measure where the top of
// the list is in their own way; which rows went past, and how they reach the server, is the same here.
import { MAX_MARK_SEEN, type SeenArticle } from "@smarternews/core/api";

/** The key the setting is stored under, in the browser and on the device. Off is stored as no value at all. */
export const SCROLL_READ_STORAGE_KEY = "smarternews.scrollRead";

/** The value stored while the setting is on. */
export const SCROLL_READ_ON = "on";

/** Whether a stored value stands for on. Nothing, or anything this version does not know, is off. */
export function parseScrollRead(stored: string | null): boolean {
  return stored === SCROLL_READ_ON;
}

/** The ids of the rows that were at or below the top of the list when it was last looked at. */
export type BelowTop = ReadonlySet<number>;

/**
 * The rows that went past the top since the last look: they were at or below the top then, and are wholly
 * above it now. `firstBelow` is the index of the first row that is not wholly above the top. A row the last
 * look did not see, such as one a refresh put at the head of the list, is not passed however high it is.
 * Rows that are read already and the excluded ones are left out. Pass `null` as `below` for the first look.
 */
export function passedRows<T extends { id: number; isRead: boolean }>(
  below: BelowTop | null,
  rows: readonly T[],
  firstBelow: number,
  excluded: ReadonlySet<number> = new Set(),
): { passed: T[]; below: BelowTop } {
  const cut = Math.max(0, Math.min(firstBelow, rows.length));
  const passed = below === null ? [] : rows.slice(0, cut).filter((row) => below.has(row.id) && !row.isRead && !excluded.has(row.id));
  return { passed, below: new Set(rows.slice(cut).map((row) => row.id)) };
}

/** How long the queue waits for more rows before it sends. */
export const READ_QUEUE_DELAY_MS = 1000;

/** How many rows make the queue send without waiting. */
export const READ_QUEUE_BATCH = 100;

export interface ReadQueueTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: ReadQueueTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ReadQueueOptions<R> {
  send: (articles: SeenArticle[], options: { keepalive?: boolean }) => Promise<R>;
  /** After the server took a request. */
  onSent?: (articles: SeenArticle[], result: R) => void;
  /** After a request failed: the rows it held, to show unread again and to offer to send them again. */
  onFailed: (articles: SeenArticle[], error: unknown) => void;
  timers?: ReadQueueTimers;
}

export interface ReadQueue {
  /** Rows that went past the top. They go one second after the last of them, or at once at a hundred. */
  add(articles: SeenArticle[]): void;
  /** Sends what is waiting now, as when the list is left. `keepalive` for a page that is going away. */
  flush(options?: { keepalive?: boolean }): void;
  /** Sends rows that failed once more, at once. */
  retry(articles: SeenArticle[]): void;
  /** Takes waiting rows out, as when the user puts one back to unread before it was sent. */
  drop(ids: readonly number[]): void;
}

/** Gathers the rows that went past the top and sends them together, so that a fast scroll is a few requests. */
export function createReadQueue<R>(options: ReadQueueOptions<R>): ReadQueue {
  const timers = options.timers ?? realTimers;
  let pending = new Map<number, SeenArticle>();
  let timer: unknown = null;

  function stopTimer() {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  function send(articles: SeenArticle[], sendOptions: { keepalive?: boolean }) {
    for (let start = 0; start < articles.length; start += MAX_MARK_SEEN) {
      const chunk = articles.slice(start, start + MAX_MARK_SEEN);
      options.send(chunk, sendOptions).then(
        (result) => options.onSent?.(chunk, result),
        (error: unknown) => options.onFailed(chunk, error),
      );
    }
  }

  function flush(sendOptions: { keepalive?: boolean } = {}) {
    stopTimer();
    if (pending.size === 0) return;
    const articles = [...pending.values()];
    pending = new Map();
    send(articles, sendOptions);
  }

  return {
    add(articles) {
      if (articles.length === 0) return;
      for (const article of articles) pending.set(article.id, article);
      if (pending.size >= READ_QUEUE_BATCH) {
        flush();
        return;
      }
      stopTimer();
      timer = timers.set(() => {
        timer = null;
        flush();
      }, READ_QUEUE_DELAY_MS);
    },
    flush,
    retry(articles) {
      if (articles.length > 0) send(articles, {});
    },
    drop(ids) {
      for (const id of ids) pending.delete(id);
      if (pending.size === 0) stopTimer();
    },
  };
}
