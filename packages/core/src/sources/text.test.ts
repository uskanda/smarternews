import { describe, expect, it } from "vitest";
import { decodeEntities, parseDate, plainText, plainTitle } from "./text.ts";

describe("parseDate", () => {
  it("reads the abbreviations of regions as their offsets", () => {
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 JST")).toEqual(new Date("2006-01-02T06:04:05Z"));
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 CET")).toEqual(new Date("2006-01-02T14:04:05Z"));
    expect(parseDate("Mon, 02 Jul 2006 15:04:05 BST")).toEqual(new Date("2006-07-02T14:04:05Z"));
    expect(parseDate("Mon, 02 Jul 2006 15:04:05 CEST")).toEqual(new Date("2006-07-02T13:04:05Z"));
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 KST")).toEqual(new Date("2006-01-02T06:04:05Z"));
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 AEDT")).toEqual(new Date("2006-01-02T04:04:05Z"));
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 NZDT")).toEqual(new Date("2006-01-02T02:04:05Z"));
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 msk")).toEqual(new Date("2006-01-02T12:04:05Z"));
  });

  it("keeps reading the zones it read before", () => {
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 GMT")).toEqual(new Date("2006-01-02T15:04:05Z"));
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 EST")).toEqual(new Date("2006-01-02T20:04:05Z"));
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 +0900")).toEqual(new Date("2006-01-02T06:04:05Z"));
    expect(parseDate("2026-03-01T05:00:00+09:00", "Asia/Tokyo")).toEqual(new Date("2026-02-28T20:00:00Z"));
    expect(parseDate("2026-03-01T05:00:00Z", "Asia/Tokyo")).toEqual(new Date("2026-03-01T05:00:00Z"));
  });

  it("does not read IST, which three regions use", () => {
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 IST")).toBeNull();
    expect(parseDate("Mon, 02 Jan 2006 15:04:05 IST", "Asia/Tokyo")).toBeNull();
  });

  it("reads a date without an offset in the time zone it is given", () => {
    expect(parseDate("2026-10-20T09:00:00", "Asia/Tokyo")).toEqual(new Date("2026-10-20T00:00:00Z"));
    expect(parseDate("2026-10-20T09:00:00", "UTC")).toEqual(new Date("2026-10-20T09:00:00Z"));
    expect(parseDate("2026-10-20 09:00", "Asia/Tokyo")).toEqual(new Date("2026-10-20T00:00:00Z"));
    expect(parseDate("2026-10-20", "Asia/Tokyo")).toEqual(new Date("2026-10-19T15:00:00Z"));
    expect(parseDate("Tue, 20 Oct 2026 09:00:00", "Asia/Tokyo")).toEqual(new Date("2026-10-20T00:00:00Z"));
    expect(parseDate("20 Oct 2026 9:00", "Europe/London")).toEqual(new Date("2026-10-20T08:00:00Z"));
  });

  it("gives null for what is no date", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("soon", "Asia/Tokyo")).toBeNull();
    expect(parseDate("2026-13-01T09:00:00", "Asia/Tokyo")).toBeNull();
    expect(parseDate(42)).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodes the named references of HTML", () => {
    expect(decodeEntities("A &mdash; B&hellip; &rsquo;quoted&lsquo; &copy; &nbsp;x")).toBe("A — B… ’quoted‘ ©  x");
  });

  it("tells upper from lower case in names", () => {
    expect(decodeEntities("&Eacute;t&eacute;")).toBe("Été");
  });

  it("decodes numeric references", () => {
    expect(decodeEntities("&#8212; &#x2014; &#X2014;")).toBe("— — —");
  });

  it("leaves unknown names and an ampersand without a reference as they are", () => {
    expect(decodeEntities("&unknown; AT&T R&D &amp")).toBe("&unknown; AT&T R&D &amp");
  });

  it("keeps a text without references as it is", () => {
    expect(decodeEntities("Plain <text> 100% \"quoted\"")).toBe("Plain <text> 100% \"quoted\"");
  });

  it("is what titles and snippets go through", () => {
    expect(plainTitle("Q3 results &mdash; up 5&percnt;")).toBe("Q3 results — up 5%");
    expect(plainText("<p>Wait&hellip;</p>")).toBe("Wait…");
  });
});
