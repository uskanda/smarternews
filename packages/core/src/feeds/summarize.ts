// Summaries of feed articles. This is the only place where a model meets what a subscribed feed delivers,
// and it runs after the article is stored, in a line of its own: fetching a feed never waits for a model.
import type { AutoSummarySource } from "../api.ts";
import type { Clock } from "../clock.ts";
import { articleForFullContent, nextArticleToSummarize, recordSummaryFailure, saveAutoSummary, skipAutoSummary } from "../db/articles.ts";
import { transaction, type Database } from "../db/database.ts";
import { replaceMentions } from "../db/mentions.ts";
import { getSettings } from "../db/settings.ts";
import type { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { LlmLimitError, type TaskRunner } from "../llm/runner.ts";
import { SUMMARIZE_INPUT_CHARS } from "../llm/tasks.ts";
import { extractArticle } from "../sources/extract.ts";
import type { FullContentWorker } from "./full-content.ts";

/** Less text than this is not worth a summary: the reader has read it by then. */
export const SUMMARY_MIN_CHARS = 200;

export interface SummaryDeps {
  db: Database;
  clock: Clock;
  fetcher: Fetcher;
  runner: TaskRunner;
  /** Fetches full content. A page the full content is fetched from is the one the summary reads. */
  fullContent: FullContentWorker;
}

/**
 * What one step did: nothing waits, the day's allowance is used up, a summary was stored, the article had
 * too little text, or the call failed.
 */
export type SummaryOutcome = "none" | "limit" | "summarized" | "skipped" | "failed";

type SummaryInput = { text: string; source: AutoSummarySource } | null;

function deliveredText(article: { contentText: string }): SummaryInput {
  const delivered = article.contentText.trim();
  return delivered.length >= SUMMARY_MIN_CHARS ? { text: delivered, source: "feed" } : null;
}

/**
 * The text to summarise. The full content when the article has it; what the feed delivered when fetching
 * it failed; for an article whose feed fetches full content and that has none yet, the full content once it
 * is fetched, so that the page is requested once. Any other article's page is read here, its text used for
 * this one call and kept nowhere. What the feed delivered stands in for a page that cannot be read.
 */
async function textOf(deps: SummaryDeps, pages: PageFetcher, article: { id: number; url: string | null; contentText: string }): Promise<SummaryInput> {
  let full = articleForFullContent(deps.db, article.id);
  if (full.status === null && full.feedFetchesFullContent) {
    await deps.fullContent.fetchFor(article.id);
    full = articleForFullContent(deps.db, article.id);
  }
  if (full.status === "fetched") {
    const text = (full.fullContentText ?? "").slice(0, SUMMARIZE_INPUT_CHARS);
    return text.length >= SUMMARY_MIN_CHARS ? { text, source: "page" } : deliveredText(article);
  }
  if (full.status === "failed") return deliveredText(article);
  if (article.url !== null) {
    const page = await pages.fetchPage(article.url);
    // The page text is used for this one call and kept nowhere.
    const text = page.ok ? extractArticle(page.html, page.url, SUMMARIZE_INPUT_CHARS).text : "";
    if (text.length >= SUMMARY_MIN_CHARS) return { text, source: "page" };
  }
  return deliveredText(article);
}

/**
 * Summarises the newest article that waits and stores the summary. A failure is counted on the article and
 * never thrown: the next step goes on with whatever waits then.
 */
export async function summarizeNext(deps: SummaryDeps, pages: PageFetcher): Promise<SummaryOutcome> {
  const { db, clock, runner } = deps;
  const article = nextArticleToSummarize(db);
  if (!article) return "none";
  // Asked before the page is fetched: a day without allowance sends no request to other sites either.
  if (!runner.canSummarize()) return "limit";
  try {
    const input = await textOf(deps, pages, article);
    if (input === null) {
      skipAutoSummary(db, article.id);
      return "skipped";
    }
    const output = await runner.run(
      "summarize",
      { outputLanguage: getSettings(db).outputLanguage, title: article.title, text: input.text },
      { runId: null, calls: 0 },
    );
    // The names come with the summary, in the same transaction. Names that are not valid are left out.
    transaction(db, () => {
      saveAutoSummary(db, article.id, { text: output.summary, source: input.source, now: clock().toISOString() });
      if (output.mentions !== null) replaceMentions(db, article.id, output.mentions);
    });
    return "summarized";
  } catch (error) {
    // The allowance ran out between the question above and the call, or within the call's second attempt.
    if (error instanceof LlmLimitError) return "limit";
    recordSummaryFailure(db, article.id);
    return "failed";
  }
}

/**
 * Summarises the feed articles that wait, one at a time. Like the poller it looks at a fixed interval and
 * has its own line, apart from the queue of runs and from the fetching of feeds.
 */
export class SummaryWorker {
  readonly #deps: SummaryDeps;
  #tail: Promise<void> = Promise.resolve();
  #roundPending = false;
  #stopped = false;
  #timer: NodeJS.Timeout | undefined;
  #pages: PageFetcher | undefined;
  #pagesDay = "";

  constructor(deps: SummaryDeps) {
    this.#deps = deps;
  }

  /** Starts a round over the articles that wait now, unless one is already waiting or under way. */
  tick(): void {
    if (this.#roundPending) return;
    this.#roundPending = true;
    this.#tail = this.#tail.then(async () => {
      try {
        await this.#round();
      } catch (error) {
        // Nothing may escape: a rejection would stop every round queued behind this one.
        console.error("summary worker:", error);
      } finally {
        this.#roundPending = false;
      }
    });
  }

  /**
   * One article after the other until nothing waits, the day's allowance is used up, or the worker is
   * stopped. A failed call ends the round too: the article is tried again at the next look, not at once.
   */
  async #round(): Promise<void> {
    while (!this.#stopped) {
      const outcome = await summarizeNext(this.#deps, this.#pageFetcher());
      if (outcome !== "summarized" && outcome !== "skipped") return;
    }
  }

  /** One fetcher for this worker. It is replaced once a day, so that a changed robots.txt is read again. */
  #pageFetcher(): PageFetcher {
    const today = this.#deps.clock().toISOString().slice(0, 10);
    if (!this.#pages || this.#pagesDay !== today) {
      this.#pages = new PageFetcher(this.#deps.fetcher, { pagesPerRun: Number.POSITIVE_INFINITY, remember: false });
      this.#pagesDay = today;
    }
    return this.#pages;
  }

  /** True between `start` and `stop`. */
  get running(): boolean {
    return this.#timer !== undefined;
  }

  /** Resolves when every round queued so far is over. */
  idle(): Promise<void> {
    return this.#tail;
  }

  /** Summarises what waits now, then looks again every `intervalMs`. */
  start(intervalMs = 30_000): void {
    this.#stopped = false;
    this.tick();
    this.#timer = setInterval(() => this.tick(), intervalMs);
  }

  /** Stops looking. The article under way is finished; no other is begun. */
  stop(): void {
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
