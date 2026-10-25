import { describe, expect, it } from "vitest";
import { budgetPeriod, endOfLocalDay, localParts, startOfLocalDay, zonedToUtc } from "./time.ts";

describe("localParts", () => {
  it("gives the calendar date and wall-clock time in the zone", () => {
    expect(localParts(new Date("2026-03-01T20:05:00Z"), "Asia/Tokyo")).toEqual({ date: "2026-03-02", time: "05:05" });
    expect(localParts(new Date("2026-03-01T00:30:00Z"), "America/Los_Angeles")).toEqual({
      date: "2026-02-28",
      time: "16:30",
    });
  });
});

describe("zonedToUtc", () => {
  it("converts a wall-clock time in a zone without daylight saving", () => {
    expect(zonedToUtc("2026-03-02", "05:00", "Asia/Tokyo").toISOString()).toBe("2026-03-01T20:00:00.000Z");
  });

  it("uses the offset in force on that date in a zone with daylight saving", () => {
    expect(zonedToUtc("2026-01-15", "05:00", "America/Los_Angeles").toISOString()).toBe("2026-01-15T13:00:00.000Z");
    expect(zonedToUtc("2026-07-15", "05:00", "America/Los_Angeles").toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });
});

describe("startOfLocalDay and endOfLocalDay", () => {
  it("bound the local calendar day that contains the instant", () => {
    const instant = new Date("2026-03-01T20:05:00Z"); // 05:05 on March 2 in Tokyo
    expect(startOfLocalDay(instant, "Asia/Tokyo").toISOString()).toBe("2026-03-01T15:00:00.000Z");
    expect(endOfLocalDay(instant, "Asia/Tokyo").toISOString()).toBe("2026-03-02T14:59:59.999Z");
  });
});

describe("budgetPeriod", () => {
  const period = (now: string, resetDay: number) => {
    const { start, end, firstDay, lastDay } = budgetPeriod(new Date(now), resetDay);
    return { start: start.toISOString(), end: end.toISOString(), firstDay, lastDay };
  };

  it("runs from the reset day to the day before it a month later", () => {
    expect(period("2026-10-25T12:00:00Z", 10)).toEqual({
      start: "2026-10-10T00:00:00.000Z",
      end: "2026-11-10T00:00:00.000Z",
      firstDay: "2026-10-10",
      lastDay: "2026-11-09",
    });
  });

  it("starts at midnight UTC, so the evening before the reset day belongs to the period that ends", () => {
    expect(period("2026-11-09T23:00:00Z", 10)).toMatchObject({ firstDay: "2026-10-10", lastDay: "2026-11-09" });
    expect(period("2026-11-10T00:00:00Z", 10)).toMatchObject({ firstDay: "2026-11-10", lastDay: "2026-12-09" });
    expect(period("2026-10-05T00:00:00Z", 10)).toMatchObject({ firstDay: "2026-09-10", lastDay: "2026-10-09" });
  });

  it("starts on the last day of a month that has no such day", () => {
    expect(period("2027-02-15T00:00:00Z", 31)).toMatchObject({ firstDay: "2027-01-31", lastDay: "2027-02-27" });
    expect(period("2027-03-05T00:00:00Z", 31)).toMatchObject({ firstDay: "2027-02-28", lastDay: "2027-03-30" });
    expect(period("2027-03-31T00:00:00Z", 31)).toMatchObject({ firstDay: "2027-03-31", lastDay: "2027-04-29" });
  });

  it("is the calendar month with the reset on the 1st", () => {
    expect(period("2026-12-31T23:59:59Z", 1)).toMatchObject({ firstDay: "2026-12-01", lastDay: "2026-12-31" });
  });
});
