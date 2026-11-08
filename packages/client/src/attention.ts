import type { AttentionItem } from "@smarternews/core/api";

const ENGINE_LABEL: Record<string, string> = { "google-news": "Google News", "bing-news": "Bing News" };

/** What an attention item points out, in a sentence. */
export function attentionText(item: AttentionItem): string {
  const category = item.categoryName ?? "";
  const topic = `${category}のトピック「${item.topicText ?? ""}」`;
  switch (item.kind) {
    case "run-failed":
      return item.runStatus === "stopped_by_limit"
        ? `${category}の定時の実行が上限で止まりました。`
        : `${category}の定時の実行が失敗しました。やり直しの予定はありません。`;
    case "uninterpreted":
      return `${topic}を解釈できていません。`;
    case "empty-search":
      return item.source === "llm-search"
        ? `${topic}で、LLM検索の結果が3回続けて0件です。`
        : `${topic}で、${ENGINE_LABEL[item.engine ?? ""] ?? item.engine}の検索語「${item.query ?? ""}」の結果が3回続けて0件です。`;
    case "no-adoption":
      return `${topic}で、14日間、記事の作成も更新もありません。`;
    case "google-unresolved":
      return "Google Newsの転送用URLを、3回の実行で続けて1件も解決できませんでした。記事は本文のない要約になります。";
  }
}

/** Where to look into an item: the failed run, or the topic in its category's settings. None for Google News. */
export function attentionLink(item: AttentionItem): { to: string; label: string } | null {
  if (item.kind === "run-failed" && item.runId !== null) return { to: `/runs/${item.runId}`, label: "実行の詳細" };
  if (item.categoryId !== null && item.topicId !== null) return { to: `/settings/categories/${item.categoryId}#topic-${item.topicId}`, label: "トピックの設定" };
  return null;
}
