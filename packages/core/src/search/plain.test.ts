import { describe, expect, it } from "vitest";
import { markdownToText, searchText } from "./plain.ts";

describe("markdownToText", () => {
  it("keeps the words of a link and drops where it leads", () => {
    const text = markdownToText("詳しくは[発表](https://example.org/release)を見る。");
    expect(text).toBe("詳しくは発表を見る。");
    expect(text).not.toContain("example");
  });

  it("drops the marks of headings, emphasis, lists, quotes and code", () => {
    const text = markdownToText("## 見出し\n\n**強い**と*弱い*\n\n- 一つ目\n- 二つ目\n\n> 引用\n\n`code` と\n\n```\nblock\n```");
    for (const word of ["見出し", "強いと弱い", "一つ目", "二つ目", "引用", "code と", "block"]) expect(text).toContain(word);
    expect(text).not.toMatch(/[#*>`]/);
  });

  it("keeps the words of an image without its address", () => {
    expect(markdownToText("![グラフ](https://example.org/a.png)")).toBe("グラフ");
  });

  it("puts blocks on lines of their own", () => {
    expect(markdownToText("一段落\n\n二段落")).toBe("一段落\n二段落");
  });
});

describe("searchText", () => {
  const base = {
    origin: "generated",
    title: "Title",
    translatedTitle: null,
    summary: "要約",
    autoSummary: null,
    body: "[本文](https://example.org/x)",
    contentText: "",
    impact: null,
    venue: null,
  };

  it("joins the fields on lines of their own, normalized, without link targets", () => {
    expect(searchText({ ...base, translatedTitle: "訳", impact: "影響", venue: "ＡＢＣホール" })).toBe("title\n訳\n要約\n本文\n影響\nabcホール");
  });

  it("takes the content text of a feed article for its body", () => {
    expect(searchText({ ...base, origin: "feed", body: "**md** [x](https://example.org)", contentText: "md x", autoSummary: "自動" })).toBe(
      "title\n要約\n自動\nmd x",
    );
  });
});
