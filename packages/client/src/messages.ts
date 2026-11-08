import { ApiError, type FieldProblem } from "./api.ts";
import { feedErrorLabel } from "./labels.ts";

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

/** The refused field of a 400 answer at `path`, or at an entry under it. */
function problemAt(error: unknown, path: string): FieldProblem | null {
  if (!(error instanceof ApiError)) return null;
  return error.fields.find((field) => field.path === path || field.path.startsWith(`${path}.`)) ?? null;
}

/**
 * The server's own words for the refusal of one field, in English. For a screen, use `fieldMessage`; this is
 * for telling whether a field was refused at all.
 */
export function fieldError(error: unknown, path: string): string | null {
  return problemAt(error, path)?.message ?? null;
}

/** How a screen names a field, and what it knows of the field's values. */
export interface FieldWording {
  /** The name of the field, as the screen shows it. */
  label: string;
  /** The bounds of a number field. The server names only the bound that was broken; with both, the range is said. */
  min?: number;
  max?: number;
  /** A sentence added after the reason for a value in the wrong form, such as how a time is written. */
  formatHint?: string;
}

const wordingOf = (wording: FieldWording | string): FieldWording => (typeof wording === "string" ? { label: wording } : wording);

/** The entry of a list by its place: 1つ目, 2つ目 and so on. */
const placeOf = (place: number) => (place < 10 ? `${place}つ目` : `${place}番目`);

function numberRange(subject: string, min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && max !== undefined) return `${subject}は${min}から${max}までの数にしてください。`;
  if (max !== undefined) return `${subject}は${max}以下の数にしてください。`;
  if (min !== undefined) return `${subject}は${min}以上の数にしてください。`;
  return null;
}

/**
 * One refusal in the app's words. `place` is the place of the entry of a list, from 1, when the refusal is of one
 * entry. A refusal without a kind, or of a kind the app does not know, is said as a value that cannot be saved.
 */
export function describeProblem(
  problem: Partial<Pick<FieldProblem, "message">> & Pick<FieldProblem, "code" | "minimum" | "maximum" | "unit">,
  wording: FieldWording | string,
  place: number | null = null,
): string {
  const { label, min, max, formatHint } = wordingOf(wording);
  const subject = place === null ? label : `${label}の${placeOf(place)}`;
  const unsaved = place === null ? `「${label}」の値は保存できません。` : `「${label}」の${placeOf(place)}の値は保存できません。`;
  const isNumber = problem.unit === "number" || (problem.unit === undefined && (min !== undefined || max !== undefined));
  switch (problem.code) {
    case "required":
      return `${subject}を入れてください。`;
    case "too_small": {
      const minimum = problem.minimum ?? min;
      if (problem.unit === "chars") return minimum === undefined || minimum <= 1 ? `${subject}を入れてください。` : `${subject}は${minimum}文字以上にしてください。`;
      if (problem.unit === "items") return minimum === undefined || minimum <= 1 ? `${subject}を1つ以上入れてください。` : `${subject}は${minimum}個以上にしてください。`;
      return (isNumber ? numberRange(subject, minimum, max) : null) ?? unsaved;
    }
    case "too_big": {
      const maximum = problem.maximum ?? max;
      if (problem.unit === "chars") return maximum === undefined ? `${subject}が長すぎます。` : `${subject}は${maximum}文字以内にしてください。`;
      if (problem.unit === "items") return maximum === undefined ? `${subject}が多すぎます。` : `${subject}は${maximum}個までにしてください。`;
      return (isNumber ? numberRange(subject, min, maximum) : null) ?? unsaved;
    }
    case "format":
      // A number field refuses only numbers that are not whole: the range says what it takes.
      if (min !== undefined || max !== undefined) return numberRange(subject, min, max) ?? unsaved;
      return `${subject}の形が正しくありません。${formatHint ?? ""}`;
    case "invalid_value":
      return `${subject}は、選べる値の中から選んでください。`;
    case "unknown_time_zone":
      return `${subject}は、Asia/Tokyo のような IANA のタイムゾーン名にしてください。`;
    case "no_such_item":
      return `${subject}に選んだものが見つかりません。削除された可能性があります。`;
    case "not_allowed":
      return `${subject}に、この値は選べません。`;
    case "unreachable": {
      // The kinds of failure a fetch meets are known: one of them is said, and anything else is left out.
      const known = problem.message === undefined ? null : feedErrorLabel(problem.message);
      return known !== null && known !== problem.message
        ? `このURLを取得できませんでした。${known}。URLを確かめてください。`
        : "このURLを取得できませんでした。URLを確かめてください。";
    }
    case "no_items":
      return "このセレクターではページから記事を抜き出せませんでした。見本を確かめてください。";
    default:
      return unsaved;
  }
}

/**
 * Why the server refused one field of a form, in the app's words, or null when it did not. A refusal of one entry
 * of a list, such as `schedule.1`, is said of the field with the entry's place.
 */
export function fieldMessage(error: unknown, path: string, wording: FieldWording | string): string | null {
  const problem = problemAt(error, path);
  if (problem === null) return null;
  const entry = /^(\d+)(\.|$)/.exec(problem.path.slice(path.length + 1));
  return describeProblem(problem, wording, entry ? Number(entry[1]) + 1 : null);
}

/**
 * One problem of a settings file that was not read: where it is in the file, as the keys of the file name it,
 * and why, in the app's words. The reason calls the field by its key, the name the user finds in the file.
 */
export function settingsFileProblem(problem: FieldProblem): string {
  const keys = problem.path.split(".");
  const last = keys.at(-1) ?? "";
  const isPlace = /^\d+$/.test(last) && keys.length > 1;
  const label = isPlace ? keys.at(-2)! : last;
  return `${problem.path}: ${describeProblem(problem, label, isPlace ? Number(last) + 1 : null)}`;
}

// ---- checks before sending ---------------------------------------------------------------------
// A screen checks what it can before it sends, in the same words as a refusal of the server.

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** A whole number from `min` to `max`. */
export function checkWholeNumber(text: string, wording: FieldWording & { min: number; max: number }): Checked<number> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, message: describeProblem({ code: "required" }, wording) };
  const value = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || value < wording.min || value > wording.max) {
    return { ok: false, message: describeProblem({ code: "too_big", unit: "number" }, wording) };
  }
  return { ok: true, value };
}

/** The reason a field that must be filled in is empty, or null. Spaces alone count as empty. */
export function checkRequired(text: string, label: string): string | null {
  return text.trim().length === 0 ? describeProblem({ code: "required" }, label) : null;
}

/** The reason a text is empty or too long, or null. The length is counted without the spaces around the text. */
export function checkText(text: string, { label, max, required = true }: { label: string; max: number; required?: boolean }): string | null {
  if (required) {
    const empty = checkRequired(text, label);
    if (empty !== null) return empty;
  }
  return text.trim().length > max ? describeProblem({ code: "too_big", maximum: max, unit: "chars" }, label) : null;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Times of day written as `HH:MM`, apart by commas or spaces, `max` of them at most. Empty text is no time. */
export function checkTimes(text: string, wording: FieldWording & { max: number }): Checked<string[]> {
  const times = text.split(/[\s,、]+/).filter((time) => time.length > 0);
  const wrong = times.findIndex((time) => !TIME_OF_DAY.test(time));
  if (wrong >= 0) return { ok: false, message: describeProblem({ code: "format" }, { label: wording.label, formatHint: wording.formatHint }, wrong + 1) };
  if (times.length > wording.max) return { ok: false, message: describeProblem({ code: "too_big", maximum: wording.max, unit: "items" }, wording.label) };
  return { ok: true, value: times };
}

/** The entries of a text, one a line, without the empty lines. */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
