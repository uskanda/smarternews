// Digests: at the times of the settings, one call of the digest task sums up the articles of a period. Like the
// summaries of feed articles, they are made in a line of their own, apart from the queue of runs.
import type { DigestRequestResult, DigestSection, DigestTrigger } from "../api.ts";
import type { Clock } from "../clock.ts";
import { listCategories } from "../db/categories.ts";
import type { Database } from "../db/database.ts";
import { digestArticles, digestPeriodStart, hasDigestForSlot, saveDigest } from "../db/digests.ts";
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

/**
 * Makes one digest of the period that ends now and stores it. The model is not called for a period without
 * articles, nor once an allowance is used up. Ids of source articles that were not in the input are dropped, and
 * the sections are put in the order of the categories. Nothing is thrown: a failure is recorded with the call.
 */
export async function makeDigest(deps: DigestDeps, options: { trigger: DigestTrigger; slot: string | null }): Promise<DigestOutcome> {
  const { db, clock, runner } = deps;
  const end = clock();
  const start = digestPeriodStart(db, end);
  const articles = digestArticles(db, { start: start.toISOString(), end: end.toISOString() });
  if (articles.length === 0) return { status: "empty" };
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
        now: end.toISOString(),
        timeZone: settings.timeZone,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
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
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    createdAt: clock().toISOString(),
    trigger: options.trigger,
    slot: options.slot,
    executiveSummary: output.executiveSummary,
    sections,
    articleCount: articles.length,
  });
  return { status: "created", id };
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
    if (this.building) return "busy";
    const { db, clock, runner } = this.#deps;
    const end = clock();
    const start = digestPeriodStart(db, end);
    if (digestArticles(db, { start: start.toISOString(), end: end.toISOString() }).length === 0) return "empty";
    const blocked = runner.digestBlocked();
    if (blocked !== null) return blocked;
    this.#enqueue({ trigger: "manual", slot: null });
    return "queued";
  }

  #enqueue(options: { trigger: DigestTrigger; slot: string | null }): void {
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
