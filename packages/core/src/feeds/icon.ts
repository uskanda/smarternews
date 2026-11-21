// The icon of a subscribed feed: the small square picture its site goes by, shown before its name in the left
// pane. Only where it is found is kept; the picture itself is fetched and kept by the image relay when a screen
// asks for it. RSS's `<image>` is never taken: it is mostly a wide logo, which reads as nothing at the height of
// a letter.
import type { Fetcher } from "../fetch/http.ts";
import type { PageFetcher } from "../fetch/pages.ts";
import { sniffImageType } from "../images/format.ts";
import { pageLinks } from "./discover.ts";

/** The largest icon taken, in bytes. A site icon is far smaller; the bound keeps a search cheap. */
export const ICON_MAX_BYTES = 1_000_000;
/** How many days pass before the icon of a feed is looked for again. */
export const ICON_RECHECK_DAYS = 30;

const ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon";

export interface IconSearchDeps {
  fetcher: Fetcher;
  /** Decides what robots.txt allows, and fetches the site's page. */
  pages: PageFetcher;
}

export interface IconSearch {
  feedUrl: string;
  siteUrl: string | null;
  /** The icon the feed names itself: Atom's `<icon>` or JSON Feed's `favicon`. */
  named: string | null;
  /** The site's page when it is already in hand, as for a web feed: it is then not fetched again. */
  page?: { html: string; url: string };
}

/** The icon links of a page in document order: `rel` holds `icon`, and SVG, which the relay refuses, is left out. */
async function pageIcons(pages: PageFetcher, siteUrl: string, inHand: IconSearch["page"]): Promise<string[]> {
  let page = inHand;
  if (page === undefined) {
    const fetched = await pages.fetchPage(siteUrl);
    if (!fetched.ok) return [];
    page = fetched;
  }
  return pageLinks(page.html, page.url)
    .filter((link) => link.rel.includes("icon") && link.type !== "image/svg+xml")
    .map((link) => link.url);
}

/** Whether the URL answers with an image in a format the relay passes on. */
async function isImage(deps: IconSearchDeps, url: string): Promise<boolean> {
  try {
    if (!(await deps.pages.allows(url))) return false;
    const { bytes } = await deps.fetcher.getBytes(url, {
      maxBytes: ICON_MAX_BYTES,
      headers: { accept: ACCEPT },
      inspect: ({ status }) => {
        if (status < 200 || status > 299) throw new Error(`HTTP status ${status}`);
      },
    });
    return sniffImageType(bytes) !== null;
  } catch {
    return false;
  }
}

/**
 * Where the feed's icon is: the first of these that answers with an image. The icon the feed names, the icon
 * links of the site's page, then `/favicon.ico` at the origin of the site, or of the feed when it names no
 * site. Null when none does. Every fetch is under the limits of the fetcher and what robots.txt allows.
 */
export async function findFeedIcon(deps: IconSearchDeps, search: IconSearch): Promise<string | null> {
  const tried = new Set<string>();
  const tryEach = async (urls: string[]): Promise<string | null> => {
    for (const url of urls) {
      if (tried.has(url)) continue;
      tried.add(url);
      if (await isImage(deps, url)) return url;
    }
    return null;
  };
  if (search.named !== null) {
    const named = await tryEach([search.named]);
    if (named !== null) return named;
  }
  if (search.siteUrl !== null) {
    const linked = await tryEach(await pageIcons(deps.pages, search.siteUrl, search.page));
    if (linked !== null) return linked;
  }
  let favicon: string;
  try {
    favicon = new URL("/favicon.ico", search.siteUrl ?? search.feedUrl).toString();
  } catch {
    return null;
  }
  return tryEach([favicon]);
}
