import type { Clock } from "../clock.ts";
import { listCategories } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import { hasRunForSlot } from "../db/runs.ts";
import { getSettings } from "../db/settings.ts";
import { addDays, localParts, zonedToUtc } from "../time.ts";
import type { RunQueue } from "./queue.ts";
import { purgeExpired } from "./retention.ts";

const HOUR = 3_600_000;
/** A scheduled time missed while the server was down is made up for when it lies this close in the past. */
const CATCH_UP_MS = 6 * HOUR;
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

  constructor(options: { db: Database; clock: Clock; queue: RunQueue }) {
    this.#db = options.db;
    this.#clock = options.clock;
    this.#queue = options.queue;
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
      // A time that passed before the category existed was never missed, so it is not made up for.
      if (due && due.at > new Date(category.createdAt) && !hasRunForSlot(this.#db, category.id, due.slot)) {
        this.#queue.enqueue(category.id, "schedule", due.slot);
      }
    }
    this.#lastCheck = now;
    if (now.getTime() - this.#lastPurge >= PURGE_INTERVAL_MS) {
      this.#lastPurge = now.getTime();
      purgeExpired(this.#db, this.#clock);
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
