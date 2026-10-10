import type { Kind } from "../api.ts";
import type { PageFetcher } from "../fetch/pages.ts";
import { normalizeUrl } from "../fetch/url.ts";
import type { CallBudget, TaskRunner } from "../llm/runner.ts";
import { extractArticle } from "./extract.ts";
import type { RawCandidate } from "./types.ts";

export interface LlmSearchDeps {
  runner: TaskRunner;
  budget: CallBudget;
  pages: PageFetcher;
}

export interface LlmSearchInput {
  topicText: string;
  criteria: string;
  kind: Kind;
  windowHours: number | null;
  windowDays: number | null;
  now: Date;
  since: Date | null;
}

/**
 * Candidates from a model that searches the web. The model only proposes URLs: a page becomes a candidate
 * after this code fetched it, and for news its publication time is whatever the page itself states.
 */
export async function collectLlmSearch(deps: LlmSearchDeps, input: LlmSearchInput): Promise<RawCandidate[]> {
  const output = await deps.runner.run(
    "search",
    {
      topicText: input.topicText,
      criteria: input.criteria,
      kind: input.kind,
      windowHours: input.windowHours,
      windowDays: input.windowDays,
      now: input.now.toISOString(),
    },
    deps.budget,
  );
  const candidates: RawCandidate[] = [];
  const listed = new Set<string>();
  for (const result of output.results) {
    const url = normalizeUrl(result.url);
    if (listed.has(url)) continue;
    listed.add(url);
    const page = await deps.pages.fetchPage(url);
    if (!page.ok) continue;
    const extracted = extractArticle(page.html, page.url);
    if (input.kind === "news") {
      if (!extracted.publishedAt) continue;
      if (input.since && extracted.publishedAt < input.since) continue;
    }
    candidates.push({
      url,
      aliases: [],
      fetchable: true,
      title: result.title.trim() || extracted.title,
      snippet: result.snippet.trim(),
      siteName: new URL(url).hostname.replace(/^www\./, ""),
      publishedAt: extracted.publishedAt,
      sourceKind: "llm-search",
    });
  }
  return candidates;
}
