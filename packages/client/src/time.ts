// Dates are shown in the time zone of the server's settings, not the browser's: an event's time is its
// local time, and a schedule runs on the server's clock.

// Building a formatter is costly on a phone, and a list asks for several times per row: one per zone is kept.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("ja-JP", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function parts(date: Date, timeZone: string): Record<string, string> {
  const formatter = formatterFor(timeZone);
  const found = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  // Not every runtime pads the hour: Android's answers "9" where Node answers "09".
  return { ...found, hour: (found.hour ?? "").padStart(2, "0"), minute: (found.minute ?? "").padStart(2, "0") };
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
