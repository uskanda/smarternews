import { TOPIC_STATS_DAYS, type BlockedSite, type SiteStats, type SiteStatsEntry } from "../api.ts";
import { DomainError, notFound } from "../errors.ts";
import { normalizeHost } from "../fetch/url.ts";
import { getCategory } from "./categories.ts";
import type { Database } from "./database.ts";
import { num, str } from "./rows.ts";

// The sites of a category's candidates: what each brought in the last 30 days, and the sites blocked in the category.
// Counted from the rows as they are now; no model is involved. A blocked site's candidates are rejected right after
// collecting, before the judge, so they cost no model call.

const DAY = 86_400_000;

/** A host from a request, in the form the candidates keep, or a refusal. */
function hostOf(value: string): string {
  const host = normalizeHost(value);
  if (host === null) {
    throw new DomainError("invalid", `${JSON.stringify(value)} is not a host name`, [{ path: "host", message: "not a host name", code: "format" }]);
  }
  return host;
}

/** The hosts blocked in the category. */
export function blockedHosts(db: Database, categoryId: number): Set<string> {
  return new Set(
    db
      .prepare("SELECT host FROM blocked_sites WHERE category_id = ?")
      .all(categoryId)
      .map((row) => str(row.host)),
  );
}

function listBlocked(db: Database, categoryId: number): BlockedSite[] {
  return db
    .prepare("SELECT host, created_at FROM blocked_sites WHERE category_id = ? ORDER BY host")
    .all(categoryId)
    .map((row) => ({ host: str(row.host), blockedAt: str(row.created_at) }));
}

/** Blocks a site in the category. A site already blocked keeps the time it was first blocked. */
export function blockSite(db: Database, categoryId: number, value: string, now: Date): BlockedSite {
  getCategory(db, categoryId);
  const host = hostOf(value);
  db.prepare("INSERT OR IGNORE INTO blocked_sites (category_id, host, created_at) VALUES (?, ?, ?)").run(categoryId, host, now.toISOString());
  return listBlocked(db, categoryId).find((site) => site.host === host)!;
}

/** Stops blocking a site in the category; refuses one that is not blocked. */
export function unblockSite(db: Database, categoryId: number, value: string): void {
  getCategory(db, categoryId);
  const host = hostOf(value);
  const { changes } = db.prepare("DELETE FROM blocked_sites WHERE category_id = ? AND host = ?").run(categoryId, host);
  if (num(changes) === 0) throw notFound("blocked site", host);
}

/** The sites of the category's candidates within the last `TOPIC_STATS_DAYS` days before `now`, and its blocked sites. */
export function siteStats(db: Database, categoryId: number, now: Date): SiteStats {
  getCategory(db, categoryId);
  const since = new Date(now.getTime() - TOPIC_STATS_DAYS * DAY).toISOString();
  const blocked = blockedHosts(db, categoryId);

  const counts = new Map<string, SiteStatsEntry>();
  const candidates = db
    .prepare(
      `SELECT site_host, count(*) AS total,
              coalesce(sum(status = 'accepted'), 0) AS accepted,
              coalesce(sum(status = 'rejected'), 0) AS rejected
         FROM candidates
        WHERE category_id = ? AND created_at >= ?
        GROUP BY site_host`,
    )
    .all(categoryId, since);
  for (const row of candidates) {
    const host = str(row.site_host);
    counts.set(host, {
      host,
      candidates: num(row.total),
      accepted: num(row.accepted),
      rejected: num(row.rejected),
      articles: 0,
      opened: 0,
      starred: 0,
      missed: 0,
      blocked: blocked.has(host),
    });
  }

  // An article written from several candidates of one site counts once for it.
  const articles = db
    .prepare(
      `SELECT s.site_host, count(*) AS articles,
              coalesce(sum(a.opened_at IS NOT NULL), 0) AS opened,
              coalesce(sum(a.starred = 1), 0) AS starred,
              coalesce(sum(EXISTS (SELECT 1 FROM misses m WHERE m.article_id = a.id)), 0) AS missed
         FROM (SELECT DISTINCT site_host, article_id FROM candidates
                WHERE category_id = ? AND created_at >= ? AND article_id IS NOT NULL) s
         JOIN articles a ON a.id = s.article_id
        GROUP BY s.site_host`,
    )
    .all(categoryId, since);
  for (const row of articles) {
    const entry = counts.get(str(row.site_host));
    if (!entry) continue;
    entry.articles = num(row.articles);
    entry.opened = num(row.opened);
    entry.starred = num(row.starred);
    entry.missed = num(row.missed);
  }

  // Among as many candidates, the unknown site goes after the named ones.
  const name = (host: string) => (host === "" ? "￿" : host);
  const sites = [...counts.values()].sort((a, b) => b.candidates - a.candidates || (name(a.host) < name(b.host) ? -1 : name(a.host) > name(b.host) ? 1 : 0));
  return { since, sites, blocked: listBlocked(db, categoryId) };
}
