import { describe, expect, it } from "vitest";
import { ApiError } from "./api.ts";
import { checkRequired, checkText, checkTimes, checkWholeNumber, fieldMessage, settingsFileProblem } from "./messages.ts";

const refused = (...fields: ApiError["fields"]) => new ApiError("invalid", 400, "the input is invalid", fields);

describe("fieldMessage", () => {
  it("says the range of a number with both bounds, taking the other bound from the field", () => {
    const error = refused({ path: "maxArticlesPerRun", message: "Too big: expected number to be <=50", code: "too_big", maximum: 50, unit: "number" });
    expect(fieldMessage(error, "maxArticlesPerRun", { label: "件数上限", min: 1, max: 50 })).toBe("件数上限は1から50までの数にしてください。");
  });

  it("says the one bound it knows of a number", () => {
    const error = refused({ path: "maxArticlesPerRun", message: "Too big", code: "too_big", maximum: 50, unit: "number" });
    expect(fieldMessage(error, "maxArticlesPerRun", "件数上限")).toBe("件数上限は50以下の数にしてください。");
    const small = refused({ path: "intervalMinutes", message: "Too small", code: "too_small", minimum: 5, unit: "number" });
    expect(fieldMessage(small, "intervalMinutes", "取得周期")).toBe("取得周期は5以上の数にしてください。");
  });

  it("says the longest a text may be, and asks for an empty one", () => {
    expect(fieldMessage(refused({ path: "name", message: "Too big", code: "too_big", maximum: 100, unit: "chars" }), "name", "名前")).toBe(
      "名前は100文字以内にしてください。",
    );
    expect(fieldMessage(refused({ path: "name", message: "Too small", code: "too_small", minimum: 1, unit: "chars" }), "name", "名前")).toBe(
      "名前を入れてください。",
    );
    expect(fieldMessage(refused({ path: "name", message: "Required", code: "required" }), "name", "名前")).toBe("名前を入れてください。");
  });

  it("says how many entries a list holds", () => {
    expect(fieldMessage(refused({ path: "schedule", message: "Too big", code: "too_big", maximum: 24, unit: "items" }), "schedule", "実行時刻")).toBe(
      "実行時刻は24個までにしてください。",
    );
  });

  it("names the entry of a list by its place, and adds what the field says about its form", () => {
    const error = refused({ path: "schedule.1", message: "must be HH:MM", code: "format" });
    expect(fieldMessage(error, "schedule", { label: "実行時刻", formatHint: "05:00 のように24時間表記で書いてください。" })).toBe(
      "実行時刻の2つ目の形が正しくありません。05:00 のように24時間表記で書いてください。",
    );
  });

  it("words the refusals the server makes itself", () => {
    expect(fieldMessage(refused({ path: "timeZone", message: '"Mars" is not an IANA time zone name', code: "unknown_time_zone" }), "timeZone", "タイムゾーン")).toBe(
      "タイムゾーンは、Asia/Tokyo のような IANA のタイムゾーン名にしてください。",
    );
    expect(fieldMessage(refused({ path: "url", message: "the feed could not be fetched: something new", code: "unreachable" }), "url", "URL")).toBe(
      "このURLを取得できませんでした。URLを確かめてください。",
    );
  });

  it("says why a URL could not be fetched when it knows the kind of failure", () => {
    expect(fieldMessage(refused({ path: "url", message: "the feed could not be fetched: HTTP status 404: https://gone.example.org/", code: "unreachable" }), "url", "URL")).toBe(
      "このURLを取得できませんでした。サイトがエラーを返しました（HTTP 404）。URLを確かめてください。",
    );
  });

  it("says a value cannot be saved, without the server's English, for a refusal without a known kind", () => {
    expect(fieldMessage(refused({ path: "readerInfo", message: "Something odd" }), "readerInfo", "読み手情報")).toBe("「読み手情報」の値は保存できません。");
    expect(fieldMessage(refused({ path: "readerInfo", message: "Something odd", code: "from_the_future" }), "readerInfo", "読み手情報")).toBe(
      "「読み手情報」の値は保存できません。",
    );
  });

  it("has nothing to say about another field, or about an error that is not a refusal of the server", () => {
    expect(fieldMessage(refused({ path: "name", message: "Required", code: "required" }), "schedule", "実行時刻")).toBeNull();
    expect(fieldMessage(new Error("boom"), "name", "名前")).toBeNull();
    expect(fieldMessage(null, "name", "名前")).toBeNull();
  });
});

describe("settingsFileProblem", () => {
  it("words the reason with the key of the file as the name of the field, and keeps the place in the file as it is", () => {
    expect(settingsFileProblem({ path: "categories.0.name", message: "Too big", code: "too_big", maximum: 100, unit: "chars" })).toBe(
      "categories.0.name: nameは100文字以内にしてください。",
    );
    expect(settingsFileProblem({ path: "categories.0.schedule.1", message: "must be HH:MM", code: "format" })).toBe(
      "categories.0.schedule.1: scheduleの2つ目の形が正しくありません。",
    );
    expect(settingsFileProblem({ path: "settings.timeZone", message: "not an IANA time zone name", code: "unknown_time_zone" })).toBe(
      "settings.timeZone: timeZoneは、Asia/Tokyo のような IANA のタイムゾーン名にしてください。",
    );
    expect(settingsFileProblem({ path: "version", message: "Invalid input" })).toBe("version: 「version」の値は保存できません。");
  });
});

describe("the checks a screen makes before it sends", () => {
  it("takes a whole number in range, and words the others as the server's refusal is worded", () => {
    const range = { label: "件数上限", min: 1, max: 50 };
    expect(checkWholeNumber(" 12 ", range)).toEqual({ ok: true, value: 12 });
    expect(checkWholeNumber("51", range)).toEqual({ ok: false, message: "件数上限は1から50までの数にしてください。" });
    expect(checkWholeNumber("0", range)).toEqual({ ok: false, message: "件数上限は1から50までの数にしてください。" });
    expect(checkWholeNumber("1.5", range)).toEqual({ ok: false, message: "件数上限は1から50までの数にしてください。" });
    expect(checkWholeNumber("", range)).toEqual({ ok: false, message: "件数上限を入れてください。" });
  });

  it("asks for a text that is empty or only spaces, and for a shorter one", () => {
    expect(checkRequired(" 　", "名前")).toBe("名前を入れてください。");
    expect(checkRequired("Security", "名前")).toBeNull();
    expect(checkText("x".repeat(101), { label: "名前", max: 100 })).toBe("名前は100文字以内にしてください。");
    expect(checkText("", { label: "読み手情報", max: 4000, required: false })).toBeNull();
  });

  it("reads times of day apart, and names the one in the wrong form by its place", () => {
    const times = { label: "実行時刻", max: 24, formatHint: "05:00 のように24時間表記で書いてください。" };
    expect(checkTimes("05:00, 12:00、18:00", times)).toEqual({ ok: true, value: ["05:00", "12:00", "18:00"] });
    expect(checkTimes("", times)).toEqual({ ok: true, value: [] });
    expect(checkTimes("05:00, 5時", times)).toEqual({ ok: false, message: "実行時刻の2つ目の形が正しくありません。05:00 のように24時間表記で書いてください。" });
    expect(checkTimes(Array.from({ length: 25 }, () => "05:00").join(","), times)).toEqual({ ok: false, message: "実行時刻は24個までにしてください。" });
  });
});
