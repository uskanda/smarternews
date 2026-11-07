import { describe, expect, it } from "vitest";
import { REASON_CODES, reasonText } from "./reasons.ts";

describe("reasonText", () => {
  it("writes the program's reasons in Japanese for a Japanese output language, and in English otherwise", () => {
    expect(reasonText("below-minimum", "ja")).toBe("重要度が基準未満");
    expect(reasonText("over-limit", "ja-JP")).toBe("件数上限");
    expect(reasonText("no-date", "en")).toBe("publication time unknown");
    expect(reasonText("event-no-date", "fr")).toBe("event date could not be confirmed");
  });

  it("gives every kind a text of its own in each language", () => {
    for (const language of ["ja", "en"]) {
      const texts = REASON_CODES.map((code) => reasonText(code, language));
      expect(new Set(texts).size).toBe(REASON_CODES.length);
    }
  });
});
