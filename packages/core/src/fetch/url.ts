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

/**
 * The site a URL belongs to, as candidates are counted and blocked by: the host, lowercased, without a trailing dot
 * and without a leading `www.`. Subdomains stay apart. Empty for what is not a URL.
 */
export function siteHost(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** The host of the redirect links of Google News that could not be resolved. */
export const GOOGLE_NEWS_HOST = "news.google.com";

/**
 * The site of a candidate: the host of its URL, or, while that is still a Google News redirect, the host of the
 * outlet the search named. Empty when neither is known.
 */
export function candidateHost(url: string, siteUrl: string | null | undefined): string {
  const host = siteHost(url);
  if (host !== GOOGLE_NEWS_HOST) return host;
  return siteUrl ? siteHost(siteUrl) : "";
}

/** A host written by hand, in the form `siteHost` gives, or null when it is not a host name. */
export function normalizeHost(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9.-]+$/.test(trimmed)) return null;
  const host = siteHost(`https://${trimmed}/`);
  return host === "" || host.startsWith(".") ? null : host;
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
