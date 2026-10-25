// One run of one category: collect candidates, judge them, group them into stories and write the articles.
// Everything here is ordinary code except the five task calls made through the TaskRunner.
import type { Category, Run, RunFailure, Settings, Topic } from "../api.ts";
import type { Clock } from "../clock.ts";
import {
  findEventByKey,
  insertArticle,
  openEventArticles,
  recentNewsArticles,
  reviseArticle,
  type ArticleDigest,
  type EventFields,
} from "../db/articles.ts";
import {
  acceptCandidates,
  insertCandidate,
  isSeenUrl,
  listPending,
  markSeen,
  rejectCandidates,
  setCandidateBody,
  type PendingCandidate,
} from "../db/candidates.ts";
import { getCategory } from "../db/categories.ts";
import { transaction, type Database } from "../db/database.ts";
import { finishRun, getRun, startRun } from "../db/runs.ts";
import { getSettings } from "../db/settings.ts";
import { applyInterpretation, listTopics } from "../db/topics.ts";
import type { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { LlmLimitError, type CallBudget, type TaskRunner } from "../llm/runner.ts";
import { extractArticle } from "../sources/extract.ts";
import { collectFeed } from "../sources/feed.ts";
import { collectLlmSearch } from "../sources/llm-search.ts";
import { collectNews, type NewsEngine } from "../sources/news-search.ts";
import type { CollectWindow, RawCandidate } from "../sources/types.ts";
import { resolveEvent } from "./events.ts";
import { reasonText, type ReasonCode } from "./reasons.ts";

export interface PipelineConfig {
  limits: { judgeBatchSize: number; pagesPerRun: number };
  newsSearch: { engines: NewsEngine[]; maxResultsPerQuery: number };
}

export interface PipelineDeps {
  db: Database;
  clock: Clock;
  runner: TaskRunner;
  fetcher: Fetcher;
  config: PipelineConfig;
}

const HOUR = 3_600_000;
/** A follow-up within this time of the first publication updates the article; a later one starts a new article. */
const UPDATE_WINDOW_MS = 72 * HOUR;
/** How far back published news articles are offered to the grouping step. */
const FOLLOW_UP_LOOKBACK_MS = 14 * 24 * HOUR;
/** Event announcements appear long before the event, so news search looks this far back for them. */
const EVENT_SEARCH_HOURS = 30 * 24;

interface Context extends PipelineDeps {
  run: Run;
  category: Category;
  settings: Settings;
  now: Date;
  budget: CallBudget;
  pages: PageFetcher;
  failures: RunFailure[];
  stats: { collected: number; rejected: number; created: number; updated: number };
  sources: { attempted: number; failed: number };
}

interface Found {
  candidate: RawCandidate;
  topicIds: Set<number>;
  aliases: Set<string>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Records a failure and carries on, except when an allowance of model calls ran out: that ends the run. */
function fail(ctx: Context, stage: string, target: string | null, error: unknown): void {
  if (error instanceof LlmLimitError) throw error;
  ctx.failures.push({ stage, target, message: message(error) });
}

// ---- 1. interpret ------------------------------------------------------------------------------

async function interpretTopics(ctx: Context): Promise<Topic[]> {
  const ready: Topic[] = [];
  for (const topic of listTopics(ctx.db, ctx.category.id).filter((candidate) => candidate.enabled)) {
    if (topic.interpreted) {
      ready.push(topic);
      continue;
    }
    try {
      const output = await ctx.runner.run(
        "interpret",
        { topicText: topic.text, kind: ctx.category.kind, search: topic.search ?? ctx.settings.search },
        ctx.budget,
      );
      ready.push(applyInterpretation(ctx.db, topic.id, output));
    } catch (error) {
      fail(ctx, "interpret", topic.text, error);
    }
  }
  return ready;
}

// ---- 2 and 3. collect, merge, drop what is settled ---------------------------------------------

async function collect(ctx: Context, topics: Topic[]): Promise<Found[]> {
  const isNews = ctx.category.kind === "news";
  const windowHours = ctx.category.windowHours ?? 24;
  const window: CollectWindow = isNews
    ? { since: new Date(ctx.now.getTime() - windowHours * HOUR), hours: windowHours }
    : { since: null, hours: EVENT_SEARCH_HOURS };
  const isSeen = (url: string) => isSeenUrl(ctx.db, ctx.category.id, url);
  const found = new Map<string, Found>();

  const attempt = async (topic: Topic, stage: string, target: string, load: () => Promise<RawCandidate[]>) => {
    ctx.sources.attempted += 1;
    try {
      for (const candidate of await load()) {
        const entry = found.get(candidate.url) ?? { candidate, topicIds: new Set<number>(), aliases: new Set<string>() };
        entry.topicIds.add(topic.id);
        for (const alias of candidate.aliases) entry.aliases.add(alias);
        found.set(candidate.url, entry);
      }
    } catch (error) {
      ctx.sources.failed += 1;
      fail(ctx, stage, target, error);
    }
  };

  for (const topic of topics) {
    for (const feedUrl of topic.sources.feeds) {
      await attempt(topic, "feed", feedUrl, () => collectFeed(ctx.fetcher, feedUrl, window.since));
    }
    if (topic.sources.newsSearch) {
      const locale = topic.search ?? ctx.settings.search;
      const { engines, maxResultsPerQuery } = ctx.config.newsSearch;
      for (const query of topic.queries) {
        // Each engine is a source of its own, so one that fails leaves the results of the others.
        for (const engine of engines) {
          await attempt(topic, "news-search", `${engine}: ${query}`, () =>
            collectNews({ fetcher: ctx.fetcher, isSeen, engine, maxResultsPerQuery }, query, locale, window),
          );
        }
      }
    }
    if (topic.sources.llmSearch) {
      await attempt(topic, "llm-search", topic.text, () => {
        if (!ctx.runner.canSearch()) throw new Error("the provider assigned to the search task cannot search the web");
        return collectLlmSearch(
          { runner: ctx.runner, budget: ctx.budget, pages: ctx.pages },
          {
            topicText: topic.text,
            criteria: topic.criteria,
            kind: ctx.category.kind,
            windowHours: ctx.category.windowHours,
            windowDays: ctx.category.windowDays,
            now: ctx.now,
            since: window.since,
          },
        );
      });
    }
  }

  const fresh = [...found.values()].filter((entry) => !isSeen(entry.candidate.url) && ![...entry.aliases].some(isSeen));
  ctx.stats.collected = fresh.length;
  if (!isNews) return fresh;

  // News without a publication time cannot be placed in the window: rejected before any model sees it.
  const dated: Found[] = [];
  for (const entry of fresh) {
    if (entry.candidate.publishedAt) dated.push(entry);
    else store(ctx, entry, "rejected", reasonText("no-date", ctx.settings.outputLanguage), null);
  }
  return dated;
}

/** Saves a candidate whose judgement is settled and remembers its URLs so that it is not judged again. */
function store(ctx: Context, entry: Found, status: "rejected" | "pending", reason: string, importance: number | null): void {
  const { candidate } = entry;
  const now = ctx.now.toISOString();
  insertCandidate(ctx.db, {
    categoryId: ctx.category.id,
    runId: ctx.run.id,
    url: candidate.url,
    fetchable: candidate.fetchable,
    title: candidate.title,
    snippet: candidate.snippet,
    siteName: candidate.siteName,
    publishedAt: candidate.publishedAt?.toISOString() ?? null,
    sourceKind: candidate.sourceKind,
    status,
    reason,
    importance,
    topicIds: [...entry.topicIds],
    now,
  });
  markSeen(ctx.db, ctx.category.id, [candidate.url, ...entry.aliases], now);
  if (status === "rejected") ctx.stats.rejected += 1;
}

// ---- 4. judge ----------------------------------------------------------------------------------

async function judge(ctx: Context, fresh: Found[], topics: Topic[]): Promise<void> {
  const size = ctx.config.limits.judgeBatchSize;
  for (let offset = 0; offset < fresh.length; offset += size) {
    const batch = fresh.slice(offset, offset + size);
    const topicIds = new Set(batch.flatMap((entry) => [...entry.topicIds]));
    try {
      const output = await ctx.runner.run(
        "judge",
        {
          kind: ctx.category.kind,
          outputLanguage: ctx.settings.outputLanguage,
          readerInfo: ctx.settings.readerInfo,
          now: ctx.now.toISOString(),
          timeZone: ctx.settings.timeZone,
          topics: topics.filter((topic) => topicIds.has(topic.id)).map((topic) => ({ id: topic.id, text: topic.text, criteria: topic.criteria })),
          candidates: batch.map((entry, index) => ({
            id: offset + index + 1,
            title: entry.candidate.title,
            snippet: entry.candidate.snippet,
            siteName: entry.candidate.siteName,
            publishedAt: entry.candidate.publishedAt?.toISOString() ?? null,
            topicIds: [...entry.topicIds],
          })),
        },
        ctx.budget,
      );
      transaction(ctx.db, () => {
        for (const judgment of output.judgments) {
          const entry = fresh[judgment.id - 1]!;
          store(ctx, entry, judgment.relevant ? "pending" : "rejected", judgment.reason, judgment.importance);
        }
      });
    } catch (error) {
      // The batch stays unjudged and unseen, so a later run collects and judges it again.
      fail(ctx, "judge", null, error);
    }
  }
}

// ---- 5 and 6. group into stories and select ----------------------------------------------------

interface Story {
  candidates: PendingCandidate[];
  importance: number;
  /** The published article this story continues, if any. */
  existing: ArticleDigest | null;
  /** update: rewrite `existing`. follow: new article that points back to `existing`. new: no earlier article. */
  mode: "new" | "update" | "follow";
}

async function groupStories(ctx: Context, pending: PendingCandidate[]): Promise<Story[] | null> {
  const isNews = ctx.category.kind === "news";
  const existing = isNews
    ? recentNewsArticles(ctx.db, ctx.category.id, new Date(ctx.now.getTime() - FOLLOW_UP_LOOKBACK_MS).toISOString())
    : openEventArticles(ctx.db, ctx.category.id, ctx.now.toISOString());

  let groups: Array<{ candidateIds: number[]; existingArticleId: number | null }>;
  if (pending.length === 1 && existing.length === 0) {
    groups = [{ candidateIds: [pending[0]!.id], existingArticleId: null }];
  } else {
    try {
      const output = await ctx.runner.run(
        "cluster",
        {
          kind: ctx.category.kind,
          candidates: pending.map(({ id, title, snippet, siteName, publishedAt }) => ({ id, title, snippet, siteName, publishedAt })),
          existingArticles: existing.map(({ id, title, summary }) => ({ id, title, summary })),
        },
        ctx.budget,
      );
      groups = output.groups;
    } catch (error) {
      fail(ctx, "cluster", null, error);
      return null;
    }
  }

  const byId = new Map(pending.map((candidate) => [candidate.id, candidate]));
  const articles = new Map(existing.map((article) => [article.id, article]));
  const placed = new Set<number>();
  const held = new Set<number>();
  const stories: Story[] = [];
  const build = (candidates: PendingCandidate[], article: ArticleDigest | null): Story => {
    const withinWindow = article !== null && ctx.now.getTime() - new Date(article.firstPublishedAt).getTime() <= UPDATE_WINDOW_MS;
    return {
      candidates,
      importance: Math.max(...candidates.map((candidate) => candidate.importance)),
      existing: article,
      mode: article === null ? "new" : !isNews || withinWindow ? "update" : "follow",
    };
  };

  let invalid = 0;
  for (const group of groups) {
    const members = group.candidateIds.map((id) => byId.get(id));
    const article = group.existingArticleId === null ? null : articles.get(group.existingArticleId);
    const usable = members.every((member) => member !== undefined && !placed.has(member.id) && !held.has(member.id)) && article !== undefined;
    if (!usable) {
      // A group that names something unknown is not trusted: its real candidates wait for the next run.
      invalid += 1;
      for (const member of members) if (member && !placed.has(member.id)) held.add(member.id);
      continue;
    }
    for (const member of members) placed.add(member!.id);
    stories.push(build(members as PendingCandidate[], article ?? null));
  }
  if (invalid > 0) {
    ctx.failures.push({ stage: "cluster", target: null, message: `${invalid} group(s) named an unknown candidate or article` });
  }
  // A candidate the model left out of every group is a story of its own.
  for (const candidate of pending) {
    if (!placed.has(candidate.id) && !held.has(candidate.id)) stories.push(build([candidate], null));
  }
  return stories;
}

function reject(ctx: Context, story: Story, code: ReasonCode): void {
  rejectCandidates(
    ctx.db,
    story.candidates.map((candidate) => candidate.id),
    reasonText(code, ctx.settings.outputLanguage),
    ctx.run.id,
  );
  ctx.stats.rejected += story.candidates.length;
}

// ---- 7 and 8. fetch pages and write ------------------------------------------------------------

/** The text given to the writer for each page: the extracted body when it can be had, else the snippet. */
async function loadSources(ctx: Context, story: Story) {
  let anyBody = false;
  const sources = [];
  for (const candidate of story.candidates) {
    let text = "";
    if (candidate.fetchable) {
      const page = await ctx.pages.fetchPage(candidate.url);
      if (page.ok) text = extractArticle(page.html, page.url).text;
    }
    if (text.length > 0) {
      anyBody = true;
      setCandidateBody(ctx.db, candidate.id, text);
    }
    sources.push({
      title: candidate.title,
      siteName: candidate.siteName,
      url: candidate.url,
      publishedAt: candidate.publishedAt,
      text: text || candidate.snippet || candidate.title,
    });
  }
  return { sources, snippetOnly: !anyBody };
}

async function writeStories(ctx: Context): Promise<void> {
  const pending = listPending(ctx.db, ctx.category.id);
  if (pending.length === 0) return;
  const stories = await groupStories(ctx, pending);
  if (!stories) return;

  const order = (a: PendingCandidate, b: PendingCandidate) =>
    b.importance - a.importance || (a.publishedAt ?? "9").localeCompare(b.publishedAt ?? "9") || a.id - b.id;
  for (const story of stories) story.candidates.sort(order);
  stories.sort((a, b) => b.importance - a.importance || a.candidates[0]!.id - b.candidates[0]!.id);

  const hasReader = ctx.settings.readerInfo.trim().length > 0;
  let storyNumber = 0;
  for (const story of stories) {
    storyNumber += 1;
    if (story.importance < ctx.category.minImportance) {
      reject(ctx, story, "below-minimum");
      continue;
    }
    if (story.mode !== "update" && ctx.stats.created >= ctx.category.maxArticlesPerRun) {
      reject(ctx, story, "over-limit");
      continue;
    }

    const { sources, snippetOnly } = await loadSources(ctx, story);
    let output;
    try {
      output = await ctx.runner.run(
        "write",
        {
          kind: ctx.category.kind,
          outputLanguage: ctx.settings.outputLanguage,
          readerInfo: ctx.settings.readerInfo,
          now: ctx.now.toISOString(),
          timeZone: ctx.settings.timeZone,
          sources,
          existingArticle: story.mode === "update" && story.existing ? story.existing : null,
        },
        ctx.budget,
      );
    } catch (error) {
      // The candidates stay pending, so the next run tries this story again.
      fail(ctx, "write", story.candidates[0]!.title, error);
      continue;
    }

    let event: EventFields | null = null;
    if (ctx.category.kind === "event") {
      const resolved = resolveEvent(output.event, {
        now: ctx.now,
        timeZone: ctx.settings.timeZone,
        windowDays: ctx.category.windowDays ?? 7,
      });
      if (!resolved.ok) {
        reject(ctx, story, resolved.reason);
        continue;
      }
      event = resolved.event;
      // The same event found again under another headline: add to its article instead of duplicating it.
      const sameEvent = story.mode === "update" ? null : findEventByKey(ctx.db, ctx.category.id, event.key);
      if (sameEvent) {
        story.existing = sameEvent;
        story.mode = "update";
      }
    }

    const content = {
      title: output.title,
      summary: output.summary,
      body: output.body,
      impact: hasReader ? output.impact?.trim() || null : null,
      importance: story.importance,
      unconfirmed: output.unconfirmed,
      snippetOnly,
      event,
      now: ctx.now.toISOString(),
      refs: story.candidates.map((candidate) => ({
        url: candidate.url,
        siteName: candidate.siteName,
        title: candidate.title,
        publishedAt: candidate.publishedAt,
      })),
      topicIds: [...new Set(story.candidates.flatMap((candidate) => candidate.topicIds))],
    };
    const candidateIds = story.candidates.map((candidate) => candidate.id);
    const groupKey = `${ctx.run.id}:${storyNumber}`;
    transaction(ctx.db, () => {
      if (story.mode === "update" && story.existing) {
        reviseArticle(ctx.db, story.existing.id, content);
        acceptCandidates(ctx.db, candidateIds, story.existing.id, groupKey, ctx.run.id);
        return;
      }
      const articleId = insertArticle(ctx.db, {
        ...content,
        categoryId: ctx.category.id,
        kind: ctx.category.kind,
        previousArticleId: story.mode === "follow" ? (story.existing?.id ?? null) : null,
      });
      acceptCandidates(ctx.db, candidateIds, articleId, groupKey, ctx.run.id);
    });
    if (story.mode === "update") ctx.stats.updated += 1;
    else ctx.stats.created += 1;
  }
}

// ---- the run -----------------------------------------------------------------------------------

export async function executeRun(deps: PipelineDeps, runId: number): Promise<Run> {
  const run = getRun(deps.db, runId);
  const now = deps.clock();
  startRun(deps.db, runId, now.toISOString());
  const ctx: Context = {
    ...deps,
    run,
    category: getCategory(deps.db, run.categoryId),
    settings: getSettings(deps.db),
    now,
    budget: { runId, calls: 0 },
    pages: new PageFetcher(deps.fetcher, { pagesPerRun: deps.config.limits.pagesPerRun }),
    failures: [],
    stats: { collected: 0, rejected: 0, created: 0, updated: 0 },
    sources: { attempted: 0, failed: 0 },
  };

  let stoppedByLimit = false;
  let crashed = false;
  try {
    const topics = await interpretTopics(ctx);
    const fresh = await collect(ctx, topics);
    await judge(ctx, fresh, topics);
    await writeStories(ctx);
  } catch (error) {
    if (error instanceof LlmLimitError) {
      stoppedByLimit = true;
    } else {
      crashed = true;
      ctx.failures.push({ stage: "run", target: null, message: message(error) });
    }
  }

  const nothingCameIn =
    ctx.sources.attempted > 0 && ctx.sources.failed === ctx.sources.attempted && ctx.stats.created + ctx.stats.updated === 0;
  const status = stoppedByLimit
    ? "stopped_by_limit"
    : crashed || nothingCameIn
      ? "failed"
      : ctx.failures.length > 0
        ? "partial"
        : "succeeded";
  return finishRun(deps.db, runId, {
    status,
    finishedAt: deps.clock().toISOString(),
    collected: ctx.stats.collected,
    rejected: ctx.stats.rejected,
    articlesCreated: ctx.stats.created,
    articlesUpdated: ctx.stats.updated,
    llmCalls: ctx.budget.calls,
    failures: ctx.failures,
  });
}
