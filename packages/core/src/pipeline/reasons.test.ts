import { describe, expect, it } from "vitest";
import { programReasonCode, reasonText } from "./reasons.ts";

describe("programReasonCode", () => {
  it("knows the program's reasons in every language it writes them in", () => {
    expect(programReasonCode(reasonText("below-minimum", "ja"))).toBe("below-minimum");
    expect(programReasonCode(reasonText("over-limit", "en"))).toBe("over-limit");
    expect(programReasonCode("公開日時が不明")).toBe("no-date");
    expect(programReasonCode("event date could not be confirmed")).toBe("event-no-date");
    expect(programReasonCode("開催日が対象期間の外")).toBe("event-outside-window");
  });

  it("leaves the judge's reasons alone", () => {
    expect(programReasonCode("広告のため除外")).toBeNull();
    expect(programReasonCode("")).toBeNull();
  });
});
