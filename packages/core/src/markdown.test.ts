import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  it("renders paragraphs, emphasis and lists", () => {
    const html = renderMarkdown("First **bold** line.\n\n- one\n- two");
    expect(html).toContain("<p>First <strong>bold</strong> line.</p>");
    expect(html).toContain("<li>one</li>");
  });

  it("shows raw HTML as text instead of passing it through", () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> and <img src=x onerror="alert(2)">');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops a link that would run a script", () => {
    const html = renderMarkdown("[click](javascript:alert(1)) and [ok](https://example.org/a)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://example.org/a"');
  });

  it("shows an image only when asked to, and only one served over HTTPS", () => {
    const markdown = "![A chart](https://img.example.org/a.png) ![Plain](http://img.example.org/b.png)";
    expect(renderMarkdown(markdown)).toBe("<p>A chart Plain</p>");
    expect(renderMarkdown(markdown, { images: true })).toBe(
      '<p><img src="https://img.example.org/a.png" alt="A chart" loading="lazy" referrerpolicy="no-referrer"> Plain</p>',
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the characters that are special in markup", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

});
