import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../testing/db.ts";
import { migrate, openDatabase } from "./database.ts";
import { getSettings, updateSettings } from "./settings.ts";

describe("getSettings", () => {
  it("starts with Japanese output, the server time zone and a Japanese news search", () => {
    const db = createTestDb();
    expect(getSettings(db, "Europe/Berlin")).toEqual({
      readerInfo: "",
      outputLanguage: "ja",
      timeZone: "Europe/Berlin",
      search: { language: "ja", region: "JP" },
      feedIntervalMinutes: 30,
      advanceAfterMarkAll: true,
      removeDuplicates: true,
    });
  });
});

describe("duplicate removal", () => {
  it("is on at first, and stays off across a restart once switched off", () => {
    const dir = mkdtempSync(join(tmpdir(), "sn-settings-"));
    const file = join(dir, "db.sqlite");
    const first = openDatabase(file);
    migrate(first);
    expect(getSettings(first).removeDuplicates).toBe(true);
    updateSettings(first, { removeDuplicates: false });
    first.close();

    const again = openDatabase(file);
    migrate(again);
    expect(getSettings(again).removeDuplicates).toBe(false);
    again.close();
  });

  it("is on for a server updated from a version without it", () => {
    const shipped = join(import.meta.dirname, "migrations");
    const dir = mkdtempSync(join(tmpdir(), "sn-settings-"));
    for (const name of readdirSync(shipped).filter((name) => name < "010")) copyFileSync(join(shipped, name), join(dir, name));
    const db = openDatabase(":memory:");
    migrate(db, dir);
    db.prepare("INSERT INTO settings (id, reader_info, output_language, time_zone, search_language, search_region) VALUES (1, 'before', 'ja', 'UTC', 'ja', 'JP')").run();
    migrate(db);
    expect(getSettings(db)).toMatchObject({ readerInfo: "before", removeDuplicates: true });
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
