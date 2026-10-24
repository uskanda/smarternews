import { describe, expect, it } from "vitest";
import { fullContentErrorLabel } from "./full-content.ts";

describe("fullContentErrorLabel", () => {
  it("says why the full content could not be had, for every reason the server gives", () => {
    expect(fullContentErrorLabel({ reason: "no-url", detail: null })).toBe("記事に元のページのURLがありません。");
    expect(fullContentErrorLabel({ reason: "robots", detail: null })).toBe("サイトが取得を禁じています（robots.txt）。");
    expect(fullContentErrorLabel({ reason: "blocked", detail: "destination not allowed" })).toBe("取得先の制限に当たるため、取得していません。");
    expect(fullContentErrorLabel({ reason: "http", detail: "404" })).toBe("ページが見つかりませんでした（HTTP 404）。");
    expect(fullContentErrorLabel({ reason: "http", detail: "410" })).toBe("ページが見つかりませんでした（HTTP 410）。");
    expect(fullContentErrorLabel({ reason: "http", detail: "503" })).toBe("サイトがエラーを返しました（HTTP 503）。");
    expect(fullContentErrorLabel({ reason: "not-html", detail: "application/pdf" })).toBe("ページがHTMLではありません（application/pdf）。");
    expect(fullContentErrorLabel({ reason: "timeout", detail: "timed out" })).toBe("サイトが時間内に応答しませんでした。");
    expect(fullContentErrorLabel({ reason: "error", detail: "request failed" })).toBe("サイトに接続できませんでした。");
    expect(fullContentErrorLabel({ reason: "no-content", detail: null })).toBe("ページから本文を取り出せませんでした。");
    expect(fullContentErrorLabel({ reason: "shorter", detail: "100 < 800" })).toBe("取り出した本文が、配信された内容より短いため、使っていません。");
  });
});
