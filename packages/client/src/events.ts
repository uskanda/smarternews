import type { ArticleSummary } from "@smarternews/core/api";
import { dayKey, formatClock, formatDay } from "./time.ts";

export interface EventGroup {
  /** Shown as the group's heading and its accessible name. */
  label: string;
  date: string;
  weekday: string;
  events: ArticleSummary[];
}

/**
 * Groups events by the day they start, soonest first. Events that have started and not ended go into one
 * group on top.
 */
export function groupEvents(events: ArticleSummary[], timeZone: string, now: Date): EventGroup[] {
  const sorted = events
    .filter((item) => item.event !== null)
    .sort((a, b) => a.event!.startsAt.localeCompare(b.event!.startsAt) || a.id - b.id);
  const groups: EventGroup[] = [];
  const ongoing = sorted.filter((item) => new Date(item.event!.startsAt) <= now);
  if (ongoing.length > 0) groups.push({ label: "開催中", date: "開催中", weekday: "", events: ongoing });
  const byDay = new Map<string, EventGroup>();
  for (const item of sorted.filter((entry) => new Date(entry.event!.startsAt) > now)) {
    const key = dayKey(item.event!.startsAt, timeZone);
    let group = byDay.get(key);
    if (!group) {
      const { date, weekday } = formatDay(item.event!.startsAt, timeZone);
      group = { label: `${date} ${weekday}`, date, weekday, events: [] };
      byDay.set(key, group);
      groups.push(group);
    }
    group.events.push(item);
  }
  return groups;
}

/** When an event takes place, in words: a time range, a range across days, or the whole day. */
export function eventTime(event: NonNullable<ArticleSummary["event"]>, timeZone: string): string {
  const sameDay = dayKey(event.startsAt, timeZone) === dayKey(event.endsAt, timeZone);
  const start = formatClock(event.startsAt, timeZone);
  const end = formatClock(event.endsAt, timeZone);
  if (sameDay) return start === "00:00" && end === "23:59" ? "終日" : `${start} から ${end}`;
  const endDay = formatDay(event.endsAt, timeZone).date;
  return start === "00:00" && end === "23:59" ? `${endDay}まで` : `${start} から ${endDay} ${end}`;
}

export function registrationLabel(registration: NonNullable<ArticleSummary["event"]>["registration"]): string | null {
  if (registration === "required") return "要申込";
  if (registration === "not_required") return "申込不要";
  return null;
}
