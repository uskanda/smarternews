import type { AttentionItem } from "@smarternews/core/api";
import { describe, expect, it } from "vitest";
import { attentionLink, attentionText } from "./attention.ts";

const base: AttentionItem = {
  kind: "run-failed",
  key: "k",
  categoryId: 3,
  categoryName: "セキュリティ",
  topicId: 7,
  topicText: "悪用された脆弱性",
  runId: 42,
  runStatus: "failed",
  source: null,
  engine: null,
  query: null,
  since: null,
};

describe("attentionText", () => {
  it("says which category's scheduled run failed or stopped", () => {
    expect(attentionText({ ...base, topicId: null, topicText: null })).toBe("セキュリティの定時の実行が失敗しました。やり直しの予定はありません。");
    expect(attentionText({ ...base, runStatus: "stopped_by_limit" })).toBe("セキュリティの定時の実行が上限で止まりました。");
  });

  it("names the topic a run could not interpret", () => {
    expect(attentionText({ ...base, kind: "uninterpreted" })).toBe("セキュリティのトピック「悪用された脆弱性」を解釈できていません。");
  });

  it("names the engine and the query of a search that keeps finding nothing", () => {
    expect(attentionText({ ...base, kind: "empty-search", source: "news-search", engine: "bing-news", query: "zero-day" })).toBe(
      "セキュリティのトピック「悪用された脆弱性」で、Bing Newsの検索語「zero-day」の結果が3回続けて0件です。",
    );
    expect(attentionText({ ...base, kind: "empty-search", source: "llm-search" })).toBe("セキュリティのトピック「悪用された脆弱性」で、LLM検索の結果が3回続けて0件です。");
  });

  it("says a topic has had no article for 14 days", () => {
    expect(attentionText({ ...base, kind: "no-adoption" })).toBe("セキュリティのトピック「悪用された脆弱性」で、14日間、記事の作成も更新もありません。");
  });

  it("says Google News redirect links could not be resolved", () => {
    expect(attentionText({ ...base, kind: "google-unresolved", categoryId: null, categoryName: null, topicId: null, topicText: null, runId: null })).toBe(
      "Google Newsの転送用URLを、3回の実行で続けて1件も解決できませんでした。記事は本文のない要約になります。",
    );
  });
});

describe("attentionLink", () => {
  it("points at the run, or at the topic in its category's settings", () => {
    expect(attentionLink(base)).toEqual({ to: "/runs/42", label: "実行の詳細" });
    expect(attentionLink({ ...base, kind: "no-adoption" })).toEqual({ to: "/settings/categories/3#topic-7", label: "トピックの設定" });
    expect(attentionLink({ ...base, kind: "uninterpreted" })).toEqual({ to: "/settings/categories/3#topic-7", label: "トピックの設定" });
    expect(attentionLink({ ...base, kind: "google-unresolved", categoryId: null, topicId: null, runId: null })).toBeNull();
  });
});
