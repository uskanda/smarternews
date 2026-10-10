import type { Settings, SettingsUpdate } from "../api.ts";
import { DomainError } from "../errors.ts";
import type { Database } from "./database.ts";
import { str } from "./rows.ts";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function systemTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Reads the settings, creating the row with defaults on first use. */
export function getSettings(db: Database, defaultTimeZone: string = systemTimeZone()): Settings {
  db.prepare(
    `INSERT OR IGNORE INTO settings (id, reader_info, output_language, time_zone, search_language, search_region)
     VALUES (1, '', 'ja', ?, 'ja', 'JP')`,
  ).run(defaultTimeZone);
  const row = db.prepare("SELECT * FROM settings WHERE id = 1").get()!;
  return {
    readerInfo: str(row.reader_info),
    outputLanguage: str(row.output_language),
    timeZone: str(row.time_zone),
    search: { language: str(row.search_language), region: str(row.search_region) },
  };
}

export function updateSettings(db: Database, patch: SettingsUpdate): Settings {
  if (patch.timeZone !== undefined && !isValidTimeZone(patch.timeZone)) {
    throw new DomainError("invalid", "unknown time zone", [
      { path: "timeZone", message: `"${patch.timeZone}" is not an IANA time zone name` },
    ]);
  }
  const next = { ...getSettings(db), ...patch };
  db.prepare(
    `UPDATE settings SET reader_info = ?, output_language = ?, time_zone = ?, search_language = ?, search_region = ?
     WHERE id = 1`,
  ).run(next.readerInfo, next.outputLanguage, next.timeZone, next.search.language, next.search.region);
  return next;
}
