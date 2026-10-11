import { describe, expect, it } from "vitest";
import { createTestDb } from "../testing/db.ts";
import { reserveTranslationChars, translationCharsOf, translationMonth } from "./translations.ts";

describe("the characters sent to the translation API", () => {
  it("are added up for the month before anything is sent", () => {
    const db = createTestDb();
    expect(translationCharsOf(db, "2026-03")).toBe(0);
    expect(reserveTranslationChars(db, "2026-03", 400, 1000)).toBe(true);
    expect(reserveTranslationChars(db, "2026-03", 500, 1000)).toBe(true);
    expect(translationCharsOf(db, "2026-03")).toBe(900);
  });

  it("refuse a request that would pass the limit of the month, and count nothing for it", () => {
    const db = createTestDb();
    reserveTranslationChars(db, "2026-03", 900, 1000);
    expect(reserveTranslationChars(db, "2026-03", 300, 1000)).toBe(false);
    expect(translationCharsOf(db, "2026-03")).toBe(900);
    expect(reserveTranslationChars(db, "2026-03", 100, 1000)).toBe(true);
  });

  it("start from nothing in a new month", () => {
    const db = createTestDb();
    reserveTranslationChars(db, "2026-03", 1000, 1000);
    expect(reserveTranslationChars(db, "2026-04", 300, 1000)).toBe(true);
    expect(translationCharsOf(db, "2026-04")).toBe(300);
    expect(translationCharsOf(db, "2026-03")).toBe(1000);
  });

  it("belong to the month the configured time zone shows", () => {
    const instant = new Date("2026-03-31T16:00:00.000Z");
    expect(translationMonth(instant, "UTC")).toBe("2026-03");
    expect(translationMonth(instant, "Asia/Tokyo")).toBe("2026-04");
    expect(translationMonth(new Date("2026-03-01T02:00:00.000Z"), "America/New_York")).toBe("2026-02");
  });
});
