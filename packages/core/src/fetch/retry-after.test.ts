import { describe, expect, it } from "vitest";
import { MAX_RETRY_AFTER_MS, parseRetryAfter } from "./retry-after.ts";

const NOW = new Date("2026-03-01T12:00:00.000Z");

describe("parseRetryAfter", () => {
  it("reads a number of seconds", () => {
    expect(parseRetryAfter("120", NOW)?.toISOString()).toBe("2026-03-01T12:02:00.000Z");
    expect(parseRetryAfter(" 3600 ", NOW)?.toISOString()).toBe("2026-03-01T13:00:00.000Z");
  });

  it("reads an HTTP date", () => {
    expect(parseRetryAfter("Sun, 01 Mar 2026 15:30:00 GMT", NOW)?.toISOString()).toBe("2026-03-01T15:30:00.000Z");
  });

  it("cuts a time later than one day from now to one day", () => {
    expect(MAX_RETRY_AFTER_MS).toBe(86_400_000);
    expect(parseRetryAfter("604800", NOW)?.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(parseRetryAfter("Fri, 01 May 2026 00:00:00 GMT", NOW)?.toISOString()).toBe("2026-03-02T12:00:00.000Z");
  });

  it("ignores a time that is not later than now", () => {
    expect(parseRetryAfter("Sun, 01 Mar 2026 11:00:00 GMT", NOW)).toBeNull();
    expect(parseRetryAfter("0", NOW)).toBeNull();
  });

  it("ignores what it cannot read, a negative number, and no value", () => {
    expect(parseRetryAfter("soon", NOW)).toBeNull();
    expect(parseRetryAfter("-60", NOW)).toBeNull();
    expect(parseRetryAfter("1.5", NOW)).toBeNull();
    expect(parseRetryAfter("", NOW)).toBeNull();
    expect(parseRetryAfter(undefined, NOW)).toBeNull();
    expect(parseRetryAfter(null, NOW)).toBeNull();
  });
});
