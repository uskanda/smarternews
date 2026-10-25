import type { Mention } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { groupMentions, MENTION_KIND_LABELS } from "./mentions.ts";

describe("groupMentions", () => {
  it("groups the names by kind, people, organizations, products and places in that order, each kind in stored order", () => {
    const mentions: Mention[] = [
      { name: "日本銀行", kind: "organization" },
      { name: "東京", kind: "place" },
      { name: "植田和男", kind: "person" },
      { name: "財務省", kind: "organization" },
    ];
    expect(groupMentions(mentions)).toEqual([
      { kind: "person", label: "人", mentions: [{ name: "植田和男", kind: "person" }] },
      {
        kind: "organization",
        label: "組織",
        mentions: [
          { name: "日本銀行", kind: "organization" },
          { name: "財務省", kind: "organization" },
        ],
      },
      { kind: "place", label: "地名", mentions: [{ name: "東京", kind: "place" }] },
    ]);
  });

  it("gives no group for an article without names", () => {
    expect(groupMentions([])).toEqual([]);
  });

  it("names the four kinds", () => {
    expect(MENTION_KIND_LABELS).toEqual({ person: "人", organization: "組織", product: "製品", place: "地名" });
  });
});
