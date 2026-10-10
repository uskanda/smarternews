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
