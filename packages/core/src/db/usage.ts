import type { Usage } from "../api.ts";
import { addDays } from "../time.ts";
import { listCategories } from "./categories.ts";
import type { Database } from "./database.ts";
import { num, str } from "./rows.ts";

/** Money counts as the budget does: the known costs of the calls to providers that cost money. */
const COST = "coalesce(sum(CASE WHEN c.billable = 1 THEN c.cost_usd END), 0)";
const UNKNOWN = "coalesce(sum(c.billable = 1 AND c.cost_usd IS NULL), 0)";

/**
 * The model calls made from `start` to `now`, by category, outside runs and by UTC day, with the money at `end` if
 * the period goes on at its average pace. The period is that of the budget: `start` and `end` are midnight UTC.
 */
export function usageReport(
  db: Database,
  period: { start: Date; end: Date; now: Date; monthlyBudgetUsd: number; billable: boolean },
): Omit<Usage, "periodStart" | "periodEnd"> {
  const { start, end, now, monthlyBudgetUsd, billable } = period;
  const range = [start.toISOString(), now.toISOString()] as const;

  const callsByCategory = new Map(
    db
      .prepare(
        `SELECT r.category_id AS id, count(*) AS calls, ${COST} AS cost, ${UNKNOWN} AS unknown
           FROM llm_calls c JOIN runs r ON r.id = c.run_id
          WHERE c.created_at >= ? AND c.created_at <= ? GROUP BY r.category_id`,
      )
      .all(...range)
      .map((row) => [num(row.id), { calls: num(row.calls), costUsd: Number(row.cost), unknownCostCalls: num(row.unknown) }]),
  );
  const articlesByCategory = new Map(
    db
      .prepare(
        `SELECT category_id AS id, count(*) AS created, count(opened_at) AS opened FROM articles
          WHERE origin = 'generated' AND created_at >= ? AND created_at <= ? GROUP BY category_id`,
      )
      .all(...range)
      .map((row) => [num(row.id), { created: num(row.created), opened: num(row.opened) }]),
  );
  const byCategory = listCategories(db).map((category) => {
    const calls = callsByCategory.get(category.id) ?? { calls: 0, costUsd: 0, unknownCostCalls: 0 };
    const articles = articlesByCategory.get(category.id) ?? { created: 0, opened: 0 };
    return {
      categoryId: category.id,
      name: category.name,
      ...calls,
      articlesCreated: articles.created,
      articlesOpened: articles.opened,
      costPerOpenedUsd: articles.opened > 0 ? calls.costUsd / articles.opened : null,
    };
  });

  const outside = db
    .prepare(`SELECT count(*) AS calls, ${COST} AS cost, ${UNKNOWN} AS unknown FROM llm_calls c WHERE c.run_id IS NULL AND c.created_at >= ? AND c.created_at <= ?`)
    .get(...range)!;
  const outsideRuns = { calls: num(outside.calls), costUsd: Number(outside.cost), unknownCostCalls: num(outside.unknown) };

  // created_at is an ISO time in UTC, so its first ten characters are its UTC day.
  const days = new Map(
    db
      .prepare(
        `SELECT substr(c.created_at, 1, 10) AS day, count(*) AS calls, ${COST} AS cost, ${UNKNOWN} AS unknown
           FROM llm_calls c WHERE c.created_at >= ? AND c.created_at <= ? GROUP BY day`,
      )
      .all(...range)
      .map((row) => [str(row.day), { calls: num(row.calls), costUsd: Number(row.cost), unknown: num(row.unknown) }]),
  );
  const byDay: Usage["byDay"] = [];
  const today = now.toISOString().slice(0, 10);
  for (let day = start.toISOString().slice(0, 10); day <= today; day = addDays(day, 1)) {
    const entry = days.get(day);
    byDay.push({ day, calls: entry?.calls ?? 0, costUsd: entry?.costUsd ?? 0 });
  }
  const spentUsd = [...days.values()].reduce((sum, entry) => sum + entry.costUsd, 0);
  const unknownCostCalls = [...days.values()].reduce((sum, entry) => sum + entry.unknown, 0);

  const elapsed = now.getTime() - start.getTime();
  const length = end.getTime() - start.getTime();
  const projectedUsd = elapsed > 0 ? (spentUsd * length) / elapsed : spentUsd;
  return {
    elapsedRatio: Math.min(1, Math.max(0, elapsed / length)),
    billable,
    monthlyBudgetUsd,
    spentUsd,
    unknownCostCalls,
    byCategory,
    outsideRuns,
    byDay,
    projection: { projectedUsd, exceedsBudget: projectedUsd > monthlyBudgetUsd },
  };
}
