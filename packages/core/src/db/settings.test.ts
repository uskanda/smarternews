import { describe, expect, it } from "vitest";
import { createTestDb } from "../testing/db.ts";
import { getSettings, updateSettings } from "./settings.ts";

describe("getSettings", () => {
  it("starts with Japanese output, the server time zone and a Japanese news search", () => {
    const db = createTestDb();
    expect(getSettings(db, "Europe/Berlin")).toEqual({
      readerInfo: "",
      outputLanguage: "ja",
      timeZone: "Europe/Berlin",
      search: { language: "ja", region: "JP" },
    });
  });
});

describe("updateSettings", () => {
  it("stores the reader information for later reads", () => {
    const db = createTestDb();
    updateSettings(db, { readerInfo: "Maintains web services." });
    expect(getSettings(db).readerInfo).toBe("Maintains web services.");
  });

  it("refuses an unknown time zone and keeps what was stored", () => {
    const db = createTestDb();
    updateSettings(db, { timeZone: "Asia/Tokyo" });
    expect(() => updateSettings(db, { timeZone: "Mars/Olympus", readerInfo: "x" })).toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
    expect(getSettings(db)).toMatchObject({ timeZone: "Asia/Tokyo", readerInfo: "" });
  });
});
