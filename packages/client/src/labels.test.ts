import { describe, expect, it } from "vitest";
import { budgetShare, budgetWarningLabel, conflictLabel, feedErrorLabel, formatUsd, nextPeriodStart, periodDayLabel, stopLimitLabel } from "./labels.ts";

describe("conflictLabel", () => {
  it("says what a refused change ran into", () => {
    expect(conflictLabel("already subscribed: https://example.org/feed.xml")).toBe("このフィードはすでに購読しています（https://example.org/feed.xml）。");
    expect(conflictLabel("the same filter is already registered")).toBe("同じフィルターがすでにあります。");
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

describe("stopLimitLabel", () => {
  it("says which allowance stopped a run", () => {
    expect(stopLimitLabel("run")).toBe("1回の実行のLLMの呼び出し回数が上限に達したため、途中で止まりました。");
    expect(stopLimitLabel("day")).toBe("その日のLLMの呼び出し回数が上限に達したため、途中で止まりました。");
    expect(stopLimitLabel("budget")).toBe("月の予算に達したため、途中で止まりました。");
  });

  it("says what it said before for a run stopped before the server kept the allowance", () => {
    expect(stopLimitLabel(null)).toBe("LLMの呼び出し回数が上限に達したため、途中で止まりました。");
  });
});

describe("formatUsd", () => {
  it("writes US dollars to the cent", () => {
    expect(formatUsd(12.344)).toBe("$12.34");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("periodDayLabel and nextPeriodStart", () => {
  it("write a day of a budget period as a month and a day, and find the day the next period starts", () => {
    expect(periodDayLabel("2026-11-09")).toBe("11月9日");
    expect(nextPeriodStart("2026-11-09")).toBe("2026-11-10");
    expect(nextPeriodStart("2026-12-31")).toBe("2027-01-01");
  });
});

describe("budgetShare", () => {
  it("gives the share used in whole percent, and whether the screens warn", () => {
    const budget = { spentUsd: 85, monthlyBudgetUsd: 100, warnRatio: 0.8 };
    expect(budgetShare(budget)).toEqual({ percent: 85, warn: true, reached: false });
    expect(budgetShare({ ...budget, spentUsd: 50 })).toEqual({ percent: 50, warn: false, reached: false });
    expect(budgetShare({ ...budget, spentUsd: 100.04 })).toEqual({ percent: 100, warn: true, reached: true });
    expect(budgetShare({ ...budget, spentUsd: 80 })).toEqual({ percent: 80, warn: true, reached: false });
  });

  it("counts a budget of 0 as reached, as the server does when it refuses the calls", () => {
    expect(budgetShare({ spentUsd: 0, monthlyBudgetUsd: 0, warnRatio: 0.8 })).toEqual({ percent: 0, warn: true, reached: true });
  });
});

describe("budgetWarningLabel", () => {
  const budget = { spentUsd: 85, monthlyBudgetUsd: 100, warnRatio: 0.8, periodEnd: "2026-11-09" };

  it("says what share of the budget the period used once it passes the warning share", () => {
    expect(budgetWarningLabel(budget)).toBe("月の予算の85%を使いました（$85.00 / $100.00）。期間は11月9日までです。");
  });

  it("says that the providers that cost money are not called until the next period once the budget is reached", () => {
    expect(budgetWarningLabel({ ...budget, spentUsd: 100.04 })).toBe(
      "月の予算に達しました（$100.04 / $100.00）。11月10日まで、金額のかかるプロバイダーを呼び出しません。",
    );
  });

  it("says nothing below the warning share", () => {
    expect(budgetWarningLabel({ ...budget, spentUsd: 79.99 })).toBeNull();
  });
});
