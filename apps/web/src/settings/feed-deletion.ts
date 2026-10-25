import type { Feed } from "@smarternews/core/api";

/**
 * What the confirmation of deleting a feed says goes with it: its articles, how many of them are starred, and how
 * many have annotations, which go too. The settings page and the menu of the left pane say the same.
 */
export function feedDeletionText(feed: Pick<Feed, "title" | "articleCount" | "starredCount" | "annotatedCount">): string {
  return [
    `「${feed.title}」と、その配信記事${feed.articleCount}件が消えます。`,
    feed.starredCount > 0 ? `うち${feed.starredCount}件にはスターが付いています。` : "",
    feed.annotatedCount > 0 ? `注釈のある${feed.annotatedCount}件も、注釈とともに消えます。` : "",
    "元に戻せません。",
  ].join("");
}
