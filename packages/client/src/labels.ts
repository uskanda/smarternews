import type { BudgetStatus, Run, StopLimit, TermColor } from "@smarternews/core/api";

export const STATUS_LABEL: Record<Run["status"], string> = {
  queued: "待機中",
  running: "実行中",
  succeeded: "成功",
  partial: "一部失敗",
  failed: "失敗",
  stopped_by_limit: "上限で停止",
};

export const TRIGGER_LABEL: Record<Run["trigger"], string> = { schedule: "スケジュール", manual: "手動" };

/** Which retry a run is, for a run that is one. */
export function retryLabel(attempt: number): string {
  return `${attempt}回目のやり直し`;
}

/** Why a failed run is not retried. */
export const RETRY_SKIPPED_LABEL: Record<NonNullable<Run["retrySkipped"]>, string> = {
  limit: "やり直しの上限に達しました。次の実行は、次のスケジュールの時刻です。",
  superseded: "次のスケジュールの実行が先に始まったため、やり直しません。",
  disabled: "カテゴリが無効か、有効なトピックがないため、やり直しません。",
  manual: "手動の実行は、自動ではやり直しません。",
};

const STOP_LIMIT_LABEL: Record<StopLimit, string> = {
  run: "1回の実行のLLMの呼び出し回数が上限に達したため、途中で止まりました。",
  day: "その日のLLMの呼び出し回数が上限に達したため、途中で止まりました。",
  budget: "月の予算に達したため、途中で止まりました。",
};

/** Why a run stopped by limit stopped. Runs stopped before the server kept the allowance have none. */
export function stopLimitLabel(stoppedBy: StopLimit | null): string {
  return stoppedBy ? STOP_LIMIT_LABEL[stoppedBy] : "LLMの呼び出し回数が上限に達したため、途中で止まりました。";
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** US dollars to the cent: $12.34. */
export function formatUsd(amount: number): string {
  return USD.format(amount);
}

/** A day of a budget period, YYYY-MM-DD, as 11月9日. Periods are counted in UTC, so the date is shown as it is. */
export function periodDayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${month}月${date}日`;
}

/** The first day of the period after the one that ends on this day. */
export function nextPeriodStart(periodEnd: string): string {
  const next = new Date(`${periodEnd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** How much of the budget the period used, in whole percent, whether to warn, and whether the budget is used up. */
export function budgetShare(budget: Pick<BudgetStatus, "spentUsd" | "monthlyBudgetUsd" | "warnRatio">): {
  percent: number;
  warn: boolean;
  reached: boolean;
} {
  const { spentUsd, monthlyBudgetUsd, warnRatio } = budget;
  const reached = spentUsd >= monthlyBudgetUsd;
  return {
    percent: monthlyBudgetUsd > 0 ? Math.min(100, Math.floor((spentUsd / monthlyBudgetUsd) * 100 + 1e-9)) : 0,
    warn: reached || spentUsd >= monthlyBudgetUsd * warnRatio,
    reached,
  };
}

/** The warning the screens show once the period used the warning share of the budget, or null below it. */
export function budgetWarningLabel(budget: Pick<BudgetStatus, "spentUsd" | "monthlyBudgetUsd" | "warnRatio" | "periodEnd">): string | null {
  const share = budgetShare(budget);
  const amounts = `${formatUsd(budget.spentUsd)} / ${formatUsd(budget.monthlyBudgetUsd)}`;
  if (share.reached) {
    return `月の予算に達しました（${amounts}）。${periodDayLabel(nextPeriodStart(budget.periodEnd))}まで、金額のかかるプロバイダーを呼び出しません。`;
  }
  if (!share.warn) return null;
  return `月の予算の${share.percent}%を使いました（${amounts}）。期間は${periodDayLabel(budget.periodEnd)}までです。`;
}

const STAGE_LABEL: Record<string, string> = {
  interpret: "解釈",
  feed: "フィード",
  "news-search": "ニュース検索",
  "llm-search": "LLM検索",
  judge: "判定",
  cluster: "集約",
  write: "本文の生成",
  run: "実行全体",
};

/**
 * What a refused change ran into, in the app's language. The server says it in English; the kinds it
 * produces for feeds and filters are known, and anything else is shown as the server said it.
 */
export function conflictLabel(message: string): string {
  const subscribed = /already subscribed: (\S+)/.exec(message)?.[1];
  if (subscribed) return `このフィードはすでに購読しています（${subscribed}）。`;
  if (/the same filter is already registered/.test(message)) return "同じフィルターがすでにあります。";
  return `ほかの内容とぶつかるため、実行できませんでした（${message}）。`;
}

/**
 * Why a fetch of a subscribed feed failed, in the app's language. The server records the reason in English;
 * the kinds it produces are known, and anything else is shown as it is.
 */
export function feedErrorLabel(error: string): string {
  const status = /HTTP status (\d{3})/.exec(error)?.[1];
  if (status) return `サイトがエラーを返しました（HTTP ${status}）`;
  if (/timed out/.test(error)) return "時間内に応答がありませんでした";
  if (/not a feed/.test(error)) return "フィードとして読めない内容が返りました";
  if (/no element matches the item selector/.test(error)) return "ページに記事が見つかりませんでした。ページの作りが変わった可能性があります";
  if (/robots\.txt forbids/.test(error)) return "サイトのrobots.txtが取得を禁じています";
  if (/not a web page/.test(error)) return "Webページとして読めない内容が返りました";
  if (/destination not allowed/.test(error)) return "取得先の制限に当たるため、取得していません";
  if (/larger than/.test(error)) return "応答が大きすぎました";
  if (/redirect/.test(error)) return "転送が繰り返されました";
  if (/request failed/.test(error)) return "サイトに接続できませんでした";
  return error;
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** The colours of term groups, by the names the screens use. */
export const TERM_COLOR_LABEL: Record<TermColor, string> = { green: "緑", purple: "紫", pink: "桃色", orange: "橙色" };
