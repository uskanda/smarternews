// Reasons the program itself gives when it rejects a candidate. The judge's reasons come from the model.
// A rejected candidate keeps the kind of the program's reason as its reason code, beside the text; the judge's
// rejections have none. The migration that gave the code to earlier candidates matched the texts of the first five.
export const REASON_CODES = [
  "no-date",
  "below-minimum",
  "over-limit",
  "event-outside-window",
  "event-no-date",
  "missed-follow-up",
  "stopped-follow-up",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** The kinds for a follow-up to an article the reader marked: their texts name that article. */
export type MarkReasonCode = Extract<ReasonCode, "missed-follow-up" | "stopped-follow-up">;

const REASONS: Record<"ja" | "en", Record<ReasonCode, (title: string) => string>> = {
  ja: {
    "no-date": () => "公開日時が不明",
    "below-minimum": () => "重要度が基準未満",
    "over-limit": () => "件数上限",
    "event-outside-window": () => "開催日が対象期間の外",
    "event-no-date": () => "開催日を確認できない",
    "missed-follow-up": (title) => `外れの印を付けた記事「${title}」の続報`,
    "stopped-follow-up": (title) => `続報を止めた記事「${title}」の続報`,
  },
  en: {
    "no-date": () => "publication time unknown",
    "below-minimum": () => "importance below the category minimum",
    "over-limit": () => "over the article limit of the run",
    "event-outside-window": () => "event date outside the window",
    "event-no-date": () => "event date could not be confirmed",
    "missed-follow-up": (title) => `follow-up to "${title}", which was marked as a miss`,
    "stopped-follow-up": (title) => `follow-up to "${title}", whose follow-ups were stopped`,
  },
};

/**
 * The text of one of the program's reasons in the output language. The kinds of a marked follow-up name the article
 * it followed up, given as `title`; the others ignore it.
 */
export function reasonText(code: ReasonCode, outputLanguage: string, title = ""): string {
  return REASONS[outputLanguage.toLowerCase().startsWith("ja") ? "ja" : "en"][code](title);
}
