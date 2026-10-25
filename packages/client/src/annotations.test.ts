import { describe, expect, it } from "vitest";
import { anchorOf, cutByRanges, locateHighlights, PART_SEPARATOR, partStarts, rangesByPart, type LocatableHighlight } from "./annotations.ts";

let nextId = 1;
function highlight(text: string, start: number, end: number, extra: Partial<LocatableHighlight> = {}): LocatableHighlight {
  const anchor = anchorOf(text, start, end);
  if (!anchor) throw new Error("no anchor");
  const id = nextId++;
  return { id, createdAt: `2026-03-01T00:00:${String(id).padStart(2, "0")}.000Z`, ...anchor, ...extra };
}

/** The highlight around the first occurrence of `quote` in `text`, after `from`. */
function on(text: string, quote: string, from = 0, extra: Partial<LocatableHighlight> = {}): LocatableHighlight {
  const start = text.indexOf(quote, from);
  return highlight(text, start, start + quote.length, extra);
}

function marked(text: string, highlights: LocatableHighlight[]): string[] {
  return locateHighlights(text, highlights).ranges.map((range) => text.slice(range.start, range.end));
}

describe("the anchor of a selection", () => {
  it("keeps the text, up to 32 characters before and after it without spaces, and where it starts without spaces", () => {
    const text = "一つ目の段落です。\n\n同社は 電池の工場を新設する と発表した。";
    const start = text.indexOf("電池");
    const anchor = anchorOf(text, start, start + "電池の工場を新設する".length);
    expect(anchor).toEqual({ quote: "電池の工場を新設する", prefix: "一つ目の段落です。同社は", suffix: "と発表した。", position: 12 });
  });

  it("cuts the text around the quote to 32 characters", () => {
    const text = `${"あ".repeat(40)}電池${"い".repeat(40)}`;
    const anchor = anchorOf(text, 40, 42)!;
    expect(anchor.prefix).toBe("あ".repeat(32));
    expect(anchor.suffix).toBe("い".repeat(32));
    expect(anchor.position).toBe(40);
  });

  it("has less before a quote at the start, and less after one at the end", () => {
    const text = "電池の工場。次の文。";
    expect(anchorOf(text, 0, 2)).toEqual({ quote: "電池", prefix: "", suffix: "の工場。次の文。", position: 0 });
    expect(anchorOf(text, 6, 10)).toEqual({ quote: "次の文。", prefix: "電池の工場。", suffix: "", position: 6 });
  });

  it("leaves out the spaces at the ends of the selection, and gives nothing for a selection of spaces", () => {
    const text = "前の文。 次の文。";
    expect(anchorOf(text, 4, 9)?.quote).toBe("次の文。");
    expect(anchorOf(text, 4, 5)).toBeNull();
    expect(anchorOf(text, 2, 2)).toBeNull();
  });

  it("never splits a character outside the BMP at the 32nd unit", () => {
    const text = `${"😀".repeat(20)}x${"😀".repeat(20)}`;
    const start = text.indexOf("x");
    const anchor = anchorOf(text, start, start + 1)!;
    expect(anchor.prefix.length).toBeLessThanOrEqual(32);
    expect(anchor.suffix.length).toBeLessThanOrEqual(32);
    expect([...anchor.prefix].every((char) => char === "😀")).toBe(true);
    expect([...anchor.suffix].every((char) => char === "😀")).toBe(true);
  });
});

describe("finding highlights in a body", () => {
  it("finds the same sentence after a paragraph is put before it", () => {
    const before = "最初の段落。\n\n電池の工場を新設する。";
    const saved = on(before, "電池の工場を新設する");
    const after = "続報の段落。\n\n最初の段落。\n\n電池の工場を新設する。";
    expect(marked(after, [saved])).toEqual(["電池の工場を新設する"]);
  });

  it("finds the quote in full content that holds it", () => {
    const delivered = "要点だけ：電池の工場を新設する。";
    const saved = on(delivered, "電池の工場を新設する");
    const full = "長い前置き。\n\n本文では、電池の工場を新設する計画を詳しく述べた。";
    expect(marked(full, [saved])).toEqual(["電池の工場を新設する"]);
  });

  it("picks the occurrence whose text around it matches best", () => {
    const text = "売上は前年比で増えた。一方、費用も前年比で増えた。";
    const second = on(text, "前年比で増えた", text.indexOf("費用"));
    const located = locateHighlights(text, [second]);
    expect(located.ranges).toEqual([{ highlight: second, start: text.lastIndexOf("前年比"), end: text.lastIndexOf("前年比") + 7 }]);
    expect(located.missing).toEqual([]);
  });

  it("picks the occurrence nearest the saved position when the text around them matches as well", () => {
    const text = "ABC ABC ABC";
    const third = { ...on(text, "ABC", 8), prefix: "", suffix: "" };
    expect(locateHighlights(text, [third]).ranges[0]!.start).toBe(8);
    const first = { ...third, position: 0 };
    expect(locateHighlights(text, [first]).ranges[0]!.start).toBe(0);
  });

  it("finds a highlight across two paragraphs whatever the spaces and line breaks between them", () => {
    const saved = on("一つ目の段落の末尾。\n二つ目の段落の先頭。", "末尾。\n二つ目");
    const text = "一つ目の段落の末尾。\n\n  二つ目の段落の先頭。";
    const located = locateHighlights(text, [saved]);
    expect(located.ranges).toHaveLength(1);
    expect(text.slice(located.ranges[0]!.start, located.ranges[0]!.end)).toBe("末尾。\n\n  二つ目");
  });

  it("tells case and width apart", () => {
    const saved = on("The Battery plant.", "Battery");
    expect(locateHighlights("The battery plant.", [saved]).missing).toEqual([saved]);
    const wide = on("ＡＩの話", "ＡＩ");
    expect(locateHighlights("AIの話", [wide]).missing).toEqual([wide]);
  });

  it("gives the highlights it cannot find apart, in the order they were made", () => {
    const text = "電池の工場を新設する。費用は未定。";
    const kept = on(text, "費用は未定");
    const gone = on(text, "電池の工場を新設する");
    const older = { ...gone, id: 100, createdAt: "2026-01-01T00:00:00.000Z" };
    const located = locateHighlights("費用は未定。", [kept, gone, older]);
    expect(located.ranges.map((range) => range.highlight)).toEqual([kept]);
    expect(located.missing).toEqual([older, gone]);
  });

  it("gives overlapping characters to the older highlight", () => {
    const text = "一二三四五六七八九十";
    const older = on(text, "三四五六", 0, { createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = on(text, "五六七八", 0, { createdAt: "2026-02-01T00:00:00.000Z" });
    const located = locateHighlights(text, [newer, older]);
    expect(located.ranges.map((range) => [range.highlight.id, text.slice(range.start, range.end)])).toEqual([
      [older.id, "三四五六"],
      [newer.id, "七八"],
    ]);
  });

  it("splits a newer highlight around an older one inside it, and gives one covered whole as not found", () => {
    const text = "一二三四五六七八九十";
    const inner = on(text, "四五", 0, { createdAt: "2026-01-01T00:00:00.000Z" });
    const outer = on(text, "二三四五六七", 0, { createdAt: "2026-02-01T00:00:00.000Z" });
    const covered = on(text, "四", 0, { createdAt: "2026-03-01T00:00:00.000Z" });
    const located = locateHighlights(text, [outer, inner, covered]);
    expect(located.ranges.map((range) => [range.highlight.id, text.slice(range.start, range.end)])).toEqual([
      [outer.id, "二三"],
      [inner.id, "四五"],
      [outer.id, "六七"],
    ]);
    expect(located.missing).toEqual([covered]);
  });

  it("finds nothing in an empty body, and needs no highlights", () => {
    const saved = on("電池", "電池");
    expect(locateHighlights("", [saved])).toEqual({ ranges: [], missing: [saved] });
    expect(locateHighlights("本文", [])).toEqual({ ranges: [], missing: [] });
  });

  it("finds 100 highlights in a body of 100,000 characters quickly", () => {
    const sentence = "電池の工場を新設する計画について、同社は前年比で費用が増えたと述べた。";
    const paragraphs = Array.from({ length: Math.ceil(100_000 / (sentence.length + 10)) }, (_, index) => `第${index}段落：${sentence}`);
    const text = paragraphs.join("\n\n").slice(0, 100_000);
    const highlights = Array.from({ length: 100 }, (_, index) => {
      const at = text.indexOf(`第${index * 20}段落`);
      return highlight(text, at, at + 30);
    });
    const started = performance.now();
    const located = locateHighlights(text, highlights);
    const took = performance.now() - started;
    expect(located.missing).toEqual([]);
    expect(located.ranges).toHaveLength(100);
    // Drawing an article takes longer than this; the bound is loose so that a slow machine passes.
    expect(took).toBeLessThan(200);
    console.info(`locateHighlights: 100 highlights in 100,000 characters took ${took.toFixed(1)} ms`);
  });
});

describe("the parts of a body", () => {
  it("cut a highlight that spans two parts, each counted from its start", () => {
    const texts = ["一つ目の原文。", "二つ目の原文。"];
    const saved = { id: 1, createdAt: "2026-03-01T00:00:00.000Z", note: "メモ", ...anchorOf(texts.join(PART_SEPARATOR), 4, 11)! };
    const located = locateHighlights(texts.join(PART_SEPARATOR), [saved]);
    expect(partStarts(texts)).toEqual([0, 8]);
    expect(rangesByPart(located, texts)).toEqual([
      [{ start: 4, end: 7, id: 1, note: true, first: true, last: false }],
      [{ start: 0, end: 3, id: 1, note: true, first: false, last: true }],
    ]);
  });

  it("cut a run of text where the ranges begin and end", () => {
    const range = { start: 3, end: 6, id: 1, note: false, first: true, last: true };
    expect(cutByRanges("abcdefgh", 0, [range]).map((piece) => [piece.text, piece.range?.id ?? null, piece.first, piece.last])).toEqual([
      ["abc", null, false, false],
      ["def", 1, true, true],
      ["gh", null, false, false],
    ]);
    expect(cutByRanges("xyz", 4, [range]).map((piece) => [piece.text, piece.first, piece.last])).toEqual([
      ["xy", false, true],
      ["z", false, false],
    ]);
    expect(cutByRanges("xyz", 10, [range])).toEqual([{ text: "xyz", range: null, first: false, last: false }]);
  });
});
