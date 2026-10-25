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

  it("shows an image only when asked to, and for a screen only one the server relays", () => {
    const relayed = "/api/v1/image-proxy/c2ln/aHR0cA";
    const markdown = `![A chart](https://img.example.org/a.png) ![Plain](http://img.example.org/b.png) ![Relayed](${relayed})`;
    expect(renderMarkdown(markdown)).toBe("<p>A chart Plain Relayed</p>");
    expect(renderMarkdown(markdown, { images: "relayed" })).toBe(
      `<p>A chart Plain <img src="${relayed}" alt="Relayed" loading="lazy" referrerpolicy="no-referrer"></p>`,
    );
  });

  it("keeps the original images over HTTP and HTTPS, and nothing else, when asked for the originals", () => {
    const markdown = "![A](https://img.example.org/a.png) ![B](http://img.example.org/b.png) ![C](javascript:alert(1)) ![D](/api/v1/image-proxy/x/y)";
    expect(renderMarkdown(markdown, { images: "original" })).toBe(
      '<p><img src="https://img.example.org/a.png" alt="A" loading="lazy" referrerpolicy="no-referrer"> ' +
        '<img src="http://img.example.org/b.png" alt="B" loading="lazy" referrerpolicy="no-referrer"> C D</p>',
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the characters that are special in markup", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

});
