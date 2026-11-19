import type { Article } from "@smarternews/core/api";

/**
 * An article as a Markdown link: its headline, the translated title when there is one as on the screen, and the
 * main source, the page `o` opens. Null for an article without a main source.
 */
export function articleLink(article: Pick<Article, "title" | "translatedTitle" | "primaryUrl">): string | null {
  if (!article.primaryUrl) return null;
  const text = (article.translatedTitle ?? article.title).replace(/\s*[\r\n]+\s*/g, " ").replace(/[\\[\]]/g, (char) => `\\${char}`);
  const url = article.primaryUrl.replace(/[() ]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${text}](${url})`;
}
