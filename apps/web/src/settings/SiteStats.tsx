import { TOPIC_STATS_DAYS, type Category, type SiteStatsEntry } from "@smarternews/core/api";
import { formatDay } from "@smarternews/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useCategories, useSiteStats, useTimeZone } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { Badge, Button, ErrorNotice, Loading } from "../ui/controls.tsx";
import { DialogCloseButton, FormDialog } from "../ui/FormDialog.tsx";
import { AddFeedForm } from "./AddFeedForm.tsx";

/** What the rows call the candidates whose site is not known. */
const UNKNOWN_HOST = "不明";

/** "1/4件（25%）": a part of the articles the site's candidates became, and its share rounded to a whole percent. */
function ofArticles(count: number, articles: number): string {
  return articles === 0 ? `${count}件` : `${count}/${articles}件（${Math.round((count / articles) * 100)}%）`;
}

function rowsOf(site: SiteStatsEntry): Array<[string, string]> {
  return [
    ["候補", `${site.candidates}件`],
    ["採用", `${site.accepted}件`],
    ["除外", `${site.rejected}件`],
    ["記事", `${site.articles}件`],
    ["開いた記事", ofArticles(site.opened, site.articles)],
    ["スター", ofArticles(site.starred, site.articles)],
    ["外れ", ofArticles(site.missed, site.articles)],
  ];
}

/** The ids of the buttons the focus moves to once the list has come back after blocking or unblocking. */
const blockId = (base: string, host: string) => `${base}-block-${host}`;
const unblockId = (base: string, host: string) => `${base}-unblock-${host}`;

/**
 * The feeds of a site, looked for in a dialog over the category's page. A feed goes to a news category, so an
 * event category starts with none chosen.
 */
function FindFeedsDialog({ host, category, onClose }: { host: string; category: Category; onClose: () => void }) {
  const categories = useCategories();
  return (
    <FormDialog open onOpenChange={(open) => (open ? undefined : onClose())} title="購読フィードを追加">
      <AddFeedForm
        categories={categories.data ?? []}
        categoryId={category.kind === "news" ? category.id : null}
        discoverUrl={`https://${host}/`}
        onAdded={onClose}
      />
      <div className="flex justify-end">
        <DialogCloseButton>閉じる</DialogCloseButton>
      </div>
    </FormDialog>
  );
}

/**
 * What the sites of the category's candidates brought in the last 30 days, the most candidates first, with the sites
 * blocked in the category above them. A blocked site's candidates are rejected before the judge from the next run on.
 */
export function SiteStatsSection({ category }: { category: Category }) {
  const stats = useSiteStats(category.id);
  const timeZone = useTimeZone();
  const { api } = useApp();
  const client = useQueryClient();
  const toast = useToast();
  const base = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [searching, setSearching] = useState<string | null>(null);
  // The button to move the focus to once the list shows the change; the heading when it is not there.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const headingId = `${base}-heading`;

  useEffect(() => {
    if (focusTarget === null || stats.isFetching) return;
    (document.getElementById(focusTarget) ?? document.getElementById(headingId))?.focus();
    setFocusTarget(null);
  }, [focusTarget, stats.isFetching, stats.data, headingId]);

  async function change(action: () => Promise<unknown>, message: string, target: string) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      toast({ message });
      await client.invalidateQueries({ queryKey: ["site-stats", category.id] });
      setFocusTarget(target);
    } catch (error) {
      setProblem(error);
    } finally {
      setBusy(false);
    }
  }

  const block = (host: string) => void change(() => api.blockSite(category.id, host), `${host} を候補から除きました`, unblockId(base, host));
  const unblock = (host: string) => void change(() => api.unblockSite(category.id, host), `${host} の除外をやめました`, blockId(base, host));

  const blocked = stats.data?.blocked ?? [];
  const sites = stats.data?.sites ?? [];
  return (
    <section aria-label="出典のサイト" className="flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl">
      <h2 id={headingId} tabIndex={-1} className="type-headline-md">
        出典のサイト
      </h2>
      <p className="max-w-measure type-body-md text-on-surface-muted">
        {stats.data ? `${formatDay(stats.data.since, timeZone).date}から今日まで、` : `直近${TOPIC_STATS_DAYS}日に、`}
        候補になったページをサイトごとにまとめました。役に立たないサイトは候補から除けます。除いたサイトの候補は、次の実行から判定の前に除外し、LLMに送りません。
      </p>
      {stats.isError ? <ErrorNotice error={stats.error} onRetry={() => void stats.refetch()} /> : null}
      {problem ? <ErrorNotice error={problem} /> : null}
      {stats.isPending && !stats.isError ? <Loading /> : null}
      {blocked.length > 0 ? (
        <div className="flex max-w-measure flex-col gap-xs">
          <h3 id={`${base}-blocked`} className="type-label-md">
            除外中のサイト
          </h3>
          <ul aria-labelledby={`${base}-blocked`} className="flex flex-col">
            {blocked.map((site) => (
              <li key={site.host} className="flex flex-wrap items-center justify-between gap-sm border-b border-outline py-sm">
                <span id={`${base}-blocked-${site.host}`} className="min-w-0 break-all type-body-md">
                  {site.host}
                </span>
                <Button id={unblockId(base, site.host)} disabled={busy} aria-describedby={`${base}-blocked-${site.host}`} onClick={() => unblock(site.host)}>
                  除外をやめる
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {stats.data && sites.length === 0 ? <p className="type-body-md text-on-surface-muted">直近{TOPIC_STATS_DAYS}日の候補はまだありません。</p> : null}
      <ul aria-label="サイトごとの成績" className="max-w-measure">
        {sites.map((site) => (
          <li key={site.host} className="flex flex-col gap-xs border-b border-outline py-md">
            <div className="flex flex-wrap items-center gap-sm">
              <h3 id={`${base}-site-${site.host}`} className="min-w-0 break-all type-label-md">
                {site.host === "" ? UNKNOWN_HOST : site.host}
              </h3>
              {site.blocked ? <Badge>除外中</Badge> : null}
            </div>
            {site.host === "" ? (
              <p className="type-label-sm text-on-surface-muted">転送用のリンクのままで、サイトが分からない候補です。</p>
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-xs type-label-sm sm:grid-cols-[auto_1fr_auto_1fr]">
              {rowsOf(site).map(([term, value]) => (
                <div key={term} className="contents">
                  <dt className="text-on-surface-muted">{term}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {site.host === "" ? null : (
              <div className="flex flex-wrap gap-sm">
                {site.blocked ? null : (
                  <Button id={blockId(base, site.host)} disabled={busy} aria-describedby={`${base}-site-${site.host}`} onClick={() => block(site.host)}>
                    このサイトを候補から除く
                  </Button>
                )}
                <Button aria-describedby={`${base}-site-${site.host}`} onClick={() => setSearching(site.host)}>
                  このサイトのフィードを探す
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="max-w-measure type-label-sm text-on-surface-muted">
        候補は集めた日から{TOPIC_STATS_DAYS}日以内のものを数えます。サイトは、URLのホスト名から先頭の「www.」を取ったものです。開いた記事、スター、外れは、記事のうちの数です。
      </p>
      {searching !== null ? <FindFeedsDialog host={searching} category={category} onClose={() => setSearching(null)} /> : null}
    </section>
  );
}
