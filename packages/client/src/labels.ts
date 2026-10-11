import type { Run } from "@smarternews/core/api";

export const STATUS_LABEL: Record<Run["status"], string> = {
  queued: "待機中",
  running: "実行中",
  succeeded: "成功",
  partial: "一部失敗",
  failed: "失敗",
  stopped_by_limit: "上限で停止",
};

export const TRIGGER_LABEL: Record<Run["trigger"], string> = { schedule: "スケジュール", manual: "手動" };

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
 * produces for feeds and stop words are known, and anything else is shown as the server said it.
 */
export function conflictLabel(message: string): string {
  const subscribed = /already subscribed: (\S+)/.exec(message)?.[1];
  if (subscribed) return `このフィードはすでに購読しています（${subscribed}）。`;
  if (/stop word .* is already registered/.test(message)) return "この語はすでに登録しています。";
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
