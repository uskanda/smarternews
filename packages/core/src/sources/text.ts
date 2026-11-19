import { decodeHTMLStrict } from "entities/decode";
import { zonedToUtc } from "../time.ts";

/**
 * Character references by the table of HTML: named ones, whose case counts, and numeric ones. Only a reference
 * that ends in a semicolon is decoded; an unknown name stays as it is.
 */
export function decodeEntities(text: string): string {
  return text.includes("&") ? decodeHTMLStrict(text) : text;
}

/** Markup reduced to one line of plain text, cut at `max` characters. */
export function plainText(markup: string, max = 500): string {
  const text = decodeEntities(markup.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const INLINE_TAGS = /<\/?(?:b|i|u|em|strong|span|font|a|br|code|sub|sup)(?:\s[^>]*)?\/?>/gi;

/** A headline as one line of text. Only inline HTML tags are removed: a headline may mention "<video>". */
export function plainTitle(text: string, max = 300): string {
  const title = decodeEntities(text.replace(INLINE_TAGS, " ")).replace(/\s+/g, " ").trim();
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

/**
 * The offsets of the abbreviations of regions that feeds write and `Date` does not read. IST is left out on
 * purpose: India, Ireland and Israel all use it. The zones of the United States, GMT and UT are read already.
 */
const ZONE_OFFSETS: Record<string, string> = {
  JST: "+0900",
  KST: "+0900",
  CET: "+0100",
  CEST: "+0200",
  BST: "+0100",
  WET: "+0000",
  WEST: "+0100",
  EET: "+0200",
  EEST: "+0300",
  MSK: "+0300",
  HKT: "+0800",
  SGT: "+0800",
  AEST: "+1000",
  AEDT: "+1100",
  NZST: "+1200",
  NZDT: "+1300",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** ISO 8601 without an offset: a day, or a day and a time. */
const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/;
/** RFC 822 without a zone, the day of the week optional. */
const LOCAL_RFC822 = /^(?:[a-z]{3},?\s+)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i;

const pad = (value: string | number) => String(value).padStart(2, "0");

/** A date written without an offset, read in `timeZone`; null when the text is not such a date. */
function localDate(text: string, timeZone: string): Date | null {
  let parts: [year: number, month: number, day: number, hour: number, minute: number, second: string] | null = null;
  const iso = LOCAL_ISO.exec(text);
  if (iso) {
    const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = ""] = iso;
    parts = [Number(year), Number(month), Number(day), Number(hour), Number(minute), `${pad(second)}${fraction}`];
  }
  const rfc = LOCAL_RFC822.exec(text);
  if (rfc) {
    const [, day, month, year, hour, minute, second = "0"] = rfc;
    const index = MONTHS.indexOf(month!.toLowerCase());
    if (index < 0) return null;
    parts = [Number(year), index + 1, Number(day), Number(hour), Number(minute), pad(second)];
  }
  if (parts === null) return null;
  const [year, month, day, hour, minute, second] = parts;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  if (hour > 23 || minute > 59 || Number(second) > 59) return null;
  const date = zonedToUtc(`${year}-${pad(month)}-${pad(day)}`, `${pad(hour)}:${pad(minute)}:${second}`, timeZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The time a date in a feed stands for, or null when it reads as none. An abbreviation of a region at the end
 * is read as its offset. With `timeZone`, a date without an offset is read in that zone; without it, `Date`
 * reads such a date in the zone of the process.
 */
export function parseDate(value: unknown, timeZone?: string): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const text = value.trim();
  if (timeZone !== undefined) {
    const local = localDate(text, timeZone);
    if (local !== null || LOCAL_ISO.test(text) || LOCAL_RFC822.test(text)) return local;
  }
  const zoned = text.replace(/\s([a-z]{3,4})$/i, (whole, name: string) => {
    const offset = ZONE_OFFSETS[name.toUpperCase()];
    return offset === undefined ? whole : ` ${offset}`;
  });
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? null : date;
}
