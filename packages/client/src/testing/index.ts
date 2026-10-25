// What the tests of the web app and the Android app share. Not part of what the apps load.

/**
 * A body with every kind of block and inline the two apps draw: a heading, paragraphs with emphasis, a link and
 * inline code, a list, a table, a block of code, raw HTML, an image and a quote. The web app's tree and the
 * Android app's tokens must make the same text of it, apart from spaces: highlights are found in that text.
 */
export const ANNOTATION_SAMPLE_MARKDOWN = [
  "# 電池の工場",
  "",
  "同社は**電池の工場**を新設すると[発表](https://example.org/news)した。前年比で増えた。",
  "",
  "- 一つ目の項目",
  "- 二つ目の*項目*",
  "",
  "| 項目 | 数 |",
  "|---|---|",
  "| 工場 | 2 |",
  "",
  "`inline code` を含む文。",
  "",
  "```",
  "const plant = 1;",
  "```",
  "",
  "<b>生のHTML</b>の文字。",
  "",
  "![工場の写真](https://example.org/plant.png)",
  "",
  "> 引用の文。",
].join("\n");

/**
 * The text of `ANNOTATION_SAMPLE_MARKDOWN` as a highlight is found in it, without spaces: the words as drawn,
 * the raw HTML and the table as their characters (neither app draws a table), without the description of the
 * image or where the link leads.
 */
export const ANNOTATION_SAMPLE_TEXT =
  "電池の工場同社は電池の工場を新設すると発表した。前年比で増えた。一つ目の項目二つ目の項目|項目|数||---|---||工場|2|inlinecodeを含む文。constplant=1;<b>生のHTML</b>の文字。引用の文。";

/** A text without spaces and line breaks, as highlights are compared. */
export function withoutSpaces(text: string): string {
  return text.replace(/\s+/gu, "");
}
