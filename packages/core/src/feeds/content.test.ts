import { describe, expect, it } from "vitest";
import { convertContent, MAX_CONTENT_CHARS } from "./content.ts";

const BASE = "https://example.org/posts/1";
const md = (html: string) => convertContent(html, BASE).markdown;

describe("convertContent", () => {
  it("keeps paragraphs, headings, lists, quotes, emphasis and code", () => {
    const html = `
      <h2>Changes</h2>
      <p>The <strong>parser</strong> is <em>faster</em> and <code>strict</code>.</p>
      <ul><li>First</li><li>Second <ol><li>Nested</li></ol></li></ul>
      <blockquote><p>Quoted words.</p></blockquote>
      <pre><code>const a = 1;\n  indented();</code></pre>`;
    expect(md(html)).toBe(
      [
        "## Changes",
        "The **parser** is *faster* and `strict`.",
        "- First\n- Second\n  1. Nested",
        "> Quoted words.",
        "```\nconst a = 1;\n  indented();\n```",
      ].join("\n\n"),
    );
  });

  it("removes scripts, styles and embedded frames, and keeps the text around them", () => {
    const html = `<p>Before.</p><script>alert(1)</script><style>p{}</style><iframe src="https://video.example/1"></iframe><p onclick="x()">After.</p>`;
    const result = md(html);
    expect(result).toBe("Before.\n\nAfter.");
    expect(result).not.toMatch(/alert|iframe|onclick|video\.example/);
  });

  it("keeps web links, resolved against the item, and drops other schemes", () => {
    const html = `<p><a href="/about">About</a> <a href="javascript:alert(1)">Bad</a> <a href="mailto:a@example.org">Mail</a></p>`;
    expect(md(html)).toBe("[About](https://example.org/about) Bad Mail");
  });

  it("keeps images served over HTTPS and removes the others", () => {
    const html = `<p><img src="https://img.example.org/a.png" alt="A chart"><img src="http://img.example.org/b.png" alt="Plain"><img src="data:image/png;base64,AAAA" alt="Inline"></p>`;
    const result = md(html);
    expect(result).toBe("![A chart](https://img.example.org/a.png)");
  });

  it("removes one-pixel images, which only count readers", () => {
    expect(md(`<p>Text<img src="https://t.example.org/p.gif" width="1" height="1"></p>`)).toBe("Text");
  });

  it("shows a linked image as the image", () => {
    expect(md(`<a href="https://example.org/full"><img src="https://img.example.org/t.png" alt="Thumb"></a>`)).toBe("![Thumb](https://img.example.org/t.png)");
  });

  it("writes characters that Markdown would read as markup so that they stay characters", () => {
    expect(md("<p>2 * 3 * 4 and snake_case_name and [not a link](x)</p>")).toBe("2 \\* 3 \\* 4 and snake\\_case\\_name and \\[not a link\\](x)");
    expect(md("<p># not a heading</p><p>1. not a list</p><p>- nor this</p>")).toBe("\\# not a heading\n\n1\\. not a list\n\n\\- nor this");
  });

  it("turns line breaks into Markdown line breaks and table rows into lines", () => {
    expect(md("<p>One<br>Two</p>")).toBe("One\\\nTwo");
    expect(md("<table><tr><th>Name</th><th>Size</th></tr><tr><td>a</td><td>1</td></tr></table>")).toBe("Name | Size\n\na | 1");
  });

  it("takes plain text as one paragraph", () => {
    expect(md("Just a sentence & more.")).toBe("Just a sentence & more.");
  });

  it("cuts very long content and says so in the output language", () => {
    const long = `<p>${"a".repeat(MAX_CONTENT_CHARS + 500)}</p>`;
    const ja = convertContent(long, BASE, "ja").markdown;
    expect(ja.length).toBeLessThan(MAX_CONTENT_CHARS + 100);
    expect(ja.endsWith("（長い内容のため、ここまでを表示しています。）")).toBe(true);
    expect(convertContent(long, BASE, "en").markdown.endsWith("(The content is long and ends here.)")).toBe(true);
  });
});

describe("the text for matching", () => {
  it("holds the words and not the link targets or image addresses", () => {
    const { text } = convertContent(
      `<p>Read the <a href="https://example.org/campaign/x">full story</a>.</p><img src="https://img.example.org/campaign.png" alt="Chart">`,
      BASE,
    );
    expect(text).toBe("Read the full story.");
    expect(text).not.toContain("campaign");
  });

  it("is one line, whatever the markup", () => {
    expect(convertContent("<h2>Title</h2><p>Body\n text</p><ul><li>Item</li></ul>", BASE).text).toBe("Title Body text Item");
  });
});
