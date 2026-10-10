// Dates are shown in the time zone of the server's settings, not the browser's: an event's time is its
// local time, and a schedule runs on the server's clock.

function parts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/** YYYY-M-D in the zone, for comparing calendar days. */
export function dayKey(iso: string | Date, timeZone: string): string {
  const p = parts(new Date(iso), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function formatClock(iso: string, timeZone: string): string {
  const p = parts(new Date(iso), timeZone);
  return `${p.hour}:${p.minute}`;
}

export function formatDay(iso: string, timeZone: string): { date: string; weekday: string } {
  const p = parts(new Date(iso), timeZone);
  return { date: `${p.month}月${p.day}日`, weekday: p.weekday ?? "" };
}

/** Short form for a list row: the time today, "昨日" for yesterday, otherwise the date. */
export function formatShort(iso: string, timeZone: string, now: Date): string {
  const day = dayKey(iso, timeZone);
  if (day === dayKey(now, timeZone)) return formatClock(iso, timeZone);
  if (day === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) return "昨日";
  return formatDay(iso, timeZone).date;
}

export function formatFull(iso: string, timeZone: string): string {
  const p = parts(new Date(iso), timeZone);
  return `${p.year}年${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}
