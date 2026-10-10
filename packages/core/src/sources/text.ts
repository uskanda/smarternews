const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Markup reduced to one line of plain text, cut at `max` characters. */
export function plainText(markup: string, max = 500): string {
  const text = decodeEntities(markup.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const INLINE_TAGS = /<\/?(?:b|i|u|em|strong|span|font|a|br|code|sub|sup)(?:\s[^>]*)?\/?>/gi;

/** A headline as one line of text. Only inline HTML tags are removed: a headline may mention "<video>". */
export function plainTitle(text: string, max = 300): string {
  const title = decodeEntities(text.replace(INLINE_TAGS, " ")).replace(/\s+/g, " ").trim();
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}
