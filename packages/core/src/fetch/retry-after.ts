/** The longest wait a Retry-After value is taken for: a later time is cut to this. */
export const MAX_RETRY_AFTER_MS = 86_400_000;

/**
 * The time a Retry-After value asks the next request to wait for, as a number of seconds or as an HTTP date,
 * one day after `now` at most. Null for no value, for one that cannot be read, and for a time not later than
 * `now`: the caller then waits as it would without the header.
 */
export function parseRetryAfter(value: string | null | undefined, now: Date): Date | null {
  const text = value?.trim() ?? "";
  if (text.length === 0) return null;
  let at: number;
  if (/^\d+$/.test(text)) at = now.getTime() + Number(text) * 1000;
  else if (/[a-z]/i.test(text)) at = Date.parse(text);
  else return null;
  if (!Number.isFinite(at) || at <= now.getTime()) return null;
  return new Date(Math.min(at, now.getTime() + MAX_RETRY_AFTER_MS));
}
