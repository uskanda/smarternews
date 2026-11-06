// What the forms of the settings share to check their values before they send. Every form has `noValidate`: it
// checks the values itself and shows the reason in Japanese beside the field, as it shows a refusal of the server.

/** What is said after the reason for a value in the wrong form. */
export const TIME_FORMAT_HINT = "05:00 のように24時間表記で書いてください。";
export const LANGUAGE_FORMAT_HINT = "ja や en のように書いてください。";
export const REGION_FORMAT_HINT = "JP や US のように、大文字2文字で書いてください。";

/** The reasons the form itself found for not sending, by the name of the field. */
export type Problems = Partial<Record<string, string>>;

/** The reasons that were found, or null when every field passed. */
export function problemsOf(entries: Record<string, string | null>): Problems | null {
  const found = Object.entries(entries).filter((entry): entry is [string, string] => entry[1] !== null);
  return found.length > 0 ? Object.fromEntries(found) : null;
}
