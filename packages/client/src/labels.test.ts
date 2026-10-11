import { describe, expect, it } from "vitest";
import { feedErrorLabel } from "./labels.ts";

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
