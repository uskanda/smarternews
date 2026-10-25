// What article search matches against: the fields of an article as one normalized text, without Markdown
// marks and without the addresses links and images point to.
import { Lexer, type Token, type Tokens } from "marked";
import { normalizeForMatch } from "./text.ts";

function inlineText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "image") return (token as Tokens.Image).text;
      if (token.type === "br") return " ";
      if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
      return "text" in token && typeof token.text === "string" ? token.text : "";
    })
    .join("");
}

function blockLines(tokens: Token[], lines: string[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "hr":
        break;
      case "list":
        for (const item of (token as Tokens.List).items) blockLines(item.tokens, lines);
        break;
      case "blockquote":
        blockLines((token as Tokens.Blockquote).tokens, lines);
        break;
      case "table": {
        const table = token as Tokens.Table;
        for (const row of [table.header, ...table.rows]) lines.push(row.map((cell) => inlineText(cell.tokens)).join(" "));
        break;
      }
      case "code":
      case "html":
        lines.push((token as Tokens.Code | Tokens.HTML).text);
        break;
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) lines.push(inlineText(token.tokens));
        else if ("text" in token && typeof token.text === "string") lines.push(token.text);
    }
  }
}

/** The words of Markdown, a block to a line: no marks, no addresses of links or images. */
export function markdownToText(markdown: string): string {
  const lines: string[] = [];
  blockLines(new Lexer({ gfm: true }).lex(markdown), lines);
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** The fields of an article that search matches, as the database holds them. */
export interface SearchFields {
  origin: string;
  title: string;
  translatedTitle: string | null;
  summary: string;
  autoSummary: string | null;
  /** Markdown. */
  body: string;
  /** A feed article's content without markup and link targets. */
  contentText: string;
  impact: string | null;
  venue: string | null;
}

/** The body as search sees it: a feed article's content text, or a generated article's body without Markdown. */
export function searchBody(fields: Pick<SearchFields, "origin" | "body" | "contentText">): string {
  return fields.origin === "feed" && fields.contentText.length > 0 ? fields.contentText : markdownToText(fields.body);
}

/**
 * The text the search index holds for an article: the fields it matches, one to a line so that no term spans
 * two of them, normalized as the terms are. Source URLs are not among them.
 */
export function searchText(fields: SearchFields): string {
  return normalizeForMatch(
    [fields.title, fields.translatedTitle, fields.summary, fields.autoSummary, searchBody(fields), fields.impact, fields.venue]
      .filter((field): field is string => field !== null && field.length > 0)
      .join("\n"),
  );
}
