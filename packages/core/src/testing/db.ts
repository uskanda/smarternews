import type { Clock } from "../clock.ts";
import { migrate, openDatabase, type Database } from "../db/database.ts";

export function createTestDb(): Database {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

/** A clock the test moves by hand. */
export function fakeClock(start: string): Clock & { set(iso: string): void; advance(ms: number): void } {
  let now = new Date(start).getTime();
  const clock = (() => new Date(now)) as Clock & { set(iso: string): void; advance(ms: number): void };
  clock.set = (iso) => {
    now = new Date(iso).getTime();
  };
  clock.advance = (ms) => {
    now += ms;
  };
  return clock;
}
