import { describe, expect, it } from "vitest";
import { conflictLabel, feedErrorLabel } from "./labels.ts";

describe("conflictLabel", () => {
  it("says what a refused change ran into", () => {
    expect(conflictLabel("already subscribed: https://example.org/feed.xml")).toBe("このフィードはすでに購読しています（https://example.org/feed.xml）。");
    expect(conflictLabel('the stop word "PR" is already registered')).toBe("この語はすでに登録しています。");
  });

  it("shows what the server said when it is something else", () => {
    expect(conflictLabel("run 4 of this category is already running")).toBe("ほかの内容とぶつかるため、実行できませんでした（run 4 of this category is already running）。");
  });
});

describe("feedErrorLabel", () => {
  it("says the kinds of failure the server records in the app's language", () => {
    expect(feedErrorLabel("HTTP status 503: https://example.org/feed.xml")).toBe("サイトがエラーを返しました（HTTP 503）");
    expect(feedErrorLabel("timed out after 15000 ms: https://example.org/feed.xml")).toBe("時間内に応答がありませんでした");
    expect(feedErrorLabel("the document is not a feed")).toBe("フィードとして読めない内容が返りました");
    expect(feedErrorLabel("destination not allowed: http://10.0.0.1/ (private address)")).toBe("取得先の制限に当たるため、取得していません");
    expect(feedErrorLabel("request failed: https://example.org/: getaddrinfo ENOTFOUND")).toBe("サイトに接続できませんでした");
  });

  it("shows a reason it does not know as it is", () => {
    expect(feedErrorLabel("something new")).toBe("something new");
  });
});
