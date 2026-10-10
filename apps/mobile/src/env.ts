// What the app takes from the outside world. Tests replace it; the app itself never does.
import type { Fetch } from "@smarternews/client";

export interface Environment {
  /** Undefined means the platform's fetch. */
  fetchImpl?: Fetch;
  now: () => Date;
}

let current: Environment = { now: () => new Date() };

export function environment(): Environment {
  return current;
}

export function setEnvironment(next: Environment): void {
  current = next;
}
