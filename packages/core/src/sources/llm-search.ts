import type { Kind } from "../api.ts";
import type { PageFetcher } from "../fetch/pages.ts";
import { normalizeUrl, siteHost } from "../fetch/url.ts";
import type { CallBudget, TaskRunner } from "../llm/runner.ts";
import { extractArticle } from "./extract.ts";
import type { RawCandidate } from "./types.ts";

export interface LlmSearchDeps {
  runner: TaskRunner;
  budget: CallBudget;
  pages: PageFetcher;
  /** Whether an earlier run of the category settled the URL. Such a page is not fetched again. */
  isSeen: (url: string) => boolean;
}

export interface LlmSearchInput {
  topicText: string;
  criteria: string;
  kind: Kind;
  windowHours: number | null;
  windowDays: number | null;
  now: Date;
  since: Date | null;
  /** The headlines of the topic's latest generated articles, so that the model can leave their pages out. */
  recentHeadlines?: string[];
}

/**
 * Candidates from a model that searches the web. The model only proposes URLs: a page becomes a candidate
 * after this code fetched it, and for news its publication time is whatever the page itself states. A page an
 * earlier run settled is left out before it is fetched, so the run's page limit goes to new pages only, and the
 * number of candidates returned is the number of new ones.
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
      recentHeadlines: input.recentHeadlines ?? [],
    },
    deps.budget,
  );
  const candidates: RawCandidate[] = [];
  const listed = new Set<string>();
  for (const result of output.results) {
    const url = normalizeUrl(result.url);
    if (listed.has(url)) continue;
    listed.add(url);
    if (deps.isSeen(url)) continue;
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
      siteName: siteHost(url),
      publishedAt: extracted.publishedAt,
      sourceKind: "llm-search",
    });
  }
  return candidates;
}
