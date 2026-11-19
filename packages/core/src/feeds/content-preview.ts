// What a content selector would take out of a feed's pages, tried on the page of its newest article with a URL.
// The page is fetched and read the way full content reads it, and nothing is stored. No model is involved.
import { CONTENT_PREVIEW_CHARS, type ContentPreview } from "../api.ts";
import type { Database } from "../db/database.ts";
import { getFeed } from "../db/feeds.ts";
import { num, str } from "../db/rows.ts";
import type { PageFetcher } from "../fetch/pages.ts";
import { chars, pageFailure, takeContent } from "./full-content.ts";
import { checkContentSelectorUsable } from "./page.ts";

export interface ContentPreviewDeps {
  db: Database;
  pages: PageFetcher;
}

/** The feed's article stored last among those with a page. */
function newestWithPage(db: Database, feedId: number): { id: number; title: string; url: string; contentText: string } | null {
  const row = db
    .prepare(
      `SELECT a.id, a.title, a.content_text,
              (SELECT url FROM article_refs r WHERE r.article_id = a.id ORDER BY r.position LIMIT 1) AS url
         FROM articles a
        WHERE a.origin = 'feed' AND a.feed_id = ? AND EXISTS (SELECT 1 FROM article_refs r WHERE r.article_id = a.id)
        ORDER BY a.created_at DESC, a.id DESC LIMIT 1`,
    )
    .get(feedId);
  return row ? { id: num(row.id), title: str(row.title), url: str(row.url), contentText: str(row.content_text) } : null;
}

/**
 * Tries a content selector, or none, on the page of the feed's newest article with a URL. Refuses a feed that
 * does not exist and a selector the engine cannot use; a page that cannot be read is an answer.
 */
export async function previewContent(deps: ContentPreviewDeps, feedId: number, contentSelector: string | null): Promise<ContentPreview> {
  getFeed(deps.db, feedId);
  if (contentSelector !== null) checkContentSelectorUsable(contentSelector);
  const found = newestWithPage(deps.db, feedId);
  if (!found) return { status: "no-article" };
  const article = { id: found.id, title: found.title, url: found.url };
  const page = await deps.pages.fetchPage(found.url);
  if (!page.ok) return { status: "failed", article, error: pageFailure(page) };
  const content = takeContent(deps.db, page, contentSelector);
  if ("reason" in content) return { status: "failed", article, error: content };
  const taken = chars(content.text);
  return {
    status: "ok",
    article,
    matched: content.matched,
    markdown: [...content.markdown].slice(0, CONTENT_PREVIEW_CHARS).join(""),
    chars: taken,
    shorter: taken < chars(found.contentText),
  };
}
