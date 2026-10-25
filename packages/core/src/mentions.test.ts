import { describe, expect, it } from "vitest";
import { MAX_MENTION_NAME_CHARS, MAX_MENTIONS, MENTION_KINDS, mentionKey, parseMentions } from "./mentions.ts";

describe("mentionKey", () => {
  it("makes upper and lower case, full width and half width alike", () => {
    expect(mentionKey("ＯｐｅｎＡＩ")).toBe(mentionKey("OpenAI"));
    expect(mentionKey("openai")).toBe(mentionKey("OPENAI"));
    expect(mentionKey("ｿﾆｰ")).toBe(mentionKey("ソニー"));
  });

  it("drops the spaces around a name and makes a run of spaces one", () => {
    expect(mentionKey("  Bank of  Japan ")).toBe(mentionKey("Bank of Japan"));
    expect(mentionKey("Bank　of\tJapan")).toBe(mentionKey("bank of japan"));
    expect(mentionKey("  Bank of  Japan ")).toBe("bank of japan");
  });

  it("keeps an abbreviation apart from the full name, and a part apart from the whole", () => {
    expect(mentionKey("日銀")).not.toBe(mentionKey("日本銀行"));
    expect(mentionKey("日本")).not.toBe(mentionKey("日本銀行"));
  });
});

describe("parseMentions", () => {
  const organization = (name: string) => ({ name, kind: "organization" });

  it("knows four kinds", () => {
    expect(MENTION_KINDS).toEqual(["person", "organization", "product", "place"]);
  });

  it("keeps names of the four kinds in the order of the output", () => {
    const raw = [
      { name: "日本銀行", kind: "organization" },
      { name: "植田和男", kind: "person" },
      { name: "iPhone", kind: "product" },
      { name: "東京", kind: "place" },
    ];
    expect(parseMentions(raw)).toEqual(raw);
  });

  it("gives an empty list for an empty list", () => {
    expect(parseMentions([])).toEqual([]);
  });

  it("refuses the whole list when a kind is none of the four", () => {
    expect(parseMentions([organization("日本銀行"), { name: "総会", kind: "event" }])).toBeNull();
    expect(parseMentions([{ name: "総会", kind: "出来事" }])).toBeNull();
  });

  it("refuses something that is not a list, and a missing list", () => {
    expect(parseMentions("日本銀行")).toBeNull();
    expect(parseMentions({ name: "日本銀行", kind: "organization" })).toBeNull();
    expect(parseMentions(undefined)).toBeNull();
    expect(parseMentions(null)).toBeNull();
  });

  it("refuses the whole list when an item has no name or no kind", () => {
    expect(parseMentions([organization("日本銀行"), { kind: "person" }])).toBeNull();
    expect(parseMentions([organization("日本銀行"), { name: "植田和男" }])).toBeNull();
    expect(parseMentions([organization("日本銀行"), "植田和男"])).toBeNull();
    expect(parseMentions([{ name: 7, kind: "person" }])).toBeNull();
  });

  it("refuses the whole list when a name is empty or longer than 100 characters", () => {
    expect(MAX_MENTION_NAME_CHARS).toBe(100);
    expect(parseMentions([organization("日本銀行"), organization("")])).toBeNull();
    expect(parseMentions([organization("日本銀行"), organization("  　 ")])).toBeNull();
    expect(parseMentions([organization("あ".repeat(101))])).toBeNull();
    expect(parseMentions([organization(` ${"あ".repeat(100)} `)])).toEqual([organization("あ".repeat(100))]);
  });

  it("drops the spaces around a name", () => {
    expect(parseMentions([organization("  日本銀行 ")])).toEqual([organization("日本銀行")]);
  });

  it("keeps the first of the names that are the same, whatever their kind", () => {
    const raw = [
      { name: "OpenAI", kind: "organization" },
      { name: "Sam Altman", kind: "person" },
      { name: "openai", kind: "product" },
    ];
    expect(parseMentions(raw)).toEqual([
      { name: "OpenAI", kind: "organization" },
      { name: "Sam Altman", kind: "person" },
    ]);
  });

  it("keeps the first ten names of a longer list", () => {
    expect(MAX_MENTIONS).toBe(10);
    const raw = Array.from({ length: 12 }, (_, index) => organization(`組織${index + 1}`));
    expect(parseMentions(raw)).toEqual(raw.slice(0, 10));
  });

  it("counts the ten after dropping the names that are the same", () => {
    const raw = [organization("組織1"), organization("組織1"), ...Array.from({ length: 10 }, (_, index) => organization(`組織${index + 2}`))];
    const parsed = parseMentions(raw);
    expect(parsed).toHaveLength(10);
    expect(parsed!.map((mention) => mention.name)).toEqual(Array.from({ length: 10 }, (_, index) => `組織${index + 1}`));
  });

  it("refuses a list whose bad item comes after the tenth", () => {
    const raw = [...Array.from({ length: 10 }, (_, index) => organization(`組織${index + 1}`)), { name: "x", kind: "event" }];
    expect(parseMentions(raw)).toBeNull();
  });
});
