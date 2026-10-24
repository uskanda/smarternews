import type { FullContentError } from "@smarternews/core/api";

const NOT_FOUND = new Set(["404", "410"]);

/** Why the full content of a feed article could not be had, in the app's language. */
export function fullContentErrorLabel(error: FullContentError): string {
  switch (error.reason) {
    case "no-url":
      return "記事に元のページのURLがありません。";
    case "robots":
      return "サイトが取得を禁じています（robots.txt）。";
    case "blocked":
      return "取得先の制限に当たるため、取得していません。";
    case "http":
      return NOT_FOUND.has(error.detail ?? "")
        ? `ページが見つかりませんでした（HTTP ${error.detail}）。`
        : `サイトがエラーを返しました（HTTP ${error.detail ?? "?"}）。`;
    case "not-html":
      return error.detail ? `ページがHTMLではありません（${error.detail}）。` : "ページがHTMLではありません。";
    case "timeout":
      return "サイトが時間内に応答しませんでした。";
    case "error":
      return "サイトに接続できませんでした。";
    case "no-content":
      return "ページから本文を取り出せませんでした。";
    case "shorter":
      return "取り出した本文が、配信された内容より短いため、使っていません。";
  }
}
