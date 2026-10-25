import type { Article, Candidate, CategoryCreate, Kind, Run, SearchLocale, TaskName, Topic } from "../api.ts";
import { getArticle, listArticleIds } from "../db/articles.ts";
import { listRunCandidates } from "../db/candidates.ts";
import { createCategory } from "../db/categories.ts";
import { createRun } from "../db/runs.ts";
import { updateSettings } from "../db/settings.ts";
import { createTopic } from "../db/topics.ts";
import { Fetcher } from "../fetch/http.ts";
import type { LlmRequest } from "../llm/adapter.ts";
import type { ModelPricing } from "../llm/pricing.ts";
import type { JudgeOutput, WriteOutput } from "../llm/tasks.ts";
import { executeRun, type PipelineConfig } from "../pipeline/run.ts";
import { createTestDb, fakeClock } from "./db.ts";
import { fakeFetch, html, xml } from "./http.ts";
import { fakeLlm, materialLines, type FakeHandler } from "./llm.ts";

export interface FeedItemSpec {
  title: string;
  link: string;
  /** ISO time, or null for an item without a date. Defaults to one hour before the harness clock. */
  published?: string | null;
  description?: string;
}

const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function rssDocument(title: string, items: FeedItemSpec[], defaultPublished: string): string {
  const body = items
    .map((item) => {
      const published = item.published === undefined ? defaultPublished : item.published;
      return [
        "<item>",
        `<title>${escapeXml(item.title)}</title>`,
        `<link>${escapeXml(item.link)}</link>`,
        `<description>${escapeXml(item.description ?? `Snippet of ${item.title}`)}</description>`,
        published === null ? "" : `<pubDate>${new Date(published).toUTCString()}</pubDate>`,
        "</item>",
      ].join("");
    })
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${escapeXml(title)}</title>${body}</channel></rss>`;
}

/** A Bing News answer. The harness uses Bing in tests because its links need no second request to resolve. */
export function bingDocument(items: FeedItemSpec[], defaultPublished: string): string {
  const body = items
    .map((item) => {
      const published = item.published === undefined ? defaultPublished : item.published;
      const link = `http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=${encodeURIComponent(item.link)}&c=1`;
      return [
        "<item>",
        `<title>${escapeXml(item.title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<description>${escapeXml(item.description ?? `Snippet of ${item.title}`)}</description>`,
        published === null ? "" : `<pubDate>${new Date(published).toUTCString()}</pubDate>`,
        "<News:Source>Example Outlet</News:Source>",
        "</item>",
      ].join("");
    })
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news"><channel><title>Bing</title>${body}</channel></rss>`;
}

/**
 * A Google News answer. Each link is a redirect whose article id is the item's link in base64url, which the
 * harness's `googleNews` routes trade back for the link.
 */
export function googleDocument(items: FeedItemSpec[], defaultPublished: string): string {
  const body = items
    .map((item) => {
      const published = item.published === undefined ? defaultPublished : item.published;
      const link = `https://news.google.com/rss/articles/${Buffer.from(item.link).toString("base64url")}?oc=5`;
      return [
        "<item>",
        `<title>${escapeXml(item.title)} - Example Outlet</title>`,
        `<link>${escapeXml(link)}</link>`,
        published === null ? "" : `<pubDate>${new Date(published).toUTCString()}</pubDate>`,
        `<source url="https://outlet.example.org">Example Outlet</source>`,
        "</item>",
      ].join("");
    })
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Google News</title>${body}</channel></rss>`;
}

/** The article id that a Google News redirect resolution asks about, read from the request body. */
function googleArticleId(body: string | null): string {
  const outer = JSON.parse(decodeURIComponent((body ?? "").replace(/^f\.req=/, ""))) as [[[string, string]]];
  return (JSON.parse(outer[0][0][1]) as unknown[])[2] as string;
}

/** A page long enough for the extractor, with the given sentence in its article text. */
export function articlePage(sentence: string, published?: string): string {
  const meta = published ? `<meta property="article:published_time" content="${published}">` : "";
  const filler =
    "Engineers who run the affected systems were told to review their configuration and to watch the vendor's advisory for further details as the work continues.";
  return `<html><head><title>Page</title>${meta}</head><body><article><h1>Report</h1><p>${sentence}</p><p>${filler}</p><p>${filler}</p></article></body></html>`;
}

interface JudgeCandidate {
  id: number;
  title: string;
}

/**
 * Default model behaviour, steered by markers in headlines so that a test reads like its scenario:
 *   [skip]     the judge calls the page not relevant
 *   [i4]       the judge gives importance 4 (default 3)
 *   {story-a}  the cluster step groups pages, and matches published articles, by this key
 */
export const defaultHandlers: Record<Exclude<TaskName, "search" | "summarize" | "translate">, FakeHandler> = {
  interpret: () => ({ queries: ["default query"], criteria: "default criteria", suggestedSources: { newsSearch: false, llmSearch: false } }),
  judge: (request): JudgeOutput => ({
    judgments: materialLines<JudgeCandidate>(request.prompt).map((candidate) => ({
      id: candidate.id,
      relevant: !candidate.title.includes("[skip]"),
      reason: candidate.title.includes("[skip]") ? "advertising without new information" : "matches the topic",
      importance: Number(/\[i(\d)\]/.exec(candidate.title)?.[1] ?? 3),
    })),
  }),
  cluster: (request) => {
    const key = (title: string) => /\{([\w-]+)\}/.exec(title)?.[1] ?? null;
    const existing = materialLines<JudgeCandidate>(request.prompt, 1);
    const groups = new Map<string, number[]>();
    for (const candidate of materialLines<JudgeCandidate>(request.prompt, 0)) {
      const name = key(candidate.title) ?? `single-${candidate.id}`;
      groups.set(name, [...(groups.get(name) ?? []), candidate.id]);
    }
    return {
      groups: [...groups.entries()].map(([name, candidateIds]) => ({
        candidateIds,
        existingArticleId: existing.find((article) => key(article.title) === name)?.id ?? null,
      })),
    };
  },
  write: (request): WriteOutput => {
    const sources = sourcesIn(request);
    return {
      title: sources[0]?.title ?? "Untitled",
      summary: `Summary of ${sources.length} source(s).`,
      body: "Body paragraph.",
      unconfirmed: false,
      impact: null,
      event: null,
    };
  },
};

/** The sources a write prompt lists, with the text handed over for each. */
export function sourcesIn(request: LlmRequest): Array<{ title: string; site: string; url: string; published: string | null; text: string }> {
  return [...request.prompt.matchAll(/^Source: (\{.*\})\n<material>\n([\s\S]*?)\n<\/material>/gm)].map((match) => ({
    ...(JSON.parse(match[1]!) as { title: string; site: string; url: string; published: string | null }),
    text: match[2]!,
  }));
}

export interface HarnessOptions {
  kind?: Kind;
  category?: Partial<CategoryCreate>;
  readerInfo?: string;
  outputLanguage?: string;
  search?: SearchLocale;
  now?: string;
  config?: Partial<PipelineConfig["limits"]>;
  /** Bing News alone unless given: its links need no second request to resolve. */
  newsSearch?: Partial<PipelineConfig["newsSearch"]>;
  llmLimits?: { llmCallsPerRun: number; llmCallsPerDay: number };
  webSearch?: boolean;
  /** Makes every provider one that costs money, at these prices. */
  llmPricing?: ModelPricing;
}

export function pipelineHarness(options: HarnessOptions = {}) {
  const db = createTestDb();
  const clock = fakeClock(options.now ?? "2026-03-01T12:00:00.000Z");
  updateSettings(db, {
    readerInfo: options.readerInfo ?? "",
    outputLanguage: options.outputLanguage ?? "en",
    timeZone: "UTC",
    search: options.search ?? { language: "en", region: "US" },
  });
  const category = createCategory(db, { name: "Test", slug: "test", kind: options.kind ?? "news", ...options.category }, clock);

  const routes: Record<string, Parameters<typeof fakeFetch>[0][string]> = {};
  const fake = fakeFetch(routes, clock);
  const fetcher = new Fetcher({ userAgent: "test", hostIntervalMs: 0, timeoutMs: 1000, maxBytes: 1_000_000, fetchImpl: fake.fetchImpl });

  const handlers: Partial<Record<TaskName, FakeHandler>> = { ...defaultHandlers };
  const llm = fakeLlm(db, clock, handlers, { limits: options.llmLimits, webSearch: options.webSearch, pricing: options.llmPricing });
  const config: PipelineConfig = {
    limits: { judgeBatchSize: 30, pagesPerRun: 20, ...options.config },
    newsSearch: { engines: ["bing-news"], maxResultsPerQuery: 20, ...options.newsSearch },
  };

  return {
    db,
    clock,
    category,
    routes,
    handlers,
    requests: llm.requests,
    runner: llm.runner,
    urls: fake.urls,
    /** Adds a topic that is already interpreted unless `interpreted: false` is given. */
    addTopic(
      text: string,
      topic: { feeds?: string[]; newsSearch?: boolean; llmSearch?: boolean; interpreted?: boolean; queries?: string[]; criteria?: string; search?: SearchLocale; enabled?: boolean } = {},
    ): Topic {
      return createTopic(
        db,
        category.id,
        {
          text,
          enabled: topic.enabled,
          search: topic.search,
          // Sources are passed only when the test names one, so that an interpretation can still suggest them.
          ...(topic.feeds !== undefined || topic.newsSearch !== undefined || topic.llmSearch !== undefined
            ? { sources: { feeds: topic.feeds ?? [], newsSearch: topic.newsSearch ?? false, llmSearch: topic.llmSearch ?? false } }
            : {}),
          ...(topic.interpreted === false
            ? {}
            : { interpretation: { queries: topic.queries ?? [text], criteria: topic.criteria ?? `criteria for ${text}` } }),
        },
        clock,
      );
    },
    /** Serves an RSS feed at `url`. Items default to one hour old. */
    feed(url: string, items: FeedItemSpec[], title = "Example Feed"): void {
      routes[url] = () => xml(rssDocument(title, items, new Date(clock().getTime() - 3_600_000).toISOString()));
    },
    /** Serves news search results, keyed by the query text. Queries not listed find nothing. */
    news(resultsByQuery: Record<string, FeedItemSpec[]>): void {
      routes["https://www.bing.com/news/search"] = (request) => {
        const query = new URL(request.url).searchParams.get("q") ?? "";
        return xml(bingDocument(resultsByQuery[query] ?? [], new Date(clock().getTime() - 3_600_000).toISOString()));
      };
    },
    /** Serves Google News results keyed by the query text, and resolves their redirect links to the items' links. */
    googleNews(resultsByQuery: Record<string, FeedItemSpec[]>): void {
      routes["https://news.google.com/rss/search"] = (request) => {
        const query = (new URL(request.url).searchParams.get("q") ?? "").replace(/ when:\S+$/, "");
        return xml(googleDocument(resultsByQuery[query] ?? [], new Date(clock().getTime() - 3_600_000).toISOString()));
      };
      routes["https://news.google.com/rss/articles/"] = (request) => {
        const id = new URL(request.url).pathname.split("/").pop() ?? "";
        return html(`<html><body><div data-n-a-sg="${id}" data-n-a-ts="1700000000"></div></body></html>`);
      };
      routes["https://news.google.com/_/DotsSplashUi/data/batchexecute"] = (request) => {
        const link = Buffer.from(googleArticleId(request.body), "base64url").toString();
        const payload = JSON.stringify(JSON.stringify(["garturlres", link, 1]));
        return new Response(`)]}'\n\n[["wrb.fr","Fbv4je",${payload},null,null,null,"generic"]]`, { status: 200 });
      };
    },
    page(url: string, sentence: string, published?: string): void {
      routes[url] = () => html(articlePage(sentence, published));
    },
    async run(): Promise<Run> {
      const run = createRun(db, { categoryId: category.id, trigger: "manual", slot: null }, clock);
      return executeRun({ db, clock, runner: llm.runner, fetcher, config }, run.id);
    },
    /** Carries out a run that is already recorded, as the queue does. */
    execute(runId: number): Promise<Run> {
      return executeRun({ db, clock, runner: llm.runner, fetcher, config }, runId);
    },
    articles(): Article[] {
      return listArticleIds(db, category.id).map((id) => getArticle(db, id));
    },
    candidates(runId: number, status?: Candidate["status"]): Candidate[] {
      return listRunCandidates(db, runId, status);
    },
  };
}

export type Harness = ReturnType<typeof pipelineHarness>;
