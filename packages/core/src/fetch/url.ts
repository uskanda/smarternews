const TRACKING_PARAMETERS = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|oc)$/i;

/**
 * The form of a URL used to tell whether two candidates are the same page: tracking parameters and the
 * fragment are removed and the host is lowercased.
 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = "";
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.test(name)) parsed.searchParams.delete(name);
  }
  return parsed.toString();
}

/** A title that normalizes to fewer characters than this is too plain to tell two articles apart. */
export const MIN_TITLE_CHARS = 10;

/**
 * The form of a title used to tell whether two feed articles are the same: full and half width, case, white
 * space, punctuation and symbols are ignored. Null when fewer than `MIN_TITLE_CHARS` characters remain.
 */
export function normalizeTitle(title: string): string | null {
  const normalized = title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  return [...normalized].length < MIN_TITLE_CHARS ? null : normalized;
}
