import { describe, expect, it } from "vitest";
import { splitSegments } from "./segments.ts";

const split = (markdown: string, max = 20_000) => splitSegments(markdown, max);

describe("splitSegments", () => {
  it("makes one segment of every heading, paragraph and quote", () => {
    const markdown = ["## A heading", "First paragraph\\\nwith a second line.", "> A quote.\n>\n> Its second paragraph.", "Last paragraph."].join("\n\n");
    expect(split(markdown)).toEqual({
      segments: [
        { original: "## A heading", translate: true },
        { original: "First paragraph\\\nwith a second line.", translate: true },
        { original: "> A quote.\n>\n> Its second paragraph.", translate: true },
        { original: "Last paragraph.", translate: true },
      ],
      truncated: false,
    });
  });

  it("makes one segment of every item of a list, with what the item holds", () => {
    const { segments } = split("- one\n- two\n  still two\n- three\n\n1. first\n2. second");
    expect(segments.map((segment) => segment.original)).toEqual(["- one", "- two\n  still two", "- three", "1. first", "2. second"]);
    expect(segments.every((segment) => segment.translate)).toBe(true);
  });

  it("keeps a code block whole, blank lines included, and does not translate it", () => {
    const code = "```\nconst a = 1;\n\nconst b = 2;\n```";
    expect(split(`Before.\n\n${code}\n\nAfter.`).segments).toEqual([
      { original: "Before.", translate: true },
      { original: code, translate: false },
      { original: "After.", translate: true },
    ]);
  });

  it("does not translate a segment that holds only images, or a rule", () => {
    const { segments } = split("![A chart](https://example.org/a.png)\n\nText with ![an image](https://example.org/b.png).\n\n---");
    expect(segments.map((segment) => segment.translate)).toEqual([false, true, false]);
  });

  it("does not translate a segment that holds only the link of an embed, in either language", () => {
    const { segments } = split(
      [
        "[埋め込み（video.example）](https://video.example/1)",
        "[Embedded content (audio.example)](http://audio.example/a.mp3)",
        "[A link](https://example.org/x)",
        "Watch [埋め込み（video.example）](https://video.example/1)",
      ].join("\n\n"),
    );
    expect(segments.map((segment) => segment.translate)).toEqual([false, false, true, true]);
  });

  it("translates the segments that end within the limit, and records that the rest is left", () => {
    const paragraph = "x".repeat(999);
    const markdown = Array.from({ length: 50 }, () => paragraph).join("\n\n");
    const { segments, truncated } = split(markdown);
    expect(markdown.length).toBeGreaterThanOrEqual(50_000);
    expect(segments).toHaveLength(50);
    expect(segments.filter((segment) => segment.translate)).toHaveLength(19);
    expect(segments.slice(0, 19).every((segment) => segment.translate)).toBe(true);
    expect(truncated).toBe(true);
  });

  it("does not call a text cut when only code follows the limit", () => {
    const { segments, truncated } = split(`${"x".repeat(90)}\n\n\`\`\`\n${"y".repeat(50)}\n\`\`\``, 100);
    expect(segments.map((segment) => segment.translate)).toEqual([true, false]);
    expect(truncated).toBe(false);
  });

  it("yields nothing for an empty text", () => {
    expect(split("")).toEqual({ segments: [], truncated: false });
  });
});
