// Full content of feed articles: the text of an article's page, taken out with Readability and rewritten as
// Markdown by the rules of what a feed delivers. No model is involved anywhere here. Pages are fetched one at a
// time, in a line of their own, apart from the fetching of feeds and from the summaries; an article a reader
// asks for goes before the ones that wait.
import type { FullContentError, FullContentErrorReason, FullContentResult } from "../api.ts";
import type { Clock } from "../clock.ts";
import { articleForFullContent, getArticle, nextArticleForFullContent, recordFullContentFailure, saveFullContent } from "../db/articles.ts";
import type { Database } from "../db/database.ts";
import { getSettings } from "../db/settings.ts";
import type { Fetcher } from "../fetch/http.ts";
import { PageFetcher, type PageResult } from "../fetch/pages.ts";
import { extractArticle } from "../sources/extract.ts";
import { convertContent, MAX_CONTENT_CHARS } from "./content.ts";

export interface FullContentDeps {
  db: Database;
  clock: Clock;
  fetcher: Fetcher;
}

/** Characters as a reader counts them, after runs of white space are made one. */
function chars(text: string): number {
  return [...text.replace(/\s+/g, " ").trim()].length;
}

function failure(reason: FullContentErrorReason, detail: string | null = null): FullContentError {
  return { reason, detail };
}

/** Why a page that could not be had was not had, as the article records it. */
function pageFailure(page: Exclude<PageResult, { ok: true }>): FullContentError {
  switch (page.reason) {
    case "robots":
      return failure("robots");
    case "http":
      return failure("http", String(page.status));
    case "limit":
      // A fetcher of this module has no limit; were one reached, the page was simply not fetched.
      return failure("error", "page limit reached");
    default:
      return failure(page.reason, page.detail);
  }
}

/** The page of an article rewritten as Markdown, or why there is none to store. */
async function contentOf(
  deps: FullContentDeps,
  pages: PageFetcher,
  article: { url: string | null; contentText: string },
): Promise<{ markdown: string; text: string } | FullContentError> {
  if (article.url === null) return failure("no-url");
  const page = await pages.fetchPage(article.url);
  if (!page.ok) return pageFailure(page);
  const extracted = extractArticle(page.html, page.url, MAX_CONTENT_CHARS);
  if (extracted.html.length === 0) return failure("no-content");
  // The same rules as the delivered content: what another site wrote is never kept as HTML.
  const converted = convertContent(extracted.html, page.url, getSettings(deps.db).outputLanguage);
  if (converted.text.length === 0) return failure("no-content");
  const taken = chars(converted.text);
  const delivered = chars(article.contentText);
  // A notice to subscribe, or a part of the page that is not the article, is shorter than the excerpt.
  if (taken < delivered) return failure("shorter", `${taken} < ${delivered}`);
  return converted;
}

/**
 * Fetches the page of one feed article and stores its text as the full content, or records why it could not.
 * An article that has full content is answered from it without a request. Refuses a generated article and
 * one that does not exist. Throws nothing else: a failure is the answer.
 */
export async function fetchFullContent(deps: FullContentDeps, pages: PageFetcher, id: number): Promise<FullContentResult> {
  const { db, clock } = deps;
  const article = articleForFullContent(db, id);
  if (article.status === "fetched") return storedResult(db, id);
  const content = await contentOf(deps, pages, article);
  if ("reason" in content) {
    recordFullContentFailure(db, id, content);
    return { status: "failed", error: content };
  }
  saveFullContent(db, id, { markdown: content.markdown, text: content.text, now: clock().toISOString() });
  return storedResult(db, id);
}

function storedResult(db: Database, id: number): FullContentResult {
  const article = getArticle(db, id);
  if (article.fullContent !== null) return { status: "fetched", fullContent: article.fullContent };
  return { status: "failed", error: article.fullContentError ?? failure("error", "the full content was not stored") };
}

interface Request {
  id: number;
  resolve: (result: FullContentResult) => void;
  reject: (error: unknown) => void;
}

/**
 * Fetches full content one article at a time. It looks at a fixed interval for articles that wait by their
 * feed's setting, the newest first. `fetchFor` asks for one article: it goes right after the article under
 * way, before every one that waits, and a second request for the same article shares the first.
 */
export class FullContentWorker {
  readonly #deps: FullContentDeps;
  /** Asked-for articles, in the order they were asked for. */
  readonly #requests: Request[] = [];
  /** Fetches under way or asked for, by article: a second request waits for the first. */
  readonly #underWay = new Map<number, Promise<FullContentResult>>();
  #lookForWaiting = false;
  #loop: Promise<void> | null = null;
  #stopped = false;
  #timer: NodeJS.Timeout | undefined;
  #pages: PageFetcher | undefined;
  #pagesDay = "";

  constructor(deps: FullContentDeps) {
    this.#deps = deps;
  }

  /** Looks for articles that wait now, unless the worker is stopped. */
  tick(): void {
    if (this.#stopped) return;
    this.#lookForWaiting = true;
    this.#kick();
  }

  /**
   * The full content of one feed article, fetched ahead of the articles that wait, whatever its feed's setting
   * and whether it was read or failed before. An article with full content is answered at once.
   */
  fetchFor(id: number): Promise<FullContentResult> {
    const running = this.#underWay.get(id);
    if (running) return running;
    let article: ReturnType<typeof articleForFullContent>;
    try {
      article = articleForFullContent(this.#deps.db, id);
    } catch (error) {
      return Promise.reject(error);
    }
    if (article.status === "fetched") return Promise.resolve(storedResult(this.#deps.db, id));
    const promise = new Promise<FullContentResult>((resolve, reject) => this.#requests.push({ id, resolve, reject }));
    this.#underWay.set(id, promise);
    this.#kick();
    return promise;
  }

  #kick(): void {
    if (this.#loop) return;
    this.#loop = this.#drain()
      .catch((error: unknown) => console.error("full content worker:", error))
      .finally(() => {
        this.#loop = null;
        // Something may have been asked for between the last look and now.
        if (this.#requests.length > 0 || (this.#lookForWaiting && !this.#stopped)) this.#kick();
      });
  }

  /** One article after the other: the asked-for ones first, then those that wait, until none is left. */
  async #drain(): Promise<void> {
    for (;;) {
      const request = this.#requests.shift();
      if (request) {
        try {
          request.resolve(await fetchFullContent(this.#deps, this.#pageFetcher(), request.id));
        } catch (error) {
          request.reject(error);
        } finally {
          this.#underWay.delete(request.id);
        }
        continue;
      }
      if (!this.#lookForWaiting || this.#stopped) return;
      const next = nextArticleForFullContent(this.#deps.db);
      if (!next) {
        this.#lookForWaiting = false;
        return;
      }
      const promise = fetchFullContent(this.#deps, this.#pageFetcher(), next.id);
      this.#underWay.set(next.id, promise);
      try {
        await promise;
      } catch (error) {
        // Recorded nowhere: the article stays waiting, and the next look tries it again.
        console.error(`full content worker: article ${next.id}:`, error);
        this.#lookForWaiting = false;
      } finally {
        this.#underWay.delete(next.id);
      }
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

  /** Resolves when nothing is under way or asked for. */
  async idle(): Promise<void> {
    while (this.#loop) await this.#loop;
  }

  /** Fetches what waits now, then looks again every `intervalMs`. */
  start(intervalMs = 30_000): void {
    this.#stopped = false;
    this.tick();
    this.#timer = setInterval(() => this.tick(), intervalMs);
  }

  /** Stops looking for articles that wait. The article under way is finished; asked-for ones are still fetched. */
  stop(): void {
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
