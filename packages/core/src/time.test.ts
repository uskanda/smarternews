import { describe, expect, it } from "vitest";
import { endOfLocalDay, localParts, startOfLocalDay, zonedToUtc } from "./time.ts";

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
