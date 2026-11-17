import { describe, expect, it } from "vitest";
import { REASON_CODES, reasonText } from "./reasons.ts";

describe("reasonText", () => {
  it("writes the program's reasons in Japanese for a Japanese output language, and in English otherwise", () => {
    expect(reasonText("below-minimum", "ja")).toBe("重要度が基準未満");
    expect(reasonText("over-limit", "ja-JP")).toBe("件数上限");
    expect(reasonText("no-date", "en")).toBe("publication time unknown");
    expect(reasonText("event-no-date", "fr")).toBe("event date could not be confirmed");
    expect(reasonText("blocked-site", "ja")).toBe("除外したサイト");
    expect(reasonText("blocked-site", "en")).toBe("site blocked in this category");
  });

  it("gives every kind a text of its own in each language", () => {
    for (const language of ["ja", "en"]) {
      const texts = REASON_CODES.map((code) => reasonText(code, language, "Same title"));
      expect(new Set(texts).size).toBe(REASON_CODES.length);
    }
  });

  it("names the article a follow-up was rejected for, in either language", () => {
    expect(reasonText("missed-follow-up", "ja", "新しい版の公開")).toBe("外れの印を付けた記事「新しい版の公開」の続報");
    expect(reasonText("stopped-follow-up", "ja", "新しい版の公開")).toBe("続報を止めた記事「新しい版の公開」の続報");
    expect(reasonText("missed-follow-up", "en", "A new release")).toBe('follow-up to "A new release", which was marked as a miss');
    expect(reasonText("stopped-follow-up", "en", "A new release")).toBe('follow-up to "A new release", whose follow-ups were stopped');
  });
});
