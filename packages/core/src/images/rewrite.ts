// The API names the relay in place of the original URL of every image a screen may load. Stored content keeps
// the original, so a new key only changes the answers. Only the content of feed articles is rewritten: an
// image in the body of a generated article is never loaded, wherever it points.
import type { Article, ArticleTranslation, FullContent } from "../api.ts";
import { renderMarkdown } from "../markdown.ts";
import { imageProxyPath } from "./sign.ts";

/**
 * An image as the conversion of content writes it: `![description](URL)` or `![description](<URL>)`, where
 * the description escapes brackets with a backslash. An image in another form a model may write in a
 * translation keeps its URL, which a screen does not load.
 */
const IMAGE = /!\[((?:\\.|[^\\\]\n])*)\]\((?:<([^<>\n]*)>|([^\s()<>]+))\)/g;

/** The Markdown with the relay in place of the URL of each image over HTTP or HTTPS. */
export function relayMarkdownImages(markdown: string, key: Uint8Array): string {
  return markdown.replace(IMAGE, (whole, description: string, bracketed: string | undefined, bare: string | undefined) => {
    const url = bracketed ?? bare ?? "";
    if (!/^https?:\/\//i.test(url)) return whole;
    return `![${description}](${imageProxyPath(key, url)})`;
  });
}

function relayContent<T extends { body: string; bodyHtml: string }>(content: T, key: Uint8Array): T {
  const body = relayMarkdownImages(content.body, key);
  return { ...content, body, bodyHtml: renderMarkdown(body, { images: "relayed" }) };
}

/** A full content as the API gives it: its images through the relay. */
export function relayFullContent(content: FullContent, key: Uint8Array): FullContent {
  return relayContent(content, key);
}

/** A translation as the API gives it: the images of the originals and of the translations through the relay. */
export function relayTranslation(translation: ArticleTranslation, key: Uint8Array): ArticleTranslation {
  const html = (markdown: string) => renderMarkdown(markdown, { images: "relayed" });
  return {
    ...translation,
    segments: translation.segments.map((segment) => {
      const original = relayMarkdownImages(segment.original, key);
      const translated = segment.translated === null ? null : relayMarkdownImages(segment.translated, key);
      return { original, translated, originalHtml: html(original), translatedHtml: translated === null ? null : html(translated) };
    }),
  };
}

/** An article as the API gives it. A feed article's content, full content and translation load images through the relay. */
export function relayArticleImages(article: Article, key: Uint8Array): Article {
  if (article.origin !== "feed") return article;
  return {
    ...relayContent(article, key),
    fullContent: article.fullContent === null ? null : relayFullContent(article.fullContent, key),
    translation: article.translation === null ? null : relayTranslation(article.translation, key),
  };
}
