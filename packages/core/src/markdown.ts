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
const marked = new Marked({
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
      return escapeHtml(token.text);
    },
  },
});

export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false }).trim();
}
