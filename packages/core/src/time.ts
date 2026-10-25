// Wall-clock arithmetic in an IANA time zone, built on Intl so no time zone database is bundled.

export interface LocalParts {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
}

function parts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const p = parts(date, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Milliseconds to add to UTC to get the wall clock of the zone at that instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which the zone's wall clock shows the given date and time. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const wall = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`).getTime();
  // The offset at the guessed instant can differ from the offset at the real one across a DST change,
  // so apply it twice.
  const guess = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(guess), timeZone));
}

export function startOfLocalDay(date: Date, timeZone: string): Date {
  return zonedToUtc(localParts(date, timeZone).date, "00:00", timeZone);
}

export function endOfLocalDay(date: Date, timeZone: string): Date {
  return new Date(zonedToUtc(localParts(date, timeZone).date, "23:59:59", timeZone).getTime() + 999);
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export interface BudgetPeriod {
  /** Midnight UTC of the first day. */
  start: Date;
  /** Midnight UTC of the first day of the next period: the period ends just before it. */
  end: Date;
  /** YYYY-MM-DD */
  firstDay: string;
  /** YYYY-MM-DD */
  lastDay: string;
}

/** Midnight UTC of the reset day in the month, or of the month's last day when it has no such day. */
function resetIn(year: number, month: number, resetDay: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(resetDay, daysInMonth)));
}

/** The budget period that holds the instant: from a reset day at midnight UTC to the next one. */
export function budgetPeriod(now: Date, resetDay: number): BudgetPeriod {
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  if (now < resetIn(year, month, resetDay)) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const start = resetIn(year, month, resetDay);
  const end = resetIn(month === 11 ? year + 1 : year, (month + 1) % 12, resetDay);
  return {
    start,
    end,
    firstDay: start.toISOString().slice(0, 10),
    lastDay: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10),
  };
}
