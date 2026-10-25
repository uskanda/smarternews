import { Marked, type Tokens } from "marked";
import { isImageProxyPath } from "./api.ts";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SAFE_LINK = /^(https?:|mailto:)/i;

/**
 * Which images become `img` elements: none; only those the server relays, which is what a screen may load;
 * or the original ones over HTTP and HTTPS, for the translation adapter, which sends them on as tags.
 */
export type ImageMode = "none" | "relayed" | "original";

const IMAGE_SOURCE: Record<ImageMode, (url: string) => boolean> = {
  none: () => false,
  relayed: isImageProxyPath,
  original: (url) => /^https?:\/\//i.test(url),
};

// Article bodies are written by a model that read pages from the web, so they are not trusted markup:
// raw HTML is shown as text, and only web and mail links stay links.
function renderer(images: ImageMode) {
  const shown = IMAGE_SOURCE[images];
  return new Marked({
    gfm: true,
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag): string {
        return escapeHtml(token.text);
      },
      link(token: Tokens.Link): string {
        const text = this.parser.parseInline(token.tokens);
        if (!SAFE_LINK.test(token.href)) return text;
        return `<a href="${escapeHtml(token.href)}" rel="noopener noreferrer">${text}</a>`;
      },
      image(token: Tokens.Image): string {
        // An image is a request from the reader's device: to the server's relay only, and without a referrer.
        if (!shown(token.href)) return escapeHtml(token.text);
        return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}" loading="lazy" referrerpolicy="no-referrer">`;
      },
    },
  });
}

const renderers: Record<ImageMode, Marked> = { none: renderer("none"), relayed: renderer("relayed"), original: renderer("original") };

/**
 * Markdown as HTML. Images are shown only on request: the content of a feed article has them, while the
 * body of a generated article is written by a model and must not make the reader's device fetch anything.
 */
export function renderMarkdown(markdown: string, options: { images?: ImageMode } = {}): string {
  return renderers[options.images ?? "none"].parse(markdown, { async: false }).trim();
}
