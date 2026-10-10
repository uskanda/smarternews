import type { EventFields } from "../db/articles.ts";
import type { WriteOutput } from "../llm/tasks.ts";
import { endOfLocalDay, localParts, zonedToUtc } from "../time.ts";
import type { ReasonCode } from "./reasons.ts";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/;

/** Reads a date or date-time the writer gave. A value without an offset is wall-clock time in the zone. */
function parseEventTime(value: string | null, timeZone: string, endOfDay: boolean): Date | null {
  if (value === null) return null;
  const text = value.trim();
  if (DATE_ONLY.test(text)) {
    const start = zonedToUtc(text, "00:00", timeZone);
    return endOfDay ? endOfLocalDay(start, timeZone) : start;
  }
  const local = LOCAL_DATE_TIME.exec(text);
  if (local) return zonedToUtc(local[1]!, local[2]!, timeZone);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventKey(name: string, start: Date, timeZone: string): string {
  const normalized = name.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  return `${normalized}|${localParts(start, timeZone).date}`;
}

/**
 * Turns the event the writer described into stored fields, or names why the page is rejected. An event
 * without an end is taken to last until the end of its start day.
 */
export function resolveEvent(
  event: WriteOutput["event"],
  options: { now: Date; timeZone: string; windowDays: number },
): { ok: true; event: EventFields } | { ok: false; reason: ReasonCode } {
  const start = parseEventTime(event?.startsAt ?? null, options.timeZone, false);
  if (!event || !start) return { ok: false, reason: "event-no-date" };
  const givenEnd = parseEventTime(event.endsAt, options.timeZone, true);
  const end = givenEnd && givenEnd >= start ? givenEnd : endOfLocalDay(start, options.timeZone);
  const horizon = new Date(options.now.getTime() + options.windowDays * 86_400_000);
  if (end < options.now || start > horizon) return { ok: false, reason: "event-outside-window" };
  return {
    ok: true,
    event: {
      key: eventKey(event.name, start, options.timeZone),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      venue: event.venue?.trim() || null,
      fee: event.fee?.trim() || null,
      registration: event.registration,
    },
  };
}
