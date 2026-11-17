// Digests: at the times of the settings, one call of the digest task sums up the articles of a period. Like the
// summaries of feed articles, they are made in a line of their own, apart from the queue of runs.
import type { DigestRequestResult, DigestSection, DigestTarget, DigestTargetRequest, DigestTrigger } from "../api.ts";
import type { Clock } from "../clock.ts";
import { listCategories } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import {
  digestArticles,
  digestPeriodStart,
  hasDigestForSlot,
  listDigestArticles,
  saveDigest,
  type DigestArticle,
} from "../db/digests.ts";
import { getSettings } from "../db/settings.ts";
import { LlmLimitError, type TaskRunner } from "../llm/runner.ts";
import { CATCH_UP_MS, latestSlot } from "../runs/scheduler.ts";

export interface DigestDeps {
  db: Database;
  clock: Clock;
  runner: TaskRunner;
  log?: (message: string, error: unknown) => void;
}

/**
 * What one attempt did: a digest was stored; or none was, because the period held no article, the day used
 * its allowance, the budget period used up its budget, or the call failed.
 */
export type DigestOutcome = { status: "created"; id: number } | { status: "empty" | "limit" | "budget" | "failed" };

/** What made a digest, the scheduled time it is for, and, for a digest of a list, the list. */
export interface DigestRequestOptions {
  trigger: DigestTrigger;
  slot: string | null;
  target?: DigestTargetRequest;
}

/**
 * Makes one digest of the period that ends now, or of the list given, and stores it. The model is not called
 * for a period or a list without articles, nor once an allowance is used up. Ids of source articles that were not in the input are dropped, and
 * the sections are put in the order of the categories. Nothing is thrown: a failure is recorded with the call.
 */
export async function makeDigest(deps: DigestDeps, options: DigestRequestOptions): Promise<DigestOutcome> {
  const { db, clock, runner } = deps;
  const now = clock();
  const gathered = gather(db, now, options.target);
  if (gathered === null) return { status: "empty" };
  const { articles, period, target } = gathered;
  const blocked = runner.digestBlocked();
  if (blocked !== null) return { status: blocked };

  const settings = getSettings(db);
  const withArticles = new Set(articles.map((article) => article.categoryId));
  const categories = listCategories(db).filter((category) => category.enabled && withArticles.has(category.id));
  let output;
  try {
    output = await runner.run(
      "digest",
      {
        outputLanguage: settings.outputLanguage,
        readerInfo: settings.readerInfo,
        now: now.toISOString(),
        timeZone: settings.timeZone,
        periodStart: period.start,
        periodEnd: period.end,
        ...(target === null ? {} : { scope: target.label }),
        categories: categories.map((category) => ({ id: category.id, name: category.name })),
        articles,
      },
      { runId: null, calls: 0 },
    );
  } catch (error) {
    if (error instanceof LlmLimitError) return { status: error.scope === "budget" ? "budget" : "limit" };
    (deps.log ?? console.error)("digest: the digest task failed:", error);
    return { status: "failed" };
  }

  const given = new Set(articles.map((article) => article.id));
  const order = new Map(categories.map((category, index) => [category.id, index]));
  const sections: DigestSection[] = [...output.sections]
    .sort((a, b) => order.get(a.categoryId)! - order.get(b.categoryId)!)
    .map((section) => ({
      categoryId: section.categoryId,
      categoryName: categories[order.get(section.categoryId)!]!.name,
      lines: section.lines.map((line) => ({ text: line.text, articleIds: [...new Set(line.articleIds.filter((id) => given.has(id)))] })),
    }));
  // A scheduled time made up for by another path in the meantime keeps the digest it has.
  if (options.slot !== null && hasDigestForSlot(db, options.slot)) return { status: "failed" };
  const id = saveDigest(db, {
    periodStart: period.start,
    periodEnd: period.end,
    createdAt: clock().toISOString(),
    trigger: options.trigger,
    slot: options.slot,
    executiveSummary: output.executiveSummary,
    sections,
    articleCount: articles.length,
    target,
  });
  return { status: "created", id };
}

/**
 * What a digest is made of: the articles of the period that ends `now`, or those of the list. Null when there
 * is no article. The period of a list runs from its oldest article to its newest.
 */
function gather(
  db: Database,
  now: Date,
  request: DigestTargetRequest | undefined,
): { articles: DigestArticle[]; period: { start: string; end: string }; target: DigestTarget | null } | null {
  if (request !== undefined) {
    const list = listDigestArticles(db, request, now.toISOString());
    if (list.period === null || list.articles.length === 0) return null;
    return { articles: list.articles, period: list.period, target: list.target };
  }
  const period = { start: digestPeriodStart(db, now).toISOString(), end: now.toISOString() };
  const articles = digestArticles(db, period);
  return articles.length === 0 ? null : { articles, period, target: null };
}

/**
 * Makes the digests: at the times of the settings, a missed time once at start-up, and one when the reader asks.
 * One digest is made at a time.
 */
export class DigestWorker {
  readonly #deps: DigestDeps;
  #tail: Promise<void> = Promise.resolve();
  /** Digests queued or under way. */
  #pending = 0;
  #lastCheck: Date | null = null;
  #catchingUp = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(deps: DigestDeps) {
    this.#deps = deps;
  }

  /** True between `start()` and `stop()`. */
  get running(): boolean {
    return this.#timer !== undefined;
  }

  /** True while a digest is queued or being made. */
  get building(): boolean {
    return this.#pending > 0;
  }

  /** Sets where checking starts. With `catchUp`, a time missed in the last six hours counts as still due. */
  begin(options: { catchUp: boolean }): void {
    const now = this.#deps.clock();
    this.#lastCheck = options.catchUp ? new Date(now.getTime() - CATCH_UP_MS) : now;
    this.#catchingUp = options.catchUp;
  }

  /** Queues the digest of the latest scheduled time since the last check, unless that time has one already. */
  tick(): void {
    const { db, clock } = this.#deps;
    const now = clock();
    const since = this.#lastCheck ?? now;
    const catchingUp = this.#catchingUp;
    this.#lastCheck = now;
    this.#catchingUp = false;
    const { digestSchedule, timeZone } = getSettings(db);
    // However many times were missed, only the latest is made up for.
    const due = latestSlot(digestSchedule, timeZone, since, now);
    if (!due || hasDigestForSlot(db, due.slot)) return;
    this.#enqueue({ trigger: catchingUp ? "catch-up" : "schedule", slot: due.slot });
  }

  /**
   * Starts a digest of the period that ends now, whatever the schedule says, and does not wait for it. Says
   * `busy` while one is being made, and why none is started when the allowance, the budget or the period says so.
   */
  buildNow(): DigestRequestResult["status"] | "busy" {
    return this.#request({ trigger: "manual", slot: null });
  }

  /**
   * Starts a digest of the newest articles of a list, at most 200, and does not wait for it. It shares the day's
   * allowance with the digests of a period, and says `busy`, `empty`, `limit` and `budget` as `buildNow` does.
   */
  buildFromList(target: DigestTargetRequest): DigestRequestResult["status"] | "busy" {
    return this.#request({ trigger: "list", slot: null, target });
  }

  #request(options: DigestRequestOptions): DigestRequestResult["status"] | "busy" {
    if (this.building) return "busy";
    const { db, clock, runner } = this.#deps;
    if (gather(db, clock(), options.target) === null) return "empty";
    const blocked = runner.digestBlocked();
    if (blocked !== null) return blocked;
    this.#enqueue(options);
    return "queued";
  }

  #enqueue(options: DigestRequestOptions): void {
    this.#pending += 1;
    this.#tail = this.#tail.then(async () => {
      try {
        if (options.slot !== null && hasDigestForSlot(this.#deps.db, options.slot)) return;
        await makeDigest(this.#deps, options);
      } catch (error) {
        // Nothing may escape: a rejection would stop every digest queued behind this one.
        (this.#deps.log ?? console.error)("digest worker:", error);
      } finally {
        this.#pending -= 1;
      }
    });
  }

  /** Resolves when every digest queued so far is made or given up. */
  idle(): Promise<void> {
    return this.#tail;
  }

  /** Makes up for a recently missed time, then checks the schedule every `intervalMs`. */
  start(intervalMs = 30_000): void {
    this.begin({ catchUp: true });
    this.#safeTick();
    this.#timer = setInterval(() => this.#safeTick(), intervalMs);
  }

  #safeTick(): void {
    try {
      this.tick();
    } catch (error) {
      // A failed check must not end the process; the next one runs at the next interval.
      (this.#deps.log ?? console.error)("digest worker:", error);
    }
  }

  /** Stops checking. A digest under way is finished. */
  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
