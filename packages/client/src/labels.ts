import type { Run, TermColor } from "@smarternews/core/api";

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
