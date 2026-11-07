// Reasons the program itself gives when it rejects a candidate. The judge's reasons come from the model.
export type ReasonCode = "no-date" | "below-minimum" | "over-limit" | "event-outside-window" | "event-no-date";

const REASONS: Record<"ja" | "en", Record<ReasonCode, string>> = {
  ja: {
    "no-date": "公開日時が不明",
    "below-minimum": "重要度が基準未満",
    "over-limit": "件数上限",
    "event-outside-window": "開催日が対象期間の外",
    "event-no-date": "開催日を確認できない",
  },
  en: {
    "no-date": "publication time unknown",
    "below-minimum": "importance below the category minimum",
    "over-limit": "over the article limit of the run",
    "event-outside-window": "event date outside the window",
    "event-no-date": "event date could not be confirmed",
  },
};

export function reasonText(code: ReasonCode, outputLanguage: string): string {
  return REASONS[outputLanguage.toLowerCase().startsWith("ja") ? "ja" : "en"][code];
}

/**
 * The program's reason a stored reason is, in whichever language it was written; null for a reason of the judge.
 * A candidate keeps only its last reason, so this is how the judge's verdict on it is told apart later.
 */
export function programReasonCode(reason: string): ReasonCode | null {
  for (const texts of Object.values(REASONS)) {
    for (const [code, text] of Object.entries(texts)) {
      if (text === reason) return code as ReasonCode;
    }
  }
  return null;
}
