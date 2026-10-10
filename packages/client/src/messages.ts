import { ApiError } from "./api.ts";

/** What to tell the user about a failed call, in words they can act on. */
export function messageFor(error: unknown, fallback = "表示できませんでした。読み込み直してください。"): string {
  if (error instanceof ApiError) {
    if (error.kind === "network") return "サーバーに接続できません。サーバーが動いているかと、ネットワークを確かめてください。";
    if (error.kind === "not_found") return "見つかりませんでした。削除された可能性があります。";
    if (error.kind === "invalid") return "入力に誤りがあります。";
    if (error.kind === "conflict") return "ほかの内容とぶつかるため、実行できませんでした。";
    if (error.kind === "unauthorized") return "トークンが無効です。";
    return "サーバーで問題が起きました。しばらくしてからもう一度試してください。";
  }
  return fallback;
}

/** The refusal reason for one field of a form, from a 400 answer. */
export function fieldError(error: unknown, path: string): string | null {
  if (!(error instanceof ApiError)) return null;
  return error.fields.find((field) => field.path === path || field.path.startsWith(`${path}.`))?.message ?? null;
}
