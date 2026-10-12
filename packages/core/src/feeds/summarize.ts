// Summaries of feed articles. This is the only place where a model meets what a subscribed feed delivers,
// and it runs after the article is stored, in a line of its own: fetching a feed never waits for a model.
import type { AutoSummarySource } from "../api.ts";
import type { Clock } from "../clock.ts";
import { nextArticleToSummarize, recordSummaryFailure, saveAutoSummary, skipAutoSummary } from "../db/articles.ts";
import type { Database } from "../db/database.ts";
import { getSettings } from "../db/settings.ts";
import type { Fetcher } from "../fetch/http.ts";
import { PageFetcher } from "../fetch/pages.ts";
import { LlmLimitError, type TaskRunner } from "../llm/runner.ts";
import { SUMMARIZE_INPUT_CHARS } from "../llm/tasks.ts";
import { extractArticle } from "../sources/extract.ts";

/** Less text than this is not worth a summary: the reader has read it by then. */
export const SUMMARY_MIN_CHARS = 200;

export interface SummaryDeps {
  db: Database;
  clock: Clock;
  fetcher: Fetcher;
  runner: TaskRunner;
}

/**
 * What one step did: nothing waits, the day's allowance is used up, a summary was stored, the article had
 * too little text, or the call failed.
 */
export type SummaryOutcome = "none" | "limit" | "summarized" | "skipped" | "failed";

/** The text to summarise: the article's page when it can be read, else what the feed delivered. */
async function textOf(pages: PageFetcher, article: { url: string | null; contentText: string }): Promise<{ text: string; source: AutoSummarySource } | null> {
  if (article.url !== null) {
    const page = await pages.fetchPage(article.url);
    // The page text is used for this one call and kept nowhere.
    const text = page.ok ? extractArticle(page.html, page.url, SUMMARIZE_INPUT_CHARS).text : "";
    if (text.length >= SUMMARY_MIN_CHARS) return { text, source: "page" };
  }
  const delivered = article.contentText.trim();
  return delivered.length >= SUMMARY_MIN_CHARS ? { text: delivered, source: "feed" } : null;
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
    const input = await textOf(pages, article);
    if (input === null) {
      skipAutoSummary(db, article.id);
      return "skipped";
    }
    const output = await runner.run(
      "summarize",
      { outputLanguage: getSettings(db).outputLanguage, title: article.title, text: input.text },
      { runId: null, calls: 0 },
    );
    saveAutoSummary(db, article.id, { text: output.summary, source: input.source, now: clock().toISOString() });
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
