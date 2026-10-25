import type { Clock } from "../clock.ts";
import { findCategory, listCategories } from "../db/categories.ts";
import { transaction, type Database } from "../db/database.ts";
import { hasLaterScheduledRun, hasRunForSlot, listDueRetries, setRetry } from "../db/runs.ts";
import { getSettings } from "../db/settings.ts";
import { listTopics } from "../db/topics.ts";
import { addDays, localParts, zonedToUtc } from "../time.ts";
import type { RunQueue } from "./queue.ts";
import { purgeExpired } from "./retention.ts";

const HOUR = 3_600_000;
/** A scheduled time missed while the server was down is made up for when it lies this close in the past. */
export const CATCH_UP_MS = 6 * HOUR;
const PURGE_INTERVAL_MS = HOUR;

export interface DueSlot {
  /** The scheduled time as local date and time, for example 2026-03-02T05:00. One run exists per slot. */
  slot: string;
  at: Date;
}

/** The latest scheduled time that falls after `after` and not after `upTo`, in the given time zone. */
export function latestSlot(schedule: string[], timeZone: string, after: Date, upTo: Date): DueSlot | null {
  const today = localParts(upTo, timeZone).date;
  let latest: DueSlot | null = null;
  for (const date of [addDays(today, -1), today]) {
    for (const time of schedule) {
      const at = zonedToUtc(date, time, timeZone);
      if (at > after && at <= upTo && (!latest || at > latest.at)) latest = { slot: `${date}T${time}`, at };
    }
  }
  return latest;
}

export class Scheduler {
  readonly #db: Database;
  readonly #clock: Clock;
  readonly #queue: RunQueue;
  #lastCheck: Date | null = null;
  #lastPurge = 0;
  #timer: NodeJS.Timeout | undefined;
  readonly #purgeImages: () => void;
  readonly #log: (message: string, error: unknown) => void;

  /** `purgeImages` deletes the relayed images past their period; it runs with the purge of the database. */
  constructor(options: {
    db: Database;
    clock: Clock;
    queue: RunQueue;
    purgeImages?: () => void;
    log?: (message: string, error: unknown) => void;
  }) {
    this.#db = options.db;
    this.#clock = options.clock;
    this.#queue = options.queue;
    this.#purgeImages = options.purgeImages ?? (() => {});
    this.#log = options.log ?? ((message, error) => console.error(message, error));
  }

  /** Sets where checking starts. With `catchUp`, times missed in the last six hours count as still due. */
  begin(options: { catchUp: boolean }): void {
    const now = this.#clock();
    this.#lastCheck = options.catchUp ? new Date(now.getTime() - CATCH_UP_MS) : now;
  }

  /** Queues a run for every enabled category whose schedule came due since the last check. */
  tick(): void {
    const now = this.#clock();
    const since = this.#lastCheck ?? now;
    const { timeZone } = getSettings(this.#db);
    for (const category of listCategories(this.#db)) {
      if (!category.enabled) continue;
      const due = latestSlot(category.schedule, timeZone, since, now);
      // A category without an enabled topic has nothing to collect: it only holds subscribed feeds.
      if (due && !listTopics(this.#db, category.id).some((topic) => topic.enabled)) continue;
      // A time that passed before the category existed was never missed, so it is not made up for.
      if (due && due.at > new Date(category.createdAt) && !hasRunForSlot(this.#db, category.id, due.slot)) {
        this.#queue.enqueue(category.id, "schedule", due.slot);
      }
    }
    this.#lastCheck = now;
    // After the schedule, so that a scheduled run queued by this very check calls a retry off.
    this.#queueDueRetries(now);
    if (now.getTime() - this.#lastPurge >= PURGE_INTERVAL_MS) {
      this.#lastPurge = now.getTime();
      try {
        this.#purgeImages();
      } catch (error) {
        // The images are tried again in an hour; the database is purged all the same.
        this.#log("scheduler: purging relayed images failed:", error);
      }
      purgeExpired(this.#db, this.#clock);
    }
  }

  /** Queues the retries whose time has come, unless something has made them pointless since they were planned. */
  #queueDueRetries(now: Date): void {
    for (const run of listDueRetries(this.#db, now.toISOString())) {
      const original = run.retryOf ?? run.id;
      const category = findCategory(this.#db, run.categoryId);
      if (hasLaterScheduledRun(this.#db, run.categoryId, original)) {
        setRetry(this.#db, run.id, { skipped: "superseded" });
      } else if (!category?.enabled || !listTopics(this.#db, run.categoryId).some((topic) => topic.enabled)) {
        setRetry(this.#db, run.id, { skipped: "disabled" });
      } else {
        transaction(this.#db, () => {
          setRetry(this.#db, run.id, null);
          this.#queue.enqueue(run.categoryId, "schedule", null, { attempt: run.attempt + 1, of: original });
        });
      }
    }
  }

  /** Makes up for a recently missed time, then checks the schedule every `intervalMs`. */
  start(intervalMs = 30_000): void {
    this.begin({ catchUp: true });
    this.tick();
    this.#timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        // A failed check must not end the process; the next one runs in `intervalMs`.
        console.error("scheduler:", error);
      }
    }, intervalMs);
  }

  stop(): void {
    clearInterval(this.#timer);
  }
}
