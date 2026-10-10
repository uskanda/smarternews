import { describe, expect, it } from "vitest";
import { dayKey, formatClock, formatDay, formatFull, formatShort } from "./time.ts";

const now = new Date("2026-03-02T03:00:00Z"); // noon on March 2 in Tokyo

describe("time formatting in the configured zone", () => {
  it("shows a time in the zone of the settings, not the browser's", () => {
    expect(formatClock("2026-03-01T20:00:00Z", "Asia/Tokyo")).toBe("05:00");
    expect(formatFull("2026-03-01T20:00:00Z", "Asia/Tokyo")).toBe("2026年3月2日 05:00");
    expect(formatFull("2026-03-01T20:00:00Z", "UTC")).toBe("2026年3月1日 20:00");
  });

  it("shortens a time by how long ago it was in calendar days of the zone", () => {
    expect(formatShort("2026-03-01T20:00:00Z", "Asia/Tokyo", now)).toBe("05:00");
    expect(formatShort("2026-03-01T10:00:00Z", "Asia/Tokyo", now)).toBe("昨日");
    expect(formatShort("2026-02-20T10:00:00Z", "Asia/Tokyo", now)).toBe("2月20日");
  });

  it("names the day and the weekday", () => {
    expect(formatDay("2026-03-07T01:00:00Z", "Asia/Tokyo")).toEqual({ date: "3月7日", weekday: "土曜日" });
  });

  it("gives the same key to two instants of one calendar day in the zone", () => {
    expect(dayKey("2026-03-01T15:00:00Z", "Asia/Tokyo")).toBe(dayKey("2026-03-02T14:59:00Z", "Asia/Tokyo"));
    expect(dayKey("2026-03-01T14:59:00Z", "Asia/Tokyo")).not.toBe(dayKey("2026-03-01T15:00:00Z", "Asia/Tokyo"));
  });
});
