import { dueFeeds, getFeed } from "../db/feeds.ts";
import { fetchFeed, type FeedDeps, type FetchOutcome } from "./ingest.ts";

/**
 * Fetches the subscribed feeds that are due, one at a time. It has its own line, apart from the queue of
 * runs: a run can wait minutes for a model, and a feed must not wait behind it.
 */
export class FeedPoller {
  readonly #deps: FeedDeps;
  /** Everything this poller fetches goes through this chain, so no two fetches overlap. */
  #tail: Promise<void> = Promise.resolve();
  #roundPending = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(deps: FeedDeps) {
    this.#deps = deps;
  }

  /** Starts a round over the feeds that are due now, unless one is already waiting or under way. */
  tick(): void {
    if (this.#roundPending) return;
    this.#roundPending = true;
    this.#tail = this.#tail.then(async () => {
      try {
        await this.#round();
      } catch (error) {
        // Nothing may escape: a rejection would stop every fetch queued behind this round.
        console.error("feed poller:", error);
      } finally {
        this.#roundPending = false;
      }
    });
  }

  async #round(): Promise<void> {
    const { db, clock } = this.#deps;
    for (const feed of dueFeeds(db, clock())) {
      // `fetchFeed` records a failure on the feed and does not throw; the next feed is fetched either way.
      await fetchFeed(this.#deps, feed.id);
    }
  }

  /**
   * Runs a task that fetches a feed in this poller's line: behind whatever is being fetched now, and before
   * anything that comes later. A new subscription goes through here, so that it never overlaps another fetch.
   */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    // The line goes on whether the task succeeds or not.
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Fetches one feed without waiting for its interval, behind whatever is being fetched now. */
  async fetchNow(feedId: number): Promise<FetchOutcome> {
    getFeed(this.#deps.db, feedId);
    return this.exclusive(() => fetchFeed(this.#deps, feedId));
  }

  /** Resolves when everything queued so far has been fetched. */
  idle(): Promise<void> {
    return this.#tail;
  }

  /** Fetches what is due now, then looks again every `intervalMs`. */
  start(intervalMs = 30_000): void {
    this.tick();
    this.#timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    clearInterval(this.#timer);
  }
}
