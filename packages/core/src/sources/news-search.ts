import type { SearchLocale } from "../api.ts";
import type { Fetcher } from "../fetch/http.ts";
import { normalizeUrl } from "../fetch/url.ts";
import { fetchXml, parseXml, textOf } from "./feed.ts";
import { resolveGoogleNewsUrl } from "./google-resolve.ts";
import { parseDate, plainText, plainTitle } from "./text.ts";
import type { CollectWindow, RawCandidate } from "./types.ts";

export type NewsEngine = "google-news" | "bing-news";

export interface NewsSearchDeps {
  fetcher: Fetcher;
  engine: NewsEngine;
  maxResultsPerQuery: number;
  /** True for a URL that an earlier run already settled. Such results are skipped before any resolving. */
  isSeen: (url: string) => boolean;
}

interface SearchResult {
  link: string;
  title: string;
  snippet: string;
  siteName: string;
  publishedAt: Date | null;
}

type Node = Record<string, unknown>;

function items(xml: string): Node[] {
  const channel = (parseXml(xml).rss as Node | undefined)?.channel as Node | undefined;
  if (!channel) throw new Error("the search did not answer with RSS");
  return (channel.item as Node[] | undefined) ?? [];
}

function firstLink(link: unknown): string {
  return textOf(Array.isArray(link) ? link[0] : link).trim();
}

// ---- Google News -------------------------------------------------------------------------------

function googleUrl(query: string, locale: SearchLocale, hours: number | null): string {
  const when = hours === null ? "" : hours < 24 ? ` when:${hours}h` : ` when:${Math.ceil(hours / 24)}d`;
  const params = new URLSearchParams({
    q: `${query}${when}`,
    hl: locale.language,
    gl: locale.region,
    ceid: `${locale.region}:${locale.language}`,
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function googleResults(xml: string): SearchResult[] {
  return items(xml).map((item) => {
    const siteName = plainText(textOf(item.source), 200);
    const title = plainTitle(textOf(item.title));
    const suffix = ` - ${siteName}`;
    return {
      link: firstLink(item.link),
      // Google appends the outlet to the headline, and its description only repeats both.
      title: siteName.length > 0 && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title,
      snippet: "",
      siteName,
      publishedAt: parseDate(textOf(item.pubDate)),
    };
  });
}

// ---- Bing News ---------------------------------------------------------------------------------

function bingUrl(query: string, locale: SearchLocale, hours: number | null): string {
  const interval = hours === null ? null : hours <= 24 ? "7" : hours <= 168 ? "8" : "9";
  const params = new URLSearchParams({
    q: query,
    format: "rss",
    setlang: locale.language,
    cc: locale.region,
    qft: [interval ? `interval="${interval}"` : null, 'sortbydate="1"'].filter(Boolean).join("+"),
  });
  return `https://www.bing.com/news/search?${params.toString()}`;
}

function bingResults(xml: string): SearchResult[] {
  return items(xml).map((item) => {
    const link = firstLink(item.link);
    let original = link;
    try {
      original = new URL(link).searchParams.get("url") ?? link;
    } catch {
      // keep the link as it is
    }
    return {
      link: original,
      title: plainTitle(textOf(item.title)),
      snippet: plainText(textOf(item.description)),
      siteName: plainText(textOf(item["News:Source"]), 200),
      publishedAt: parseDate(textOf(item.pubDate)),
    };
  });
}

// ------------------------------------------------------------------------------------------------

/** Candidates for one query. Results older than the window are left out, and the newest ones win the limit. */
export async function collectNews(
  deps: NewsSearchDeps,
  query: string,
  locale: SearchLocale,
  window: CollectWindow,
): Promise<RawCandidate[]> {
  const google = deps.engine === "google-news";
  const xml = await fetchXml(deps.fetcher, google ? googleUrl(query, locale, window.hours) : bingUrl(query, locale, window.hours));
  const results = (google ? googleResults(xml) : bingResults(xml))
    .filter((result) => result.link.length > 0 && result.title.length > 0)
    .filter((result) => !(window.since && result.publishedAt && result.publishedAt < window.since))
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, deps.maxResultsPerQuery);

  const candidates: RawCandidate[] = [];
  for (const result of results) {
    const link = normalizeUrl(result.link);
    if (deps.isSeen(link)) continue;
    const base = {
      title: result.title,
      snippet: result.snippet,
      siteName: result.siteName,
      publishedAt: result.publishedAt,
      sourceKind: "news-search" as const,
    };
    if (!google) {
      candidates.push({ url: link, aliases: [], fetchable: true, ...base });
      continue;
    }
    const resolved = await resolveGoogleNewsUrl(deps.fetcher, link);
    candidates.push(
      resolved
        ? { url: normalizeUrl(resolved), aliases: [link], fetchable: true, ...base }
        : { url: link, aliases: [], fetchable: false, ...base },
    );
  }
  return candidates;
}
