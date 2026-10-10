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

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}
