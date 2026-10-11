import { Marked, type Tokens } from "marked";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SAFE_LINK = /^(https?:|mailto:)/i;

// Article bodies are written by a model that read pages from the web, so they are not trusted markup:
// raw HTML is shown as text, and only web and mail links stay links.
function renderer(images: boolean) {
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
        // An image is a request from the reader's device to another site: HTTPS only, and without a referrer.
        if (!images || !/^https:\/\//i.test(token.href)) return escapeHtml(token.text);
        return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}" loading="lazy" referrerpolicy="no-referrer">`;
      },
    },
  });
}

const withoutImages = renderer(false);
const withImages = renderer(true);

/**
 * Markdown as HTML. Images are shown only on request: the content of a feed article has them, while the
 * body of a generated article is written by a model and must not make the reader's device fetch anything.
 */
export function renderMarkdown(markdown: string, options: { images?: boolean } = {}): string {
  return (options.images ? withImages : withoutImages).parse(markdown, { async: false }).trim();
}
