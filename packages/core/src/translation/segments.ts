// The content of a feed article, cut into the segments that are translated one by one and shown as pairs
// of translation and original. The Markdown is the one `convertContent` writes.

export interface Segment {
  /** Markdown of the segment, as it is in the content. */
  original: string;
  /** False for code, images, rules, and what lies past the length that is translated. */
  translate: boolean;
}

/** The fence a line opens or closes, also inside a list item or a quote. */
function fenceOf(line: string): string | null {
  return /^(?:\s|>|- |\d+\. )*(`{3,})\s*$/.exec(line)?.[1] ?? null;
}

const LIST_ITEM = /^(- |\d+\. )/;

/** The blocks of the text: what blank lines set apart, with a code block kept whole. */
function blocksOf(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (current.length > 0) blocks.push(current.join("\n"));
    current = [];
  };
  for (const line of markdown.split("\n")) {
    if (fence === null && line.trim().length === 0) {
      flush();
      continue;
    }
    current.push(line);
    const mark = fenceOf(line);
    if (mark === null) continue;
    if (fence === null) fence = mark;
    else if (mark.length >= fence.length) fence = null;
  }
  flush();
  return blocks;
}

/** A list as its items, each with the lines that belong to it; any other block as it is. */
function itemsOf(block: string): string[] {
  if (!LIST_ITEM.test(block)) return [block];
  const items: string[] = [];
  for (const line of block.split("\n")) {
    if (LIST_ITEM.test(line) || items.length === 0) items.push(line);
    else items[items.length - 1] += `\n${line}`;
  }
  return items;
}

function hasWords(segment: string): boolean {
  if (/^`{3,}/.test(segment) || /^-{3,}$/.test(segment)) return false;
  const withoutImages = segment.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/^(- |\d+\. |>)/, "");
  return withoutImages.replace(/[\\\s]/g, "").length > 0;
}

/**
 * Cuts content into headings, paragraphs, list items and quotes. Segments that end within the first
 * `maxChars` characters are to be translated; `truncated` tells that words lie past that length.
 */
export function splitSegments(markdown: string, maxChars: number): { segments: Segment[]; truncated: boolean } {
  const segments: Segment[] = [];
  let truncated = false;
  let offset = 0;
  for (const original of blocksOf(markdown).flatMap(itemsOf)) {
    const within = offset + original.length <= maxChars;
    const words = hasWords(original);
    if (words && !within) truncated = true;
    segments.push({ original, translate: words && within });
    offset += original.length + 2;
  }
  return { segments, truncated };
}
